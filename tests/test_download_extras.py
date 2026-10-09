"""Download starts, early thumbnails and shared naming: temporary files, mocked network."""
import base64,copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,downloader,webui,model_manager,model_naming


class DownloadExtraTests(unittest.TestCase):
    def test_saved_concurrency_increase_starts_extra_workers(self):
        a=webui.Api.__new__(webui.Api);a.cfg=dict(config.DEFAULTS);a.dl=Mock();a._new_api=Mock()
        with patch.object(config,'save',return_value=True):
            self.assertTrue(a.save_config({'max_concurrent_downloads':5}));a.dl._ensure_workers.assert_called_once()
            a.dl._ensure_workers.reset_mock();self.assertTrue(a.save_config({'max_concurrent_downloads':1}));a.dl._ensure_workers.assert_not_called()
        self.assertEqual(a.dl.cfg['max_concurrent_downloads'],1)

    def test_start_only_selected_ids(self):
        a=webui.Api.__new__(webui.Api);a.dl=Mock();a.dl.tasks=[]
        for status in ['paused','paused','error','pending','done']:
            t=downloader.DownloadTask('fixture','',status);t.status=status;a.dl.tasks.append(t)
        a.dl_action('start',None,[a.dl.tasks[0].id,a.dl.tasks[2].id,a.dl.tasks[3].id])
        a.dl.resume_task.assert_called_once_with(a.dl.tasks[0]);a.dl.retry_task.assert_called_once_with(a.dl.tasks[2]);a.dl._ensure_workers.assert_called_once()

    def test_empty_start_not_all(self):
        a=webui.Api.__new__(webui.Api);a.dl=Mock();a.dl.tasks=[Mock(status='paused',id='x')]
        a.dl_action('start',None,[]);a.dl.resume_task.assert_not_called()

    def test_early_cover_cache_before_download_file_exists(self):
        with tempfile.TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            a=webui.Api.__new__(webui.Api);a.cfg=dict(config.DEFAULTS);a.dl=Mock();a.dl._lock=__import__('threading').Lock()
            t=downloader.DownloadTask('fixture','', 'missing.safetensors',info={'meta':{'info':{'images':[{'url':'https://example.invalid/cover'}]}}});a.dl.tasks=[t]
            a.get_cover_b64=Mock(return_value=base64.b64encode(b'jpeg fixture').decode());a._prefetch_task_cover(t)
            a.get_cover_b64.assert_called_once_with('https://example.invalid/cover',512,timeout=3)
            self.assertEqual(a.get_task_thumbnails([t.id])[t.id],base64.b64encode(b'jpeg fixture').decode())
            self.assertEqual(a.get_task_thumbnails(['unknown']),{})
            self.assertFalse((Path(d)/t.filename).exists())

    def test_cover_disabled_or_unavailable_never_blocks(self):
        a=webui.Api.__new__(webui.Api);a.cfg={'download_cover':False};a.get_cover_b64=Mock()
        t=downloader.DownloadTask('fixture','', 'a',info={'meta':{'info':{'images':[{'url':'fixture'}]}}});a._prefetch_task_cover(t);a.get_cover_b64.assert_not_called()
        a.cfg['download_cover']=True;a.get_cover_b64.side_effect=RuntimeError('timeout');a._prefetch_task_cover(t)

    def test_default_name_and_version_off(self):
        self.assertFalse(config.DEFAULTS['filename_include_version'])
        self.assertEqual(model_naming.download_name(config.DEFAULTS,{'name':'raw.safetensors'},'C Name','v1.2'),'raw.safetensors')

    def test_civitai_name_version_on_and_original_version_not_translated(self):
        cfg={**config.DEFAULTS,'download_name_mode':'civitai','filename_include_version':True}
        self.assertEqual(model_naming.download_name(cfg,{'name':'raw.safetensors'},'C Name','v1.2'),'C Name-v1.2.safetensors')
        cfg['download_name_mode']='chinese'
        with patch('translator.translate',return_value='水彩风格') as translate:
            self.assertEqual(model_naming.download_name(cfg,{'name':'raw.safetensors'},'Watercolor','Release v1.2'),'水彩风格-Release v1.2.safetensors')
            self.assertEqual(translate.call_args.args[0],'Watercolor')

    def test_translation_error_keeps_civitai_name(self):
        with patch('translator.translate',side_effect=RuntimeError('offline')):
            self.assertEqual(model_naming.download_name({'download_name_mode':'chinese'},{'name':'raw.gguf'},'Mountain','v1'),'Mountain.gguf')

    def test_distinct_variant_ids_preserve_unique_names(self):
        cfg={**config.DEFAULTS,'download_name_mode':'civitai','filename_include_version':True}
        names=[model_naming.download_name(cfg,{'id':i,'name':'raw.safetensors','metadata':{'fp':'int8'}},'Model','v1',True) for i in [1,2]]
        self.assertNotEqual(*names);self.assertTrue(all(n.endswith('-v1.safetensors') for n in names))

    def test_rename_preview_same_version_policy(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'raw.safetensors';p.write_bytes(b'fixture');meta={'name':'Watercolor','version':{'name':'v1.2'}}
            name,_=model_manager.rename_to_civitai(str(p),meta,dry_run=True,include_version=True)
            self.assertEqual(Path(name).name,'Watercolor-v1.2.safetensors');self.assertTrue(p.exists())

    def test_manual_rename_default_and_commit_version(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'raw.safetensors';p.write_bytes(b'fixture');p.with_suffix('.civitai.info').write_text(json.dumps({'name':'Mountain','version':{'name':'v1.2'}}))
            a=webui.Api.__new__(webui.Api);a.cfg={**config.DEFAULTS,'download_name_mode':'civitai','filename_include_version':True};a._relocate_model=Mock()
            self.assertEqual(a.get_rename_default(str(p)),'Mountain-v1.2.safetensors')
            self.assertTrue(a.rename_file(str(p),'Custom')['ok']);self.assertTrue((Path(d)/'Custom-v1.2.safetensors').exists())

    def test_version_appended_once_missing_not_invented(self):
        self.assertEqual(model_naming.append_version('Name-v1','v1',True),'Name-v1')
        self.assertEqual(model_naming.append_version('Name v1','v1',True),'Name-v1')
        self.assertEqual(model_naming.append_version('Name','',True),'Name')

    def test_legacy_chinese_preference_migrates_without_enabling_version(self):
        with tempfile.TemporaryDirectory() as d,patch.object(config,'CONFIG_PATH',str(Path(d)/'cfg.json')),patch.object(config,'_import_legacy'):
            Path(config.CONFIG_PATH).write_text(json.dumps({'translate_filename':True}));cfg=config.load()
            self.assertEqual(cfg['download_name_mode'],'chinese');self.assertFalse(cfg['filename_include_version'])


if __name__=='__main__':unittest.main()
