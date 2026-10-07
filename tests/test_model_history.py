"""历史独立图文缓存、路径移动与详情缩略图回归；只使用临时文件和假网络。"""
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config, downloader, webui
from PIL import Image

class ModelHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.patches=[patch.object(config,'APP_DIR',str(self.root)),patch.object(config,'TASKS_PATH',str(self.root/'tasks.json')),patch.object(config,'HISTORY_PATH',str(self.root/'history.json')),patch.object(downloader.Downloader,'_ensure_workers')]
        for p in self.patches:p.start()
        self.api=webui.Api.__new__(webui.Api); self.api.cfg={'cache_detail_images':True,'models_dir':str(self.root),'models_dirs':[str(self.root)]}; self.api.dl=downloader.Downloader(self.api.cfg);self.api._history_migration_started=True
        self.path=self.root/'test.safetensors'; self.path.write_bytes(b'model fixture')
        self.info={'id':123,'modelId':123,'name':'fixture','trainedWords':['soft light'],'files':[{'name':'test.safetensors','downloadUrl':'https://example.invalid/?signature=secret'}],'images':[{'url':'https://image.civitai.com/a/width=1024/b.jpg','meta':{'prompt':'fixture prompt'}}]}
        self.task=downloader.DownloadTask('https://example.invalid/?signature=secret',str(self.root),self.path.name,info={'modelName':'fixture','meta':{'info':self.info}})
        self.task.status=downloader.ST_DONE;self.api.dl.tasks.append(self.task);self.api.dl._notify(self.task)
        im=Image.new('RGB',(1600,1000),'red'); im.save(self.root/'test.preview.png')
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def test_archive_preserves_metadata_and_thumbnail_after_original_deleted(self):
        self.api._cache_history_task(self.task);self.api.dl.clear_finished()
        self.path.unlink(); (self.root/'test.preview.png').unlink()
        fresh=downloader.Downloader({});self.api.dl=fresh
        result=json.loads(self.api.get_history_detail(self.task.id))
        self.assertTrue(result['cached_history']);self.assertEqual(result['info']['name'],'fixture');self.assertTrue(result['covers'][0]['b64'])
        asset=Path(self.api._history_asset(self.task.id,'.json')).read_text(encoding='utf-8');self.assertNotIn('secret',asset);self.assertNotIn('downloadUrl',asset)
        with Image.open(io.BytesIO(base64.b64decode(result['covers'][0]['b64']))) as im:self.assertLessEqual(max(im.size),256)
    def test_move_archived_file_updates_actual_directory_across_restart(self):
        self.api._cache_history_task(self.task);self.api.dl.clear_finished()
        dest=self.root/'moved';dest.mkdir(); images=self.root/'test.images';images.mkdir();(images/'example.jpg').write_bytes(b'fixture')
        result=self.api.history_move_to(self.task.id,str(dest));self.assertTrue(result['ok']);self.assertTrue((dest/'test.images/example.jpg').exists())
        self.api.dl=downloader.Downloader({});row=self.api.get_download_history()['items'][0]
        self.assertEqual(row['file_path'],str(dest/self.path.name));self.assertEqual(row['dest_dir'],str(dest));self.assertTrue(row['file_exists']);self.assertTrue(row['cached_thumb'])
    def test_move_conflict_does_not_overwrite_files(self):
        dest=self.root/'moved';dest.mkdir();(dest/self.path.name).write_bytes(b'keep')
        self.assertFalse(self.api.history_move_to(self.task.id,str(dest))['ok']);self.assertTrue(self.path.exists());self.assertEqual((dest/self.path.name).read_bytes(),b'keep')
    def test_missing_file_is_not_falsely_relocated(self):
        self.api.dl.clear_finished();self.path.unlink();dest=self.root/'moved';dest.mkdir()
        self.assertFalse(self.api.history_move_to(self.task.id,str(dest))['ok']);self.assertEqual(self.api.dl.get_history()[0]['dest_dir'],str(self.root))
    def test_metadata_callback_not_repeated_when_done_removed(self):
        self.task._metadata_started=True
        with patch.object(webui.threading,'Thread') as thread:self.api._on_dl_update(self.task);thread.assert_not_called()
    def test_detail_thumbnail_reuses_cache_and_never_saves_original(self):
        buf=io.BytesIO();Image.new('RGB',(2400,1800),'blue').save(buf,'PNG');payload=buf.getvalue()
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False);response.read.return_value=payload
        opener=Mock();opener.open.return_value=response
        with patch('urllib.request.build_opener',return_value=opener):
            first=self.api.get_cover_b64(self.info['images'][0]['url']);second=self.api.get_cover_b64(self.info['images'][0]['url'])
        self.assertEqual(first,second);opener.open.assert_called_once()
        self.assertIn('/width=512/',opener.open.call_args.args[0].full_url)
        with Image.open(io.BytesIO(base64.b64decode(first))) as im:self.assertLessEqual(max(im.size),512)
        self.assertFalse((self.root/'test.images').exists())
    def test_detail_cache_disabled_avoids_disk_reads_and_writes(self):
        self.api.cfg['cache_detail_images']=False
        url='https://example.invalid/image.png';cache=Path(self.api._detail_cache_path(url));cache.parent.mkdir();cache.write_bytes(b'stale')
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        buf=io.BytesIO();Image.new('RGB',(100,100),'blue').save(buf,'PNG');response.read.return_value=buf.getvalue()
        opener=Mock();opener.open.return_value=response
        with patch('urllib.request.build_opener',return_value=opener):self.assertTrue(self.api.get_cover_b64(url))
        opener.open.assert_called_once();self.assertEqual(cache.read_bytes(),b'stale')
    def test_invalid_thumbnail_url_not_opened(self):
        with patch('urllib.request.build_opener') as opener:self.assertEqual(self.api.get_cover_b64('file:///C:/private'),'');opener.assert_not_called()
    def test_archive_by_id_keeps_history_and_file(self):
        result=self.api.archive_download_task(self.task.id)
        self.assertTrue(result['ok']);self.assertEqual(self.api.dl.tasks,[])
        self.assertEqual(len(self.api.dl.get_history()),1);self.assertTrue(self.path.exists())
    def test_archive_rejects_unfinished_task(self):
        self.task.status=downloader.ST_PENDING
        self.assertFalse(self.api.archive_download_task(self.task.id)['ok']);self.assertIn(self.task,self.api.dl.tasks)
    def test_error_and_cancel_schedule_cache_once_per_status(self):
        for status in (downloader.ST_ERROR,downloader.ST_CANCELED):
            self.task.status=status
            with patch.object(webui.threading,'Thread') as thread:
                self.api._on_dl_update(self.task);self.api._on_dl_update(self.task)
                thread.assert_called_once()
                self.assertEqual(thread.call_args.kwargs['target'],self.api._cache_history_task)
    def test_local_file_without_sidecar_uses_independent_snapshot(self):
        self.api._cache_history_task(self.task)
        result=json.loads(self.api.get_history_detail(self.task.id))
        self.assertEqual(result['info']['name'],'fixture');self.assertFalse(result.get('cached_history',False))

    def test_migrate_renamed_model_uses_unique_version_identity_and_size(self):
        self.info.update(versionId=456,version={'id':456})
        new=self.root/'renamed.safetensors';self.path.rename(new)
        self.task.total=new.stat().st_size;self.api.dl.save_tasks()
        new.with_suffix('.civitai.info').write_text(json.dumps(self.info),encoding='utf-8')
        (self.root/'test.preview.png').rename(self.root/'renamed.preview.png')
        self.api._migrate_history_cache()
        row=self.api.get_download_history()['items'][0]
        self.assertEqual(row['file_path'],str(new));self.assertTrue(row['file_exists']);self.assertTrue(row['cached_info']);self.assertTrue(row['cached_thumb']);self.assertEqual(row['model_url'],'https://civitai.com/models/123')
    def test_migrate_ambiguous_version_does_not_guess(self):
        self.info.update(versionId=456,version={'id':456})
        self.task.total=self.path.stat().st_size;self.path.unlink();self.api.dl.save_tasks()
        for name in ('one','two'):
            (self.root/(name+'.safetensors')).write_bytes(b'model fixture')
            (self.root/(name+'.civitai.info')).write_text(json.dumps(self.info),encoding='utf-8')
        with patch.object(self.api,'get_cover_b64',return_value=''):self.api._migrate_history_cache()
        row=self.api.dl.get_history()[0]
        self.assertEqual(row['file_path'],str(self.path));self.assertTrue(row['cached_info'])
    def test_migrate_retained_queue_metadata_without_original_file(self):
        self.path.unlink();(self.root/'test.preview.png').unlink()
        with patch.object(self.api,'get_cover_b64',return_value=''):self.api._migrate_history_cache()
        row=self.api.dl.get_history()[0]
        self.assertTrue(row['cached_info']);self.assertEqual(row['model_url'],'https://civitai.com/models/123')
        self.assertEqual(json.loads(self.api.get_history_detail(self.task.id))['info']['name'],'fixture')
    def test_history_move_rejects_failed_task(self):
        with self.api.dl._lock:self.api.dl.history[self.task.id]['status']=downloader.ST_ERROR
        self.assertFalse(self.api.history_move_to(self.task.id,str(self.root))['ok'])

    def test_safe_id_asset_cannot_escape_cache_directory(self):
        asset=Path(self.api._history_asset('../../outside','.jpg'));self.assertEqual(asset.parent,self.root/'history_assets')

if __name__=='__main__':unittest.main()
