"""Large synthetic inventory; visibility must never reread disk metadata."""
import json,time,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import config,webui,model_filters

class ModelInventoryPerformanceTests(unittest.TestCase):
    def wait(self, api):
        deadline=time.monotonic()+15
        while api.get_scan_state()['running'] and time.monotonic()<deadline:time.sleep(.01)
        self.assertFalse(api.get_scan_state()['running'])
        self.assertNotIn('失败',api.get_scan_state()['msg'])

    def test_five_thousand_visibility_changes_use_cached_inventory(self):
        with TemporaryDirectory() as d:
            root=Path(d);info=root/'shared.info.json';info.write_text(json.dumps({'type':'LORA','baseModel':'Anima','name':'Synthetic'}),encoding='utf-8')
            files=[{'path':str(root/('A' if i%2 else 'B')/(str(i)+'.pt')),'rel':('A/' if i%2 else 'B/')+str(i)+'.pt','name':str(i)+'.pt','size':1,'mtime':1} for i in range(5000)]
            a=webui.Api.__new__(webui.Api);a.cfg=dict(config.DEFAULTS,models_dir=d,models_dirs=[d]);a.model_rows=[];a.mm_scan_state={'running':False,'rows':[],'msg':''}
            with patch.object(webui.model_manager,'scan_models',return_value=files),patch.object(webui.model_manager,'find_info_file',return_value=str(info)):
                self.assertTrue(a.scan_models()['started']);self.wait(a)
            self.assertEqual(len(json.loads(a.get_scan_rows())),5000)
            with patch.object(config,'save',return_value=True),patch.object(webui.model_manager,'scan_models',side_effect=AssertionError('visibility must not scan')),patch('builtins.open',side_effect=AssertionError('visibility must not read metadata')):
                for i in range(10):
                    self.assertTrue(a.save_folders(['A'] if i%2 else [],True,{'a':i%2==0}))
                    self.assertEqual(len(a.mm_scan_state['rows']),5000 if i%2==0 else 2500)
                a.save_folders([],True,{})
            self.assertEqual(len(a.model_rows),5000);self.assertEqual(len(json.loads(a.get_scan_rows())),5000)
            # A deliberate refresh reuses unchanged metadata but still enumerates files.
            with patch.object(webui.model_manager,'scan_models',return_value=files),patch.object(webui.model_manager,'find_info_file',return_value=str(info)),patch('builtins.open',side_effect=AssertionError('unchanged metadata must be reused')):
                a.scan_models();self.wait(a)
            self.assertEqual(len(a._model_scan_cache),5000)

    def test_folder_choices_compiled_once_for_bulk_filter(self):
        with patch.object(model_filters,'folder_choices',wraps=model_filters.folder_choices) as compile_choices:
            predicate=model_filters.visibility_predicate({'model_folder_visibility':{'a':False,'a/b':True}})
            for i in range(5000):self.assertEqual(predicate(('A/B/' if i%2 else 'A/')+str(i)+'.pt'),bool(i%2))
            self.assertEqual(compile_choices.call_count,1)

if __name__=='__main__':unittest.main()
