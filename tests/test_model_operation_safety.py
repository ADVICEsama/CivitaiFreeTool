"""Rename/move/filter safety. All files are temporary and all network calls mocked."""
import copy,io,json,os,sys,threading,time,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image
import config,model_manager,reverse_parse,webui,downloader


class ModelOperationSafetyTests(unittest.TestCase):
    def api(self):
        a=webui.Api.__new__(webui.Api);a.cfg=copy.deepcopy(config.DEFAULTS);a.model_rows=[];a.mm_scan_state={'rows':[]};a.mm_progress={'running':False};a.rp_rows=[];a.dl=Mock();a.dl.tasks=[];a.dl.get_history.return_value=[];a._updates={'items':{}};a._save_updates=Mock();a._new_api=Mock();a._rp_state={'running':False};a._rp_launch_lock=threading.RLock();a._rp_stop_ev=threading.Event();a._rp_pause_ev=threading.Event();return a

    def bundle(self,root):
        p=Path(root)/'raw.safetensors';p.write_bytes(b'model contents');p.with_suffix('.info.json').write_text('{"name":"Title"}');images=Path(root)/'raw.images';images.mkdir();(images/'example.png').write_bytes(b'image contents');return p,images

    def test_civitai_version_rename_keeps_image_folder(self):
        with TemporaryDirectory() as d:
            p,images=self.bundle(d);new,msg=model_manager.rename_to_civitai(str(p),{'name':'Title','version':{'name':'v1'}},include_version=True)
            self.assertEqual(Path(new).name,'Title-v1.safetensors');self.assertEqual((Path(d)/'Title-v1.images/example.png').read_bytes(),b'image contents');self.assertFalse(images.exists());self.assertTrue(Path(new).with_suffix('.info.json').is_file())

    def test_image_folder_conflict_prevents_whole_rename(self):
        with TemporaryDirectory() as d:
            p,images=self.bundle(d);(Path(d)/'Title.images').mkdir();(Path(d)/'Title.images/keep.png').write_bytes(b'keep')
            new,msg=model_manager.rename_to_civitai(str(p),{'name':'Title'});self.assertEqual(new,str(p));self.assertTrue(p.exists());self.assertTrue(images.exists());self.assertEqual((Path(d)/'Title.images/keep.png').read_bytes(),b'keep')

    def test_image_rename_failure_rolls_back_model_and_sidecars(self):
        with TemporaryDirectory() as d:
            p,images=self.bundle(d);original=os.rename
            def fail_images(src,dst):
                if str(src).endswith('raw.images'):raise PermissionError('fixture locked images')
                return original(src,dst)
            with patch('model_manager.os.rename',side_effect=fail_images):new,msg=model_manager.rename_to_civitai(str(p),{'name':'Title'})
            self.assertEqual(new,str(p));self.assertEqual(p.read_bytes(),b'model contents');self.assertTrue(p.with_suffix('.info.json').exists());self.assertTrue(images.exists());self.assertFalse((Path(d)/'Title.safetensors').exists())

    def test_manual_rename_syncs_images_queue_and_scan_paths(self):
        with TemporaryDirectory() as d:
            p,images=self.bundle(d);a=self.api();row={'path':str(p),'name':p.name};a.model_rows=[row];a.mm_scan_state['rows']=[row];a.rp_rows=[{'path':str(p),'status':'等待'}];result=a.rename_file(str(p),'custom')
            self.assertTrue(result['ok']);self.assertEqual(row['path'],str(Path(d)/'custom.safetensors'));self.assertEqual(a.rp_rows[0]['path'],row['path']);self.assertTrue((Path(d)/'custom.images/example.png').exists());self.assertEqual(a._resolve_model_path(str(p)),row['path'])

    def test_move_after_version_rename_includes_images_and_sidecars(self):
        with TemporaryDirectory() as d:
            p,images=self.bundle(d);new,_=model_manager.rename_to_civitai(str(p),{'name':'Title','version':{'name':'v1'}},include_version=True);dest=Path(d)/'target';dest.mkdir();a=self.api();result=a.move_file_to(new,str(dest))
            self.assertTrue(result['ok']);self.assertTrue((dest/'Title-v1.images/example.png').exists());self.assertTrue((dest/'Title-v1.info.json').exists());self.assertFalse(Path(new).exists())

    def test_move_image_conflict_does_not_move_primary(self):
        with TemporaryDirectory() as d:
            p,images=self.bundle(d);dest=Path(d)/'target';dest.mkdir();(dest/'raw.images').mkdir();result=self.api().move_file_to(str(p),str(dest));self.assertFalse(result['ok']);self.assertTrue(p.exists());self.assertTrue(images.exists());self.assertFalse((dest/p.name).exists())

    def test_move_image_failure_rolls_back_all_companions(self):
        with TemporaryDirectory() as d:
            p,images=self.bundle(d);dest=Path(d)/'target';dest.mkdir();a=self.api();original=webui.shutil.move
            def fail_images(src,dst):
                if str(src)==str(images):raise PermissionError('fixture locked images')
                return original(src,dst)
            with patch('webui.shutil.move',side_effect=fail_images):result=a.move_file_to(str(p),str(dest))
            self.assertFalse(result['ok']);self.assertTrue(p.exists());self.assertTrue(p.with_suffix('.info.json').exists());self.assertTrue(images.exists());self.assertFalse((dest/p.name).exists());a.dl.relocate.assert_not_called()

    def test_alias_chain_and_path_dedup_no_filename_guess(self):
        with TemporaryDirectory() as d:
            a=self.api();one=Path(d)/'one.pt';two=Path(d)/'two.pt';three=Path(d)/'three.pt';three.write_bytes(b'fixture');a._relocate_model(str(one),str(two));a._relocate_model(str(two),str(three));a.rp_add_paths([str(one),str(three)]);self.assertEqual(len(a.rp_rows),1);self.assertEqual(a.rp_rows[0]['path'],str(three));self.assertEqual(a._resolve_model_path(str(Path(d)/'other.pt')),str(Path(d)/'other.pt'))

    def test_missing_reverse_paths_report_without_hash_or_network(self):
        a=self.api();a.rp_add_paths(['missing-fixture.pt']);self.assertEqual(a.rp_rows[0]['status'],'文件不存在')
        with patch('reverse_parse.reverse_by_hash') as lookup:
            self.assertTrue(a.rp_start())
            for _ in range(100):
                if not a._rp_state.get('running'):break
                time.sleep(.01)
            lookup.assert_not_called();self.assertEqual(a.rp_rows[0]['status'],'文件不存在');self.assertEqual(a._rp_state['done'],1)

    def test_reverse_missing_file_friendly_error(self):
        api=Mock();result=reverse_parse.reverse_by_hash('missing-fixture.pt',api,{})
        self.assertFalse(result['found']);self.assertIn('改名',result['error']);api.get_model_version_by_hash.assert_not_called()

    def test_update_cache_follows_relocation_and_omits_missing_paths(self):
        with TemporaryDirectory() as d:
            a=self.api();old=str(Path(d)/'old.pt');new=Path(d)/'new.pt';new.write_bytes(b'fixture');a.cfg.update(models_dir=d,models_dirs=[d]);a._updates={'items':{old:{'_enr':1,'has_update':True},str(Path(d)/'deleted.pt'):{'_enr':1}}};a._relocate_model(old,str(new));items=a.get_model_updates()['items'];self.assertEqual(set(items),{str(new)});self.assertTrue(items[str(new)]['has_update']);a._save_updates.assert_called_once()

    def test_invalid_selected_paths_never_fall_back_to_all_models(self):
        a=self.api();a.model_rows=[{'path':str(Path.cwd()/'kept.pt'),'info':{}}]
        for method in ['mm_rename','mm_localize','mm_organize','mm_cleanup','mm_download_covers','mm_translate_descs']:
            with self.subTest(method=method),patch('webui.threading.Thread') as thread:
                self.assertFalse(getattr(a,method)(['unknown.pt'])['started']);thread.assert_not_called()

    def test_hover_uses_high_resolution_local_cover_not_small_task_cache(self):
        with TemporaryDirectory() as d:
            a=self.api();p=Path(d)/'model.pt';p.write_bytes(b'fixture');Image.new('RGB',(1800,1200),'blue').save(p.with_suffix('.preview.png'));task=Mock(id='one',dest_dir=d,filename='model.pt',info={});a.dl.tasks=[task]
            image=a.get_task_hover_cover('one');import base64
            with Image.open(io.BytesIO(base64.b64decode(image))) as im:self.assertEqual(im.size,(1536,1024))
            self.assertEqual(a.get_task_hover_cover('unknown'),'')

    def test_completed_only_removal_preserves_other_states_and_history(self):
        with TemporaryDirectory() as d,patch('config.load_history',return_value=[]):
            p=Path(d)/'done.pt';p.write_bytes(b'keep model')
            manager=downloader.Downloader({});manager.save_tasks=Mock(return_value=True)
            for status in ['done','error','canceled','paused','pending','downloading']:
                task=downloader.DownloadTask('fixture.invalid',d,status+'.pt');task.status=status;manager.tasks.append(task)
                manager._record_history(task)
            before=copy.deepcopy(manager.history);self.assertTrue(manager.clear_completed())
            self.assertEqual([t.status for t in manager.tasks],['error','canceled','paused','pending','downloading']);self.assertEqual(manager.history,before);self.assertEqual(p.read_bytes(),b'keep model')

    def test_in_progress_retry_never_appears_as_failed_history(self):
        with TemporaryDirectory() as d:
            a=self.api();a._history_migration_started=True;a.dl.persistence_error='';a.dl._active_ids=set()
            t=Mock(id='retry',status='downloading');a.dl.tasks=[t];a.dl.get_history.return_value=[{'id':'retry','status':'error','filename':'retry.pt','dest_dir':d},{'id':'done','status':'done','filename':'done.pt','dest_dir':d}]
            self.assertEqual([r['id'] for r in a.get_download_history()['items']],['done'])
            t.status='error';self.assertEqual(len(a.get_download_history()['items']),2)
            a.dl._active_ids={'retry'};self.assertEqual(len(a.get_download_history()['items']),1)


if __name__=='__main__':unittest.main()
