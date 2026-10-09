import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config


class NameScrollOptionsTests(unittest.TestCase):
    def test_faster_shorter_defaults(self):
        self.assertEqual([config.DEFAULTS[k] for k in ('name_scroll_speed', 'name_scroll_start_pause', 'name_scroll_end_pause')], [70, 350, 250])

    def test_user_preferences_and_zero_pause(self):
        cfg = {'name_scroll_speed': 120, 'name_scroll_start_pause': 100, 'name_scroll_end_pause': 0}
        config.normalize_ui_preferences(cfg)
        self.assertEqual([cfg[k] for k in ('name_scroll_speed', 'name_scroll_start_pause', 'name_scroll_end_pause')], [120, 100, 0])

    def test_limits(self):
        for raw, expected in [(-99, [10, 0, 0]), (999999, [240, 5000, 5000])]:
            cfg = dict.fromkeys(('name_scroll_speed', 'name_scroll_start_pause', 'name_scroll_end_pause'), raw)
            config.normalize_ui_preferences(cfg)
            self.assertEqual([cfg[k] for k in ('name_scroll_speed', 'name_scroll_start_pause', 'name_scroll_end_pause')], expected)

    def test_invalid_values_use_defaults(self):
        for raw in (None, 'invalid', float('inf'), [], {}):
            cfg = dict.fromkeys(('name_scroll_speed', 'name_scroll_start_pause', 'name_scroll_end_pause'), raw)
            config.normalize_ui_preferences(cfg)
            self.assertEqual([cfg[k] for k in ('name_scroll_speed', 'name_scroll_start_pause', 'name_scroll_end_pause')], [70, 350, 250])


if __name__ == '__main__': unittest.main()
