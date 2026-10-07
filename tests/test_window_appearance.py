"""DWM 属性计划与 API 回归；不更改用户真实窗口或系统设置。"""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from window_appearance import appearance_plan, colorref, WindowAppearance
import webui


class WindowAppearanceTests(unittest.TestCase):
    def test_colorref_is_bgr_not_rgb(self):
        self.assertEqual(colorref('#123456'), 0x563412)

    def test_invalid_color_rejected(self):
        for value in ('red', '#abc', 'rgba(0,0,0,0)', None):
            with self.assertRaises(ValueError): colorref(value)

    def test_theme_caption_uses_theme_and_retains_native_frame(self):
        plan = dict(appearance_plan({'mode': 'theme', 'background': '#112233', 'text': '#eeeeee'}))
        self.assertEqual(plan[35], 0x332211)
        self.assertEqual(plan[36], 0xeeeeee)
        self.assertEqual(plan[20], 1)
        self.assertEqual(plan[38], 1)

    def test_light_theme(self):
        self.assertEqual(dict(appearance_plan({'background': '#ffffff'}))[20], 0)

    def test_mica_does_not_override_caption_color(self):
        for mode, backdrop in (('mica', 2), ('mica_alt', 4)):
            plan = dict(appearance_plan({'mode': mode}))
            self.assertEqual(plan[35], 0xffffffff)
            self.assertEqual(plan[38], backdrop)

    def test_external_mode_leaves_tool_in_control(self):
        self.assertEqual(appearance_plan({'mode': 'external'}), [])
        self.assertEqual(appearance_plan({'mode': 'external'}, 'external'), [])
        self.assertEqual(dict(appearance_plan({'mode': 'external'}, 'theme'))[35], 0xffffffff)

    def test_unknown_mode_is_rejected(self):
        with self.assertRaises(ValueError): appearance_plan({'mode': 'arbitrary'})

    def test_browser_api_returns_limit_instead_of_success(self):
        api = webui.Api.__new__(webui.Api)
        self.assertFalse(api.set_window_appearance()['ok'])
        self.assertIn('浏览器', api.set_window_appearance()['msg'])

    def test_native_api_dispatches_and_reports_real_status(self):
        api = webui.Api.__new__(webui.Api)
        api._window_appearance_handler = Mock(return_value={'ok': True, 'queued': True})
        self.assertTrue(api.set_window_appearance({'mode': 'mica'})['queued'])
        api._window_appearance_handler.assert_called_once_with({'mode': 'mica'})
        api._window_appearance_controller = Mock(status={'ok': False, 'mode': 'mica', 'failed_attributes': [38]})
        self.assertFalse(api.get_window_appearance()['ok'])

    def test_bad_request_does_not_touch_native_form(self):
        controller = WindowAppearance(Mock())
        self.assertFalse(controller.request({'mode': 'bad'})['ok'])
        self.assertFalse(controller.request({'text': '<script>'})['ok'])


if __name__ == '__main__': unittest.main()
