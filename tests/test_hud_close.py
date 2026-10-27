import unittest
from unittest.mock import Mock,patch
from types import SimpleNamespace
from download_hud import DownloadHud,HudBridge
class HudCloseTests(unittest.TestCase):
 def controller(self):
  c=DownloadHud(SimpleNamespace(cfg={},dl_action=Mock()),Mock(),'.');c.window=Mock();return c
 def test_os_close_returns_without_sync_ui_or_js_call(self):
  c=self.controller()
  with patch('download_hud.threading.Timer') as timer:
   self.assertIs(c.on_closing(),False);c.window.hide.assert_not_called();c.window.evaluate_js.assert_not_called();self.assertTrue(c._hidden_requested);timer.assert_called_once_with(.03,c._hide_after_close);timer.return_value.start.assert_called_once()
  c._hide_after_close();c.window.hide.assert_called_once();c.window.evaluate_js.assert_not_called();c.api.dl_action.assert_not_called()
 def test_duplicate_os_close_coalesces_pending_timer(self):
  c=self.controller()
  with patch('download_hud.threading.Timer') as timer:
   timer.return_value.is_alive.return_value=True;c.on_closing();c.on_closing();timer.assert_called_once()
 def test_main_shutdown_cancels_deferred_hide_and_allows_real_close(self):
  c=self.controller();c._hide_timer=Mock();c.close();c._hide_timer.cancel.assert_called_once();c.window.destroy.assert_called_once();self.assertIs(c.on_closing(),True);c._hide_after_close();c.window.hide.assert_not_called()
 def test_bridge_hide_never_waits_for_javascript(self):
  c=self.controller();self.assertTrue(HudBridge(c).hide());c.window.hide.assert_called_once();c.window.evaluate_js.assert_not_called()
 def test_deferred_hide_cannot_override_a_new_show_request(self):
  c=self.controller();c._hidden_requested=False;c._hide_after_close();c.window.hide.assert_not_called()
if __name__=='__main__':unittest.main()
