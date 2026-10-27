"""No native UI is opened. Verify move RPC never waits on the system drag loop."""
import sys,types,unittest
from types import SimpleNamespace
from unittest.mock import Mock,patch
from window_appearance import WindowAppearance
import config
class PerformanceTests(unittest.TestCase):
 def test_native_drag_is_queued_once_without_script_roundtrip(self):
  form=SimpleNamespace(BeginInvoke=Mock());window=SimpleNamespace(native=form,evaluate_js=Mock())
  controller=WindowAppearance(window);frame=SimpleNamespace(BeginMove=Mock());controller.chrome=SimpleNamespace(frame=frame)
  with patch('window_appearance.sys.platform','win32'),patch.dict(sys.modules,{'System':SimpleNamespace(Action=lambda f:f)}):
   self.assertEqual(controller.begin_move(),{'ok':True,'queued':True});form.BeginInvoke.assert_called_once();frame.BeginMove.assert_not_called();window.evaluate_js.assert_not_called();form.BeginInvoke.call_args.args[0]();frame.BeginMove.assert_called_once()
 def test_profile_normalization_retains_old_explicit_preferences(self):
  c={'endfield_parallax':False,'effects_fps_limit':24,'performance_profile':'bad','performance_prompt_version':'bad','ui_animations':False}
  config.normalize_ui_preferences(c);self.assertEqual(c['performance_profile'],'custom');self.assertEqual(c['performance_prompt_version'],0);self.assertFalse(c['ui_animations']);self.assertFalse(c['endfield_parallax']);self.assertEqual(c['effects_fps_limit'],24)
 def test_four_profiles_and_legacy_aliases(self):
  for old,new in [('full','high'),('static','low'),('extreme','extreme'),('high','high'),('low','low')]:
   c={'performance_profile':old,'effects_fps_limit':0};config.normalize_ui_preferences(c);self.assertEqual(c['performance_profile'],new);self.assertEqual(c['effects_fps_limit'],0)
  c={'performance_profile':[]};config.normalize_ui_preferences(c);self.assertEqual(c['performance_profile'],'custom')
 def test_native_not_ready_does_not_start_drag(self):
  self.assertFalse(WindowAppearance(SimpleNamespace(native=None)).begin_move()['ok'])
if __name__=='__main__':unittest.main()
