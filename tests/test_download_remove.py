"""Remove only an owned .part, after closing writers. All data is synthetic."""
import io
import os
from pathlib import Path
import sys,tempfile,threading,time,unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,downloader


class RemoveDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        with patch.object(config,'load_history',return_value=[]):self.d=downloader.Downloader({'download_dir':str(self.root),'max_concurrent_downloads':2})
        self.d.save_tasks=Mock(return_value=True);self.d._ensure_workers=Mock()
        self.t=downloader.DownloadTask('https://example.invalid/file',str(self.root),'model.safetensors')
        self.d.add_task(self.t);self.dest=self.root/self.t.filename;self.part=Path(str(self.dest)+'.part')
        self.dest.write_bytes(b'existing complete model')

    def own_partial(self):
        self.part.write_bytes(b'partial');self.t._partial_path=str(self.part.resolve());self.t.downloaded=7;self.t.total=100

    def test_paused_owned_part_removed_model_and_history_retained(self):
        self.own_partial();self.t.status='paused';r=self.d.remove_task(self.t)
        self.assertTrue(r['ok']);self.assertFalse(self.part.exists());self.assertEqual(self.dest.read_bytes(),b'existing complete model')
        self.assertEqual(self.d.get_history()[0]['status'],'canceled');self.assertEqual(self.d.tasks,[])

    def test_restored_part_ownership(self):
        self.own_partial();self.t=downloader.DownloadTask.from_dict(self.t.to_dict());self.d.tasks=[self.t]
        self.d.remove_task(self.t);self.assertFalse(self.part.exists())

    def test_unowned_part_not_deleted(self):
        self.part.write_bytes(b'unrelated old data');self.d.remove_task(self.t)
        self.assertEqual(self.part.read_bytes(),b'unrelated old data')

    def test_shared_part_protected(self):
        self.own_partial();other=downloader.DownloadTask('https://example.invalid/file',str(self.root),self.t.filename);self.d.add_task(other)
        self.d.remove_task(self.t);self.assertTrue(self.part.exists());self.assertIn('其他任务',self.t.partial_cleanup_error)

    def test_active_occupancy_and_cancel_token_retained(self):
        self.own_partial();self.d._active_ids.add(self.t.id);path=os.path.normcase(str(self.dest.resolve()));self.d._active_paths[self.t.id]=path
        self.d.remove_task(self.t);self.assertTrue(self.part.exists());self.assertIn(path,self.d._active_paths.values())
        self.assertTrue(self.d._cancel_events[self.t.id].is_set())

    def test_archive_does_not_clean_partial(self):
        self.own_partial();self.t.status='error';self.d.remove_task(self.t,cleanup_partial=False)
        self.assertTrue(self.part.exists())

    def test_other_files_and_directory_never_deleted(self):
        self.own_partial();other=self.root/'other.part';other.write_bytes(b'keep');self.d.remove_task(self.t)
        self.assertTrue(self.root.is_dir());self.assertTrue(other.exists());self.assertTrue(self.dest.exists())

    def test_path_changed_or_traversal_never_deleted(self):
        self.own_partial();self.t.filename='../model.safetensors';self.d.remove_task(self.t)
        self.assertTrue(self.part.exists());self.assertIn('路径',self.t.partial_cleanup_error)

    def test_cleanup_error_keeps_part_and_is_recorded(self):
        self.own_partial()
        with patch.object(downloader.os,'unlink',side_effect=PermissionError()):self.d.remove_task(self.t)
        self.assertTrue(self.part.exists());self.assertIn('清理失败',self.d.get_history()[0]['partial_cleanup_error'])

    def test_live_writer_closed_before_unlink(self):
        entered=threading.Event();release=threading.Event();closed=threading.Event()
        class Response(io.BytesIO):
            status=200;headers={'Content-Length':'100'}
            def read(self,*args):entered.set();release.wait(2);return super().read(*args)
            def __exit__(self,*args):closed.set();return super().__exit__(*args)
        opener=Mock();opener.open.return_value=Response(b'synthetic part')
        original=self.d._download_once
        def once(t):
            try:original(t)
            finally:self.d._stop=True
        self.d._download_once=once
        unlink=os.unlink
        def checked(path):self.assertTrue(closed.is_set());unlink(path)
        with patch('civitai_api.build_opener',return_value=opener),patch.object(downloader.os,'unlink',side_effect=checked):
            worker=threading.Thread(target=self.d._worker);worker.start();self.assertTrue(entered.wait(1))
            self.d.remove_task(self.t);self.assertTrue(self.part.exists());release.set();worker.join(3)
        self.assertFalse(worker.is_alive());self.assertFalse(self.part.exists());self.assertEqual(self.dest.read_bytes(),b'existing complete model')
        self.assertNotIn(self.t.id,self.d._active_ids);self.assertNotIn(self.t.id,self.d._cancel_events)

    def test_remove_during_retry_wait_never_restarts(self):
        calls=[]
        def fail(t):
            calls.append(t.id);self.own_partial();t.status='error';t.error='network timeout'
        self.d._download_once=fail;worker=threading.Thread(target=self.d._worker);worker.start()
        for _ in range(100):
            if self.t.status=='retrying':break
            time.sleep(.01)
        self.assertEqual(self.t.status,'retrying');self.d._stop=True;self.d.remove_task(self.t);worker.join(2)
        self.assertFalse(worker.is_alive());self.assertEqual(len(calls),1);self.assertFalse(self.part.exists())

    def test_cleanup_intent_survives_exit_before_worker_finishes(self):
        self.own_partial();self.d._active_ids.add(self.t.id);self.d.remove_task(self.t)
        rows=self.d.get_history();self.assertTrue(rows[0]['partial_cleanup_pending'])
        with patch.object(config,'load_history',return_value=rows),patch.object(config,'load_tasks',return_value=[]):
            restarted=downloader.Downloader({'download_dir':str(self.root)});restarted.save_tasks=Mock();restarted.load_tasks(resume=False)
        self.assertFalse(self.part.exists());self.assertFalse(restarted.get_history()[0]['partial_cleanup_pending'])
        self.assertTrue(self.dest.exists())

    def test_legacy_canceled_history_is_not_swept(self):
        self.own_partial();row=self.t.to_dict();row['status']='canceled'
        with patch.object(config,'load_history',return_value=[row]),patch.object(config,'load_tasks',return_value=[]):
            restarted=downloader.Downloader({'download_dir':str(self.root)});restarted.save_tasks=Mock();restarted.load_tasks(resume=False)
        self.assertTrue(self.part.exists())

    def test_pending_cleanup_protects_a_restored_shared_task(self):
        self.own_partial();self.d._active_ids.add(self.t.id);self.d.remove_task(self.t);rows=self.d.get_history()
        other=downloader.DownloadTask('https://example.invalid',str(self.root),self.t.filename);other.status='paused'
        with patch.object(config,'load_history',return_value=rows),patch.object(config,'load_tasks',return_value=[other.to_dict()]):
            restarted=downloader.Downloader({'download_dir':str(self.root)});restarted.save_tasks=Mock();restarted.load_tasks(resume=False)
        self.assertTrue(self.part.exists());self.assertIn('其他任务',restarted.get_history()[0]['partial_cleanup_error'])


if __name__=='__main__':unittest.main()
