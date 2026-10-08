"""三档列表偏好仅使用临时配置，不读取用户模型或账号。"""
import copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config
class ModelListSizeTests(unittest.TestCase):
    def test_default_and_legacy_keep_current_maximum(self):
        self.assertEqual(config.DEFAULTS['model_list_size'],3)
        with tempfile.TemporaryDirectory() as d,patch.object(config,'CONFIG_PATH',str(Path(d)/'config.json')),patch.object(config,'_import_legacy'):
            Path(config.CONFIG_PATH).write_text(json.dumps({'theme':'dark_blue'}),encoding='utf-8');self.assertEqual(config.load()['model_list_size'],3)
    def test_three_sizes_round_trip(self):
        with tempfile.TemporaryDirectory() as d,patch.object(config,'CONFIG_PATH',str(Path(d)/'config.json')),patch.object(config,'_import_legacy'):
            for size in [1,2,3]:
                cfg=copy.deepcopy(config.DEFAULTS);cfg['model_list_size']=size;self.assertTrue(config.save(cfg));self.assertEqual(config.load()['model_list_size'],size)
    def test_invalid_values_are_bounded_or_defaulted(self):
        for raw,want in [(0,1),(-7,1),(4,3),(99,3),('2',2),('bad',3),(None,3),(float('nan'),3),(float('inf'),3),({},3)]:
            with self.subTest(raw=raw):
                cfg={'model_list_size':raw};config.normalize_ui_preferences(cfg);self.assertEqual(cfg['model_list_size'],want)
    def test_normalization_does_not_change_other_size_preferences(self):
        cfg={'model_list_size':2,'ui_zoom':125,'ui_text_size':'huge','masonry_card_width':320};config.normalize_ui_preferences(cfg);self.assertEqual({k:cfg[k] for k in ['ui_zoom','ui_text_size','masonry_card_width']},{'ui_zoom':125,'ui_text_size':'huge','masonry_card_width':320})
if __name__=='__main__':unittest.main()
