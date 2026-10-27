"""外观配置回归：使用临时配置，禁止导入个人配置。"""
import copy
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config


class AppearanceConfigTests(unittest.TestCase):
    def test_new_themes_round_trip(self):
        for theme in ("dark_endfield", "light_endfield"):
            with self.subTest(theme=theme), tempfile.TemporaryDirectory() as tmp:
                with patch.object(config, "CONFIG_PATH", os.path.join(tmp, "config.json")), patch.object(config, "_import_legacy"):
                    cfg = copy.deepcopy(config.DEFAULTS)
                    cfg.update(theme=theme, show_file_paths=False, custom_accent_enabled=True,
                               custom_accent="#f0a4c5", ui_density="compact", ui_corners="square",
                               folder_picker_size={"width": 0.7, "height": 0.8})
                    self.assertTrue(config.save(cfg))
                    actual = config.load()
                    for key in ("theme", "show_file_paths", "custom_accent_enabled", "custom_accent",
                                "ui_density", "ui_corners", "folder_picker_size"):
                        self.assertEqual(actual[key], cfg[key])

    def test_legacy_defaults_and_themes(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = os.path.join(tmp, "config.json")
            with patch.object(config, "CONFIG_PATH", f), patch.object(config, "_import_legacy"):
                for theme in config.THEMES:
                    with open(f, "w", encoding="utf-8") as fp:
                        json.dump({"theme": theme}, fp)
                    cfg = config.load()
                    self.assertEqual(cfg["theme"], theme)
                    self.assertTrue(cfg["show_file_paths"])
                    self.assertFalse(cfg["custom_accent_enabled"])
                with open(f, "w", encoding="utf-8") as fp:
                    json.dump({"dark_mode": False}, fp)
                self.assertEqual(config.load()["theme"], "light_endfield")

    def test_personalization_defaults(self):
        self.assertTrue(config.DEFAULTS['browser_fallback_enabled'])
        self.assertEqual(config.DEFAULTS['ui_mode'],'window')
        self.assertFalse(config.DEFAULTS['folder_picker_show_paths'])
        self.assertEqual(config.DEFAULTS['folder_picker_favorites'],[])
        self.assertEqual(config.DEFAULTS['folder_picker_folded'],[])
        self.assertEqual(config.DEFAULTS['ui_font'],'')
        self.assertEqual(config.DEFAULTS['masonry_card_width'],220)

    def test_only_endfield_themes_and_legacy_migration(self):
        self.assertEqual(config.THEMES, ('dark_endfield', 'light_endfield'))
        self.assertEqual(config.DEFAULTS['theme'], 'dark_endfield')
        cases = [('dark_rose', {}, 'dark_endfield'), ('light_glass', {}, 'light_endfield'),
                 ('modern', {}, 'light_endfield'), ('metro', {'ui_scheme':'dark'}, 'dark_endfield'),
                 ('metro', {'ui_scheme':'auto'}, 'light_endfield'), ('unknown', {}, 'dark_endfield'),
                 ('', {'dark_mode':False}, 'light_endfield')]
        for old, extras, expected in cases:
            with self.subTest(old=old, extras=extras):
                cfg = dict(theme=old, download_hud_theme='light_glass', keep='unchanged', **extras)
                config.normalize_theme_preferences(cfg)
                self.assertEqual(cfg['theme'], expected)
                self.assertEqual(cfg['download_hud_theme'], 'light_endfield')
                self.assertEqual(cfg['keep'], 'unchanged')
                self.assertNotIn('ui_scheme', cfg)
                self.assertNotIn('dark_mode', cfg)

    def test_save_migrates_without_mutating_caller(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = os.path.join(tmp, 'config.json')
            cfg = {'theme':'light_pink', 'download_hud_theme':'dark_glass', 'ui_scheme':'dark', 'keep':42}
            before = dict(cfg)
            with patch.object(config, 'CONFIG_PATH', file):
                self.assertTrue(config.save(cfg))
            self.assertEqual(cfg, before)
            with open(file, encoding='utf-8') as source:
                saved = json.load(source)
            self.assertEqual(saved['theme'], 'light_endfield')
            self.assertEqual(saved['download_hud_theme'], 'dark_endfield')
            self.assertEqual(saved['keep'], 42)

    def test_native_theme_registry_is_endfield_only(self):
        import ui
        self.assertEqual(set(ui.THEMES), set(config.THEMES))
        self.assertEqual(set(ui.THEME_LABELS), set(config.THEMES))
        self.assertEqual(ui.DARK['primary'], '#ffef01')
        self.assertEqual(ui.LIGHT['primary'], '#ffef01')


if __name__ == "__main__":
    unittest.main()
