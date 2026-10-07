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
        for theme in ("dark_graphite", "dark_pink", "dark_rose"):
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
                self.assertEqual(config.load()["theme"], "light")

    def test_personalization_defaults(self):
        self.assertTrue(config.DEFAULTS['browser_fallback_enabled'])
        self.assertEqual(config.DEFAULTS['ui_mode'],'window')
        self.assertFalse(config.DEFAULTS['folder_picker_show_paths'])
        self.assertEqual(config.DEFAULTS['folder_picker_favorites'],[])
        self.assertEqual(config.DEFAULTS['folder_picker_folded'],[])
        self.assertEqual(config.DEFAULTS['ui_font'],'')
        self.assertEqual(config.DEFAULTS['masonry_card_width'],220)


if __name__ == "__main__":
    unittest.main()
