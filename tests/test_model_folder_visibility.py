"""文件夹显隐只过滤显示，使用临时模型目录与配置。"""
import json,sys,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import webui,config

class ModelFolderVisibilityTests(unittest.TestCase):
    def fixture(self,d):
        root=Path(d);paths=[root/'root.safetensors',root/'Style'/'a.safetensors',root/'Style'/'Child'/'b.safetensors',root/'Other'/'c.safetensors']
        for p in paths:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'fixture model')
        api=webui.Api.__new__(webui.Api);api.cfg={'models_dir':str(root),'models_dirs':[str(root)]};api.model_rows=[{'path':str(p)} for p in paths];api.mm_scan_state={'rows':api.model_rows[:]};return api,paths
    def test_menu_lists_tree_and_saved_choices(self):
        with TemporaryDirectory() as d:
            api,paths=self.fixture(d);api.cfg.update(hidden_model_folders=['Style'],show_root_models=False);j=json.loads(api.get_folders());self.assertEqual(j['hidden'],['Style']);self.assertFalse(j['show_root']);self.assertEqual({n['name'] for n in j['tree']},{'Style','Other'})
    def test_parent_hide_includes_children_without_deleting_files(self):
        with TemporaryDirectory() as d,patch('config.save') as save:
            api,paths=self.fixture(d);self.assertTrue(api.save_folders(['Style'],True));self.assertEqual([r['path'] for r in api.mm_scan_state['rows']],[str(paths[0]),str(paths[3])]);self.assertTrue(all(p.exists() for p in paths));self.assertEqual(len(api.model_rows),4);save.assert_called_once_with(api.cfg)
    def test_hidden_folders_can_be_restored(self):
        with TemporaryDirectory() as d,patch('config.save'):
            api,paths=self.fixture(d);api.save_folders(['Style'],True);api.save_folders([],True);self.assertEqual(len(api.mm_scan_state['rows']),4)
    def test_root_visibility_independent_of_subfolders(self):
        with TemporaryDirectory() as d,patch('config.save'):
            api,paths=self.fixture(d);api.save_folders([],False);self.assertEqual(len(api.mm_scan_state['rows']),3);self.assertNotIn(str(paths[0]),[r['path'] for r in api.mm_scan_state['rows']])
    def test_save_failure_rolls_back_config_and_visible_rows(self):
        with TemporaryDirectory() as d,patch('config.save',side_effect=OSError('fixture readonly')):
            api,paths=self.fixture(d);old=dict(api.cfg);self.assertFalse(api.save_folders(['Style'],False));self.assertEqual(api.cfg,old);self.assertEqual(len(api.mm_scan_state['rows']),4)
    def test_atomic_writer_false_also_rolls_back(self):
        with TemporaryDirectory() as d,patch('config.save',return_value=False):
            api,paths=self.fixture(d);old=dict(api.cfg);self.assertFalse(api.save_folders(['Style'],False));self.assertEqual(api.cfg,old);self.assertEqual(len(api.mm_scan_state['rows']),4)
    def test_choices_round_trip_to_private_test_config(self):
        with TemporaryDirectory() as d:
            api,paths=self.fixture(d);cfgpath=Path(d)/'fixture.json'
            with patch('config.save',side_effect=lambda cfg:cfgpath.write_text(json.dumps(cfg),encoding='utf-8')):self.assertTrue(api.save_folders(['Style/Child'],False))
            api.cfg=json.loads(cfgpath.read_text(encoding='utf-8'));j=json.loads(api.get_folders());self.assertEqual(j['hidden'],['Style/Child']);self.assertFalse(j['show_root'])
if __name__=='__main__':unittest.main()
