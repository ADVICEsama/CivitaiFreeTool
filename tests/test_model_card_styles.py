import copy
import json
from pathlib import Path
import unittest
import config


class ModelCardStyleTests(unittest.TestCase):
    def test_defaults_and_opt_out(self):
        values = config.normalize_model_card_styles(None)
        self.assertEqual(set(values), set(config.MODEL_CARD_TYPES))
        self.assertEqual(values['Checkpoint']['glow'], 'gold')
        self.assertEqual(values['Unknown'], {'glow': 'none', 'frames': []})
        values = config.normalize_model_card_styles({'LORA': {'glow': 'none', 'frames': []}})
        self.assertEqual(values['LORA'], {'glow': 'none', 'frames': []})

    def test_whitelist_and_malformed_values(self):
        frame = next(iter(config.MODEL_CARD_FRAMES))
        values = config.normalize_model_card_styles({'LORA': {'glow': ['bad'], 'frames': [frame, frame, '../secret', '<script>', {}, 1]}, 'fake': {'glow': 'red'}})
        self.assertEqual(values['LORA'], {'glow': 'cyan', 'frames': [frame]})
        self.assertNotIn('fake', values)
        for value in [[], '', 123, {'VAE': []}, {'VAE': {'frames': 'all'}}]:
            self.assertEqual(len(config.normalize_model_card_styles(value)), 11)

    def test_base_specific_styles(self):
        values = config.normalize_model_card_styles({'base:MOSS': {'glow': 'red', 'frames': ['icon_user_avatar_frame_endfield_2']}, 'base:krea2': {'glow': 'none'}, 'base:anima': {'glow': 'violet'}})
        self.assertEqual(values['base:moss']['glow'], 'red')
        self.assertEqual(values['base:krea2']['glow'], 'none')
        self.assertEqual(values['base:anima']['glow'], 'violet')
        cfg = copy.deepcopy(config.DEFAULTS)
        cfg['pointer_effects'] = 'trail'
        cfg['pointer_effect_quality'] = 'high'
        config.normalize_ui_preferences(cfg)
        self.assertNotIn('pointer_effects', cfg)
        self.assertNotIn('pointer_effect_quality', cfg)

    def test_custom_glow_colors(self):
        values = config.normalize_model_card_styles({'base:MOSS': {'glow': '#23A7CC'}, 'LORA': {'glow': '#F012AB'}})
        self.assertEqual(values['base:moss']['glow'], '#23a7cc')
        self.assertEqual(values['LORA']['glow'], '#f012ab')
        for invalid in ['#fff', 'red; background:url(x)', '#12345678', None, [], '#zzzzzz']:
            self.assertEqual(config.normalize_model_card_styles({'base:moss': {'glow': invalid}})['base:moss']['glow'], 'none')

    def test_inner_glow_opacity(self):
        for raw, expected in [(0, 0), (35, 35), (100, 100), (-2, 0), (999, 100), ('bad', 100), (None, 100)]:
            cfg = copy.deepcopy(config.DEFAULTS)
            cfg['model_glow_opacity'] = raw
            config.normalize_ui_preferences(cfg)
            self.assertEqual(cfg['model_glow_opacity'], expected)

    def test_assets_and_frontend_catalog_match(self):
        web = Path(__file__).resolve().parents[1] / 'web'
        catalog = json.loads((web / 'model-card-catalog.js').read_text('utf-8').split('window.CFTModelCardCatalog=')[1].split(';')[0])
        self.assertEqual({v['id'] for v in catalog}, config.MODEL_CARD_FRAMES)
        self.assertEqual(len(catalog), 33)
        for frame in config.MODEL_CARD_FRAMES:
            self.assertTrue((web / 'model-frames' / (frame + '.png')).is_file())

    def test_ui_normalization_preserves_other_preferences(self):
        cfg = copy.deepcopy(config.DEFAULTS)
        cfg.update({'default_view': 'grid', 'model_card_styles': {'VAE': {'glow': 'green', 'frames': ['icon_user_avatar_frame_endfield_2']}}, 'models_dir': 'D:/Keep/Models'})
        config.normalize_ui_preferences(cfg)
        self.assertEqual(cfg['default_view'], 'grid')
        self.assertEqual(cfg['models_dir'], 'D:/Keep/Models')
        self.assertEqual(cfg['model_card_styles']['VAE']['glow'], 'green')
        cfg['default_view'] = 'unknown'
        config.normalize_ui_preferences(cfg)
        self.assertEqual(cfg['default_view'], 'waterfall')


if __name__ == '__main__':
    unittest.main()
