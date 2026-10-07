"""DWM 属性计划与 API 回归；不更改用户真实窗口或系统设置。"""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import types
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

    def test_integrated_modes_suppress_dwm_border(self):
        for mode in ['theme','mica','mica_alt']:
            self.assertEqual(dict(appearance_plan({'mode':mode}))[34],0xfffffffe)
        self.assertEqual(dict(appearance_plan({'mode':'system'}))[34],0xffffffff)

    def test_resize_validation_and_dispatch(self):
        c=WindowAppearance(types.SimpleNamespace(native=None));self.assertFalse(c.resize('bottom-right')['ok'])
        c.chrome=types.SimpleNamespace(frame=types.SimpleNamespace(BeginResize=Mock()))
        c.window.native=types.SimpleNamespace(BeginInvoke=lambda action:action())
        system=types.ModuleType('System');system.Action=lambda action:action
        with patch.dict(sys.modules,{'System':system}):
            self.assertFalse(c.resize('unsafe')['ok']);self.assertTrue(c.resize('bottom-right')['queued']);c.chrome.frame.BeginResize.assert_called_once_with(8)

    def test_native_frame_has_no_permanent_thickframe(self):
        source=(Path(__file__).resolve().parents[1]/'native/CftChrome.cs').read_text(encoding='utf-8')
        constructor=source[source.index('public Frame('):source.index('public void Refresh')]
        self.assertIn('~0x00c40000',constructor);self.assertNotIn('|0x00040000',constructor)
        self.assertIn('WM_GETMINMAXINFO',source);self.assertNotIn('StructureToPtr(v.Work,m.LParam',source)

    def test_native_resize_restores_frameless_style(self):
        source=(Path(__file__).resolve().parents[1]/'native/CftChrome.cs').read_text(encoding='utf-8')
        self.assertIn('finally{if(Handle!=IntPtr.Zero)',source)
        self.assertIn('GetWindowLong(Handle,-16)&~0x00040000',source)

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

    def test_window_control_rejects_unknown_and_browser_mode(self):
        self.assertFalse(WindowAppearance(Mock()).control('move-anywhere')['ok'])
        self.assertFalse(WindowAppearance(types.SimpleNamespace(native=None)).control('minimize')['ok'])
        self.assertFalse(webui.Api.__new__(webui.Api).window_control('close')['ok'])

    def test_window_buttons_queue_on_ui_thread_and_keep_close_handler(self):
        form=types.SimpleNamespace(WindowState='normal',Close=Mock())
        form.BeginInvoke=lambda action:action()
        c=WindowAppearance(types.SimpleNamespace(native=form))
        system=types.ModuleType('System');system.Action=lambda x:x
        forms=types.ModuleType('System.Windows.Forms');forms.FormWindowState=types.SimpleNamespace(Normal='normal',Maximized='max',Minimized='min')
        with patch.dict(sys.modules,{'System':system,'System.Windows.Forms':forms}),patch('sys.platform','win32'):
            self.assertTrue(c.control('maximize')['queued']);self.assertEqual(form.WindowState,'max')
            c.control('maximize');self.assertEqual(form.WindowState,'normal')
            c.control('minimize');self.assertEqual(form.WindowState,'min')
            c.control('close');form.Close.assert_called_once()

    def test_frameless_start_does_not_enable_whole_window_drag(self):
        source=(Path(__file__).resolve().parents[1]/'main_web.py').read_text(encoding='utf-8')
        self.assertIn('easy_drag=False',source)
        self.assertIn('settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True',source)


if __name__ == '__main__': unittest.main()
