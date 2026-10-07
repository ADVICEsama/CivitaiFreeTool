"""数据目录迁移隔离回归：临时目录、假配置，绝不迁移正式软件数据。"""
from pathlib import Path
import json, os, sys, tempfile, unittest
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import data_storage as storage
import config, downloader, webui

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        assert self.root.is_relative_to(Path(tempfile.gettempdir()).resolve())
        self.source=self.root/'exe';self.source.mkdir();self.target=self.root/'personal-data'
        self.global_record=self.root/'profile'/storage.RECORD_NAME
        self.patcher=patch.object(storage,'global_record_path',return_value=self.global_record);self.patcher.start()
        self.addCleanup(self.patcher.stop);self.addCleanup(self.temp.cleanup)
        (self.source/'user_config.json').write_text(json.dumps({'fixture':'test','ui_font':'Segoe UI'}),encoding='utf-8')
        (self.source/'download_history.json').write_text('[{"id":"fixture"}]',encoding='utf-8')
        (self.source/'history_assets').mkdir();(self.source/'history_assets/thumb.jpg').write_bytes(b'cache fixture')
        (self.source/'model.safetensors').write_bytes(b'model must not move')
        (self.source/'CivitaiFreeToolWeb.exe').write_bytes(b'exe must not move')
    def migrate(self,**kwargs):return storage.migrate(self.source,self.target,self.source,**kwargs)
    def test_default_is_exe_directory(self):
        self.assertEqual(storage.resolve_directory(self.source),(str(self.source),''))
    def test_copy_keeps_original_and_excludes_models_and_exe(self):
        result=self.migrate(use_global=True);self.assertTrue(result['ok'])
        self.assertEqual((self.target/'history_assets/thumb.jpg').read_bytes(),b'cache fixture')
        self.assertTrue((self.source/'user_config.json').exists());self.assertTrue((self.source/'model.safetensors').exists())
        self.assertFalse((self.target/'model.safetensors').exists());self.assertFalse((self.target/'CivitaiFreeToolWeb.exe').exists())
    def test_restart_and_lost_exe_locator_recover_from_personal_record(self):
        self.migrate(use_global=True)
        self.assertEqual(storage.resolve_directory(self.source,True)[0],str(self.target))
        (self.source/storage.RECORD_NAME).unlink()
        self.assertEqual(storage.resolve_directory(self.source,True)[0],str(self.target))
    def test_developer_run_does_not_load_global_install_data(self):
        self.migrate(use_global=True);(self.source/storage.RECORD_NAME).unlink()
        self.assertEqual(storage.resolve_directory(self.source,False)[0],str(self.source))
    def test_missing_custom_directory_falls_back_with_warning(self):
        self.migrate();self.target.rename(self.root/'removed-data')
        result=storage.resolve_directory(self.source);self.assertEqual(result[0],str(self.source));self.assertTrue(result[1])
    def test_collision_requires_confirmation_and_keeps_destination_backup(self):
        self.target.mkdir();(self.target/'user_config.json').write_text('{"old":true}',encoding='utf-8')
        result=self.migrate();self.assertTrue(result['need_confirm'])
        self.assertEqual(json.loads((self.target/'user_config.json').read_text())['old'],True)
        result=self.migrate(replace_existing=True);self.assertTrue(result['ok'])
        self.assertEqual(json.loads((Path(result['backup'])/'user_config.json').read_text())['old'],True)
    def test_write_failure_rolls_back_target_and_location(self):
        self.target.mkdir();(self.target/'user_config.json').write_text('{"old":true}',encoding='utf-8')
        with patch.object(storage,'_atomic_record',side_effect=PermissionError('fixture denied')):result=self.migrate(replace_existing=True)
        self.assertFalse(result['ok']);self.assertTrue(json.loads((self.target/'user_config.json').read_text())['old'])
        self.assertFalse((self.source/storage.RECORD_NAME).exists())
    def test_copy_failure_does_not_switch_or_overwrite(self):
        with patch.object(storage.shutil,'copy2',side_effect=OSError('fixture copy failed')):result=self.migrate()
        self.assertFalse(result['ok']);self.assertFalse((self.source/storage.RECORD_NAME).exists());self.assertTrue((self.source/'user_config.json').exists())
    def test_readonly_exe_locator_can_use_personal_locator(self):
        original=storage._atomic_record
        def save(path,data):
            if Path(path).parent==self.source:raise PermissionError('readonly exe')
            return original(path,data)
        with patch.object(storage,'_atomic_record',side_effect=save):result=self.migrate(use_global=True)
        self.assertTrue(result['ok']);self.assertTrue(result['locator_warning'])
        self.assertEqual(storage.resolve_directory(self.source,True)[0],str(self.target))
    def test_reject_relative_nested_and_root_targets(self):
        for target in ['relative-folder',self.source/'child',self.root,Path(self.root.anchor)]:
            self.assertFalse(storage.migrate(self.source,target,self.source)['ok'])
    def test_newer_personal_locator_overrides_stale_exe_locator(self):
        self.migrate(use_global=True)
        record=json.loads(self.global_record.read_text());record.update(data_dir=str(self.source),updated_at=record['updated_at']+1)
        storage._atomic_record(self.global_record,record)
        self.assertEqual(storage.resolve_directory(self.source,True)[0],str(self.source))
    def test_memory_snapshot_is_used_instead_of_stale_disk(self):
        result=self.migrate(snapshot={'user_config.json':{'fixture':'latest'},'download_tasks.json':[{'id':'new'}]})
        self.assertTrue(result['ok']);self.assertEqual(json.loads((self.target/'user_config.json').read_text())['fixture'],'latest')
        self.assertEqual(json.loads((self.target/'download_tasks.json').read_text())[0]['id'],'new')
        self.assertEqual(json.loads((self.source/'user_config.json').read_text())['fixture'],'test')
    def test_snapshot_path_cannot_escape_target(self):
        self.assertFalse(self.migrate(snapshot={'../outside.json':{}})['ok'])
    def test_same_directory_is_noop(self):
        result=storage.migrate(self.source,self.source,self.source);self.assertTrue(result['ok']);self.assertFalse(result['changed'])
    def test_symlink_data_not_followed(self):
        with patch.object(storage,'_is_link',side_effect=lambda path:Path(path).name=='history_assets'):
            self.assertFalse(self.migrate()['ok'])
    def test_api_rejects_busy_work_and_switches_paths_when_idle(self):
        patchers=[patch.object(config,'APP_DIR',str(self.source)),patch.object(config,'INSTALL_DIR',str(self.source)),
                  patch.object(config,'CONFIG_PATH',str(self.source/'user_config.json')),patch.object(config,'TASKS_PATH',str(self.source/'download_tasks.json')),
                  patch.object(config,'HISTORY_PATH',str(self.source/'download_history.json')),patch.object(downloader.Downloader,'_ensure_workers')]
        for p in patchers:p.start();self.addCleanup(p.stop)
        api=webui.Api.__new__(webui.Api);api.cfg={'fixture':'live'};api.dl=downloader.Downloader(api.cfg)
        api.mm_progress={};api.mm_scan_state={};api._rp_state={}
        task=downloader.DownloadTask('https://example.invalid',str(self.source),'fake.safetensors');api.dl.tasks.append(task)
        self.assertFalse(api.migrate_data_storage(str(self.target))['ok'])
        task.status=downloader.ST_PAUSED
        result=api.migrate_data_storage(str(self.target));self.assertTrue(result['ok'])
        self.assertEqual(config.CONFIG_PATH,str(self.target/'user_config.json'))
        self.assertEqual(json.loads((self.target/'download_tasks.json').read_text())[0]['id'],task.id)
        self.assertTrue((self.source/'user_config.json').exists());self.assertFalse(api._storage_migrating)

    def test_detail_cache_write_follows_location_changed_during_fetch(self):
        import io,base64
        from PIL import Image
        from unittest.mock import Mock
        patchers=[patch.object(config,'APP_DIR',str(self.source)),patch.object(config,'INSTALL_DIR',str(self.source)),
                  patch.object(config,'CONFIG_PATH',str(self.source/'user_config.json')),patch.object(config,'TASKS_PATH',str(self.source/'tasks.json')),
                  patch.object(config,'HISTORY_PATH',str(self.source/'history.json')),patch.object(downloader.Downloader,'_ensure_workers')]
        for p in patchers:p.start();self.addCleanup(p.stop)
        api=webui.Api.__new__(webui.Api);api.cfg={'cache_detail_images':True};api.dl=downloader.Downloader(api.cfg)
        api.mm_progress={};api.mm_scan_state={};api._rp_state={}
        buf=io.BytesIO();Image.new('RGB',(80,80),'red').save(buf,'PNG')
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        def payload(*args):
            self.assertTrue(api.migrate_data_storage(str(self.target))['ok'])
            return buf.getvalue()
        response.read.side_effect=payload;opener=Mock();opener.open.return_value=response
        with patch('urllib.request.build_opener',return_value=opener):self.assertTrue(api.get_cover_b64('https://example.invalid/image.jpg'))
        self.assertTrue(Path(api._detail_cache_path('https://example.invalid/image.jpg')).is_relative_to(self.target))
        self.assertTrue(Path(api._detail_cache_path('https://example.invalid/image.jpg')).exists())
    def test_history_cache_worker_not_started_during_data_migration(self):
        api=webui.Api.__new__(webui.Api);api._storage_migrating=True
        api.dl=SimpleNamespace(get_history=lambda:[],persistence_error='')
        with patch.object(webui.threading,'Thread') as thread:
            self.assertEqual(api.get_download_history()['items'],[]);thread.assert_not_called()

if __name__=='__main__':unittest.main()
