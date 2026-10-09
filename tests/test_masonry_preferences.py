import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config


class MasonryPreferencesTests(unittest.TestCase):
    def test_defaults_keep_existing_card_mode(self):
        self.assertEqual(config.DEFAULTS['masonry_info_mode'],'always')
        self.assertEqual(config.DEFAULTS['masonry_overlay_size'],'partial')

    def test_valid_options_and_invalid_fallback(self):
        for mode in ['always','slide','fade']:
            for size in ['partial','full']:
                cfg=copy.deepcopy(config.DEFAULTS);cfg.update(masonry_info_mode=mode,masonry_overlay_size=size);config.normalize_ui_preferences(cfg)
                self.assertEqual(cfg['masonry_info_mode'],mode);self.assertEqual(cfg['masonry_overlay_size'],size)
        cfg={'masonry_info_mode':'invalid','masonry_overlay_size':None};config.normalize_ui_preferences(cfg)
        self.assertEqual(cfg['masonry_info_mode'],'always');self.assertEqual(cfg['masonry_overlay_size'],'partial')


if __name__=='__main__':unittest.main()
