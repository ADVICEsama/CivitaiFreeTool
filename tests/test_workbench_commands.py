"""单模型反查、资源链接与下载管理：临时模型与 mock，不联网、不操作用户文件。"""
import copy,json,threading,time,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,webui,downloader,image_gallery
class FeatureTests(unittest.TestCase):
    def api(self):
        a=webui.Api.__new__(webui.Api);a.cfg=copy.deepcopy(config.DEFAULTS);a.model_rows=[];a.api=Mock();a._new_api=Mock(return_value=Mock());a.open_url=Mock();a.rp_rows=[];a._rp_state={'running':False};a._rp_launch_lock=threading.RLock();a._rp_stop_ev=threading.Event();a._rp_pause_ev=threading.Event();return a
    def wait(self,a):
        end=time.monotonic()+3
        while a._rp_state.get('running') and time.monotonic()<end:time.sleep(.01)
        self.assertFalse(a._rp_state.get('running'))
    def result(self,p):return {'sha256':'a'*64,'found':True,'model':{'name':'Fixture Civitai name'},'version':{'name':'v1'},'info_path':str(p.with_suffix('.info.json'))}
    def test_detail_starts_only_current_not_pending_queue(self):
        with tempfile.TemporaryDirectory() as d:
            a=self.api();one=Path(d)/'one.safetensors';two=Path(d)/'two.safetensors';one.write_bytes(b'a');two.write_bytes(b'b');a.rp_add_paths([str(two)]);seen=[]
            with patch('reverse_parse.reverse_by_hash',side_effect=lambda path,*args,**kw:(seen.append(path) or self.result(Path(path)))):
                self.assertTrue(a.rp_identify_model(str(one))['started']);self.wait(a)
            self.assertEqual(seen,[str(one)]);self.assertEqual(a.rp_rows[0]['status'],'等待');self.assertEqual(a._rp_state['total'],1)
    def test_batch_still_processes_all_queued_models(self):
        a=self.api();a.rp_add_paths(['fixture-one','fixture-two'])
        with patch('reverse_parse.reverse_by_hash',side_effect=lambda path,*args,**kw:self.result(Path(path))) as lookup:
            self.assertTrue(a.rp_start());self.wait(a);self.assertEqual(lookup.call_count,2)
    def test_busy_detail_does_not_append_or_restart(self):
        with tempfile.TemporaryDirectory() as d:
            a=self.api();p=Path(d)/'fixture.safetensors';p.write_bytes(b'a');a._rp_state['running']=True;self.assertFalse(a.rp_identify_model(str(p))['started']);self.assertEqual(a.rp_rows,[])
    def test_missing_file_does_not_start(self):self.assertFalse(self.api().rp_identify_model('fixture-missing.safetensors')['started'])
    def test_failure_terminates_and_records_result(self):
        a=self.api();a.rp_add_paths(['fixture'])
        with patch('reverse_parse.reverse_by_hash',side_effect=RuntimeError('fixture network failure')):
            self.assertTrue(a.rp_start(['fixture']));self.wait(a);self.assertEqual(a.rp_rows[0]['status'],'失败');self.assertIn('fixture network',a.rp_rows[0]['model'])
    def test_hash_progress_and_refreshed_model_row(self):
        with tempfile.TemporaryDirectory() as d:
            a=self.api();p=Path(d)/'model.safetensors';p.write_bytes(b'fixture');info={'name':'New Civitai name','creator':{'username':'Demo author'},'modelId':8,'version':{'name':'v2'},'trainedWords':['fixture']};p.with_suffix('.info.json').write_text(json.dumps(info),encoding='utf-8');a.model_rows=[{'path':str(p),'name':p.name}];progress=[]
            def lookup(path,*args,**kw):kw['progress_cb'](5,10);progress.append(a._rp_state['progress']);return self.result(p)
            with patch('reverse_parse.reverse_by_hash',side_effect=lookup):self.assertTrue(a.rp_identify_model(str(p))['started']);self.wait(a)
            self.assertEqual(progress,[45]);self.assertEqual(a.model_rows[0]['civitai_name'],'New Civitai name');self.assertEqual(a.model_rows[0]['author'],'Demo author');self.assertEqual(a._rp_state['progress'],100)
    def test_running_queue_cannot_be_cleared(self):
        a=self.api();a.rp_rows=[{'path':'fixture'}];a._rp_state['running']=True;self.assertFalse(a.rp_clear());self.assertEqual(len(a.rp_rows),1)
    def test_resources_follow_site_and_versions(self):
        a=self.api();a.api.get_model_version.return_value={'modelId':8};self.assertTrue(a.open_gallery_resource({'modelVersionId':17})['direct']);a.open_url.assert_called_with('https://civitai.red/model-versions/17');a.api.get_model_version.assert_not_called();a.cfg['site_domain']='civitai.com';a.open_gallery_resource({'modelId':8});a.open_url.assert_called_with('https://civitai.com/models/8')
    def test_resource_version_route_works_without_api_lookup(self):
        a=self.api();a.api.get_model_version.side_effect=RuntimeError('fixture network');r=a.open_gallery_resource({'modelVersionId':17,'name':'17'});self.assertTrue(r['direct']);a.open_url.assert_called_with('https://civitai.red/model-versions/17');a.api.get_model_version.assert_not_called()
    def test_numeric_name_is_not_assumed_model_id(self):
        a=self.api();self.assertFalse(a.open_gallery_resource({'name':'12345'})['ok']);a.open_url.assert_not_called()
    def test_resource_original_model_url_and_air_are_direct(self):
        a=self.api();a.open_gallery_resource({'url':'https://civitai.com/models/8/demo?modelVersionId=17'});a.open_url.assert_called_with('https://civitai.red/models/8?modelVersionId=17');a.open_gallery_resource({'air':'urn:air:sdxl:lora:civitai:9@19'});a.open_url.assert_called_with('https://civitai.red/models/9?modelVersionId=19');a.api.get_model_version.assert_not_called()
    def test_existing_local_version_mapping_works_offline(self):
        a=self.api();a.model_rows=[{'verId':17,'modelId':8}];a.open_gallery_resource({'modelVersionId':17});a.open_url.assert_called_with('https://civitai.red/models/8?modelVersionId=17');a.api.get_model_version.assert_not_called()
    def test_civitai_resource_ids_preferred_over_plain_names(self):
        result=image_gallery.generation({'meta':{'resources':[{'name':'17'}],'civitaiResources':[{'modelVersionId':17}]}});self.assertEqual(result['resources'],[{'modelVersionId':17}])
    def test_png_parameters_resource_block_parsed(self):
        result=image_gallery.generation({'meta':{'parameters':'landscape\nNegative prompt: blur\nSteps: 25, Civitai resources: [{"modelVersionId":17,"type":"lora"}]'}});self.assertEqual(result['resources'][0]['modelVersionId'],17)
    def test_site_default_and_shortcuts_default_off(self):
        self.assertEqual(config.DEFAULTS['site_domain'],'civitai.red');self.assertIs(config.DEFAULTS['shortcuts_enabled'],False)
    def test_shortcut_preferences_normalized(self):
        cfg={'shortcuts_enabled':'false','shortcuts_preset':'bad','shortcuts_bindings':{'model:favorite':'Ctrl+F','invalid':9}};config.normalize_ui_preferences(cfg);self.assertFalse(cfg['shortcuts_enabled']);self.assertEqual(cfg['shortcuts_preset'],'arrows');self.assertEqual(cfg['shortcuts_bindings'],{'model:favorite':'Ctrl+F'})
    def test_pause_all_and_remove_all_use_snapshot(self):
        a=self.api();tasks=[Mock(id='a',filename='same'),Mock(id='b',filename='same')];a.dl=Mock(tasks=tasks)
        a.dl_action('pause_all');self.assertEqual(a.dl.pause_task.call_count,2)
        a.dl.remove_task.side_effect=lambda t:tasks.remove(t);a.dl_action('remove_all');self.assertEqual(a.dl.remove_task.call_count,2);self.assertEqual(tasks,[])
    def test_selected_task_ids_do_not_pause_same_named_other_task(self):
        a=self.api();first=Mock(id='a',filename='same');second=Mock(id='b',filename='same');a.dl=Mock(tasks=[first,second]);a.dl_action('pause',None,['b']);a.dl.pause_task.assert_called_once_with(second)
    def test_empty_selection_does_not_apply_to_every_task(self):
        a=self.api();a.dl=Mock(tasks=[Mock(id='a',filename='same')]);a.dl_action('remove',None,[]);a.dl.remove_task.assert_not_called()
    def test_archive_only_accepts_ended_task(self):
        a=self.api();task=Mock(id='a',status=downloader.ST_DOWNLOADING);a.dl=Mock(tasks=[task]);self.assertFalse(a.archive_download_task('a')['ok']);a.dl.remove_task.assert_not_called();task.status=downloader.ST_DONE;self.assertTrue(a.archive_download_task('a')['ok'])
    def test_settings_dirty_flag_is_boolean_only(self):
        a=self.api();self.assertTrue(a.set_settings_dirty(True));self.assertTrue(a._settings_dirty);a.set_settings_dirty(False);self.assertFalse(a._settings_dirty)
    def test_config_save_failure_rolls_back_in_memory(self):
        a=self.api();old=copy.deepcopy(a.cfg)
        with patch('config.save',return_value=False):self.assertFalse(a.save_config({'theme':'dark_rose'}))
        self.assertEqual(a.cfg,old)
if __name__=='__main__':unittest.main()
