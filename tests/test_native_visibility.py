"""Isolated window activation tests, no real windows or downloads touched."""
import ctypes
from ctypes import wintypes
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main_web
import watchdog_ext as wd


class NativeVisibilityTests(unittest.TestCase):
    def test_enum_filters_foreign_same_title_and_auxiliary_window(self):
        large_handle = 0x123456789
        rows = {10: (9, 'CivitaiFreeTool', True), 11: (42, 'GDI+ Window', False), large_handle: (42, 'CivitaiFreeTool', False)}
        u = Mock()
        u.EnumWindows.side_effect = lambda cb, arg: [cb(h, arg) for h in rows]
        u.GetWindowThreadProcessId.side_effect = lambda h, p: setattr(ctypes.cast(p, ctypes.POINTER(wintypes.DWORD)).contents, 'value', rows[h][0])
        u.GetWindowTextW.side_effect = lambda h, text, length: setattr(text, 'value', rows[h][1])
        u.IsWindowVisible.side_effect = lambda h: rows[h][2]
        with patch.object(main_web, '_window_api', return_value=u):
            self.assertEqual(main_web._native_windows_for_pid(42), [{'handle': large_handle, 'visible': False}])

    def test_hidden_window_is_restored_by_verified_pid(self):
        u = Mock(); u.IsWindowVisible.return_value = True
        with patch.object(main_web, '_native_windows_for_pid', return_value=[{'handle': 333, 'visible': False}]), patch.object(main_web, '_window_api', return_value=u):
            self.assertTrue(main_web._activate_native_pid(42))
        u.ShowWindowAsync.assert_called_once_with(333, 9)
        u.SetForegroundWindow.assert_called_once_with(333)

    def test_ambiguous_windows_are_not_activated(self):
        with patch.object(main_web, '_native_windows_for_pid', return_value=[{'handle': 1}, {'handle': 2}]), patch.object(main_web, '_window_api') as u:
            self.assertFalse(main_web._activate_native_pid(42)); u.assert_not_called()

    def simulate(self, mode='window', activate=False, matching=True, health_pid=42):
        import webbrowser
        with patch.object(wd, 'read_app_pid', return_value=42), patch.object(wd, '_app_pid_matches', return_value=matching), patch.object(wd, '_app_health', return_value={'ok': True, 'app': 'CivitaiFreeTool', 'pid': health_pid, 'mode': mode}), patch.object(main_web, '_activate_native_pid', return_value=activate) as native, patch.object(main_web, '_startup_log'), patch.object(webbrowser, 'open') as browser:
            result = main_web._activate_existing_instance()
        return result, native, browser

    def test_native_instance_never_opens_browser(self):
        result, _, browser = self.simulate(); self.assertTrue(result); browser.assert_not_called()

    def test_browser_mode_reopens_browser(self):
        result, _, browser = self.simulate(mode='browser'); self.assertTrue(result); browser.assert_called_once()

    def test_wrong_pid_health_is_not_accepted(self):
        result, _, browser = self.simulate(health_pid=99); self.assertFalse(result); browser.assert_not_called()

    def test_unverified_process_does_not_touch_windows(self):
        result, native, browser = self.simulate(matching=False); self.assertFalse(result); native.assert_not_called(); browser.assert_not_called()

    def test_initial_hidden_window_is_explicitly_shown(self):
        window = Mock()
        with patch.object(main_web.posix_compat, 'IS_WINDOWS', True), patch.object(main_web, '_self_visible_window', side_effect=[False, True]), patch.object(main_web, '_startup_log'):
            self.assertTrue(main_web._reveal_initial_window(window))
        window.show.assert_called_once()

    def test_visible_or_minimized_window_is_not_forced_again(self):
        window = Mock()
        with patch.object(main_web.posix_compat, 'IS_WINDOWS', True), patch.object(main_web, '_self_visible_window', return_value=True), patch.object(main_web, '_startup_log'):
            self.assertTrue(main_web._reveal_initial_window(window))
        window.show.assert_not_called()

    def test_reveal_failure_does_not_report_visible(self):
        window = Mock(); window.show.side_effect = RuntimeError('fixture')
        with patch.object(main_web.posix_compat, 'IS_WINDOWS', True), patch.object(main_web, '_self_visible_window', return_value=False), patch.object(main_web, '_startup_log'):
            self.assertFalse(main_web._reveal_initial_window(window))


if __name__ == '__main__': unittest.main()
