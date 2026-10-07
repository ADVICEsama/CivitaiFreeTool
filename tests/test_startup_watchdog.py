"""启动恢复隔离回归：假时钟/假进程，不结束真实进程、不打开浏览器。"""
import contextlib
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config
import main_web
import watchdog_ext as wd


class EndSimulation(Exception):
    pass


class Clock:
    def __init__(self, limit=46):
        self.now = 0.0
        self.limit = limit

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        if self.now > self.limit:
            raise EndSimulation()


def health(pid=42, window=False):
    return {"app": "CivitaiFreeTool", "ok": True, "pid": pid, "window": window, "mode": "window"}


class StartupTests(unittest.TestCase):
    def simulate(self, response=None, activity=False, switch=True, busy=False, matching=True, limit=46, fallback=True):
        clock = Clock(limit)
        switch_times = []
        def do_switch(pid):
            switch_times.append(clock.now)
            return switch
        with contextlib.ExitStack() as stack:
            patches = {
                "_write_owner": None, "_log": None, "_read_owner": {}, "read_app_pid": 42,
                "pid_alive": True, "_app_pid_matches": matching, "_descendants": [],
                "has_visible_window": False, "_app_progressing": False, "_tree_active": activity,
                "_browser_fallback_enabled": fallback, "_saved_tasks_busy": busy, "_message": None, "kill_app_tree": None, "_relaunch": True,
            }
            mocked = {name: stack.enter_context(patch.object(wd, name, return_value=value)) for name, value in patches.items()}
            stack.enter_context(patch.object(wd.time, "time", side_effect=clock.time))
            stack.enter_context(patch.object(wd.time, "sleep", side_effect=clock.sleep))
            stack.enter_context(patch.object(wd, "_app_health", side_effect=lambda: response(clock) if callable(response) else response))
            stack.enter_context(patch.object(wd, "_switch_browser_in_place", side_effect=do_switch))
            with self.assertRaises(EndSimulation):
                wd.run(grace=5, exe_name="CivitaiFreeToolWeb.exe")
        return clock, mocked, switch_times

    def test_short_grace_is_not_used_to_kill_at_eight_seconds(self):
        _, mocks, times = self.simulate(response=health())
        self.assertGreaterEqual(times[0], 30)
        mocks["kill_app_tree"].assert_not_called()
        mocks["_relaunch"].assert_not_called()

    def test_native_window_slow_start_gets_activity_extensions(self):
        _, mocks, times = self.simulate(response=lambda c: health(window=c.now >= 44), activity=True, limit=52)
        self.assertEqual(times, [])
        mocks["kill_app_tree"].assert_not_called()
        self.assertTrue(any("extend deadline" in call.args[0] for call in mocks["_log"].call_args_list))

    def test_responsive_backend_switches_in_place(self):
        _, mocks, times = self.simulate(response=health(), switch=True)
        self.assertEqual(len(times), 1)
        mocks["kill_app_tree"].assert_not_called()
        mocks["_relaunch"].assert_not_called()

    def test_failed_ui_switch_does_not_kill_responsive_backend(self):
        _, mocks, times = self.simulate(response=health(), switch=False)
        self.assertGreater(len(times), 1)
        mocks["kill_app_tree"].assert_not_called()
        mocks["_relaunch"].assert_not_called()

    def test_unfinished_saved_jobs_prevent_forced_restart(self):
        _, mocks, _ = self.simulate(response=None, busy=True)
        mocks["kill_app_tree"].assert_not_called()
        mocks["_relaunch"].assert_not_called()
        self.assertEqual(mocks["_message"].call_count, 1)

    def test_stalled_idle_instance_can_use_browser_restart(self):
        _, mocks, times = self.simulate(response=None, busy=False)
        self.assertEqual(times, [])
        mocks["kill_app_tree"].assert_called_once_with(42)
        mocks["_relaunch"].assert_called_once()
        self.assertTrue(mocks["_relaunch"].call_args.kwargs["browser"])

    def test_unconfirmed_pid_is_never_killed(self):
        _, mocks, times = self.simulate(response=None, matching=False)
        self.assertEqual(times, [])
        mocks["kill_app_tree"].assert_not_called()
        mocks["_relaunch"].assert_not_called()

    def test_explicit_off_never_opens_browser_or_restarts(self):
        _, mocks, times = self.simulate(response=health(), fallback=False, limit=100)
        self.assertEqual(times, [])
        mocks["kill_app_tree"].assert_not_called()
        mocks["_relaunch"].assert_not_called()

    def test_foreign_health_does_not_mark_window_ready(self):
        self.assertFalse(wd._ui_ready(42, health(pid=43, window=True)))
        self.assertTrue(wd._ui_ready(42, health(window=True)))
        self.assertFalse(wd._health_matches_pid({"ok":True, "app":"OtherApp", "pid":42},42))

    def test_grace_bounds_and_legacy_config(self):
        for value, expected in [(5,30),(12,30),(30,30),(80,80),(999,600),(None,30),("bad",30)]:
            self.assertEqual(wd._effective_grace(value),expected)
        with tempfile.TemporaryDirectory() as tmp, patch.object(config, "CONFIG_PATH", os.path.join(tmp,"config.json")), patch.object(config,"_import_legacy"):
            for value, expected in [(5,30),(12,30),(55,55),(999,600),("invalid",30)]:
                Path(config.CONFIG_PATH).write_text(json.dumps({"window_wait_seconds":value}),encoding="utf-8")
                self.assertEqual(config.load()["window_wait_seconds"],expected)

    def test_in_place_browser_activation_keeps_downloader_and_tasks(self):
        import browser_bridge
        import webbrowser
        api=types.SimpleNamespace(cfg={"tray_icon":True},dl=object())
        original=api.dl
        with patch.object(browser_bridge,"set_api"), patch.object(browser_bridge,"set_ui_state"), patch.object(browser_bridge,"port",return_value=47531), \
             patch.object(main_web,"_tray_icon",return_value=True) as tray, patch.object(main_web,"_watch_page_close") as close, \
             patch.object(main_web,"_startup_log"), patch.object(webbrowser,"open") as open_page, patch.dict(os.environ,{},clear=True):
            first=main_web._activate_browser_ui(api)
            second=main_web._activate_browser_ui(api)
        self.assertIs(api.dl,original)
        self.assertTrue(first["backend_preserved"] and second["backend_preserved"])
        tray.assert_called_once()
        close.assert_called_once()
        open_page.assert_called_once()

    def test_source_package_includes_tray_backend(self):
        root=Path(__file__).resolve().parents[1]
        self.assertIn("pystray._win32",(root/"CivitaiFreeToolWeb.spec").read_text(encoding="utf-8"))
        self.assertIn("pystray>=",(root/"requirements.txt").read_text(encoding="utf-8"))


if __name__=="__main__":
    unittest.main()
