"""Bundled display asset and retirement of the old file-path override."""
from pathlib import Path
import unittest
from unittest.mock import patch
import config
from webui import Api

class DisplayFontTests(unittest.TestCase):
    def test_bundled_font_and_attribution(self):
        root = Path(__file__).resolve().parents[1]
        for name in ('HarmonyOS_Sans_SC_Regular.ttf', 'GeourceAltCHS-Regular.ttf'):
            self.assertEqual((root / 'web/fonts' / name).read_bytes()[:4], b'\x00\x01\x00\x00')
        self.assertFalse((root / 'web/fonts/URBANISM-Regular.ttf').exists())
        app = (root / 'web/app.js').read_text(encoding='utf-8')
        self.assertNotIn('随包字体 / terminator7211', app)
        self.assertIn('圆构黑体 Alt', app)
        self.assertIn('鸿蒙黑体 / HarmonyOS Sans', app)

    def test_old_override_is_removed_without_reading_file(self):
        cfg = {'endfield_display_font': 'old-private-font.ttf', 'ui_font_stack': ['Arial', 'Segoe UI'], 'ui_font': 'Arial'}
        with patch('builtins.open', side_effect=AssertionError('No old font file should be opened')):
            config.normalize_ui_preferences(cfg)
        self.assertNotIn('endfield_display_font', cfg)
        self.assertEqual(cfg['ui_font_stack'], ['Arial', 'Segoe UI'])
        self.assertEqual(cfg['ui_font'], 'Arial')
        self.assertNotIn('endfield_display_font', config.DEFAULTS)
        self.assertFalse(hasattr(Api, 'get_endfield_display_font'))

if __name__ == '__main__':
    unittest.main()
