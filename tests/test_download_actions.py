import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from webui import Api

class DownloadActionsTests(unittest.TestCase):
 def api(self):
  a=Api.__new__(Api);a.cfg={};return a
 def test_hud_toggle_uses_hidden_state(self):
  a=self.api();h=Mock();h.window=object();h._hidden_requested=False;h.show.return_value={'ok':True};a._download_hud=h
  self.assertEqual(a.download_hud_control('toggle'),{'ok':True,'visible':False});h.hide.assert_called_once()
  h._hidden_requested=True;self.assertEqual(a.download_hud_control('toggle'),{'ok':True,'visible':True});h.show.assert_called_once()
 def test_live_failed_task_reuses_identity(self):
  a=self.api();import threading
  t=SimpleNamespace(id='failed',status='error');a.dl=SimpleNamespace(_lock=threading.Lock(),tasks=[t],get_history=lambda:[{'id':'failed','status':'error'}],retry_task=Mock())
  self.assertTrue(a.history_retry('failed')['ok']);a.dl.retry_task.assert_called_once_with(t)
  t.status='pending';self.assertFalse(a.history_retry('failed')['ok'])
 def test_archived_retry_exact_file(self):
  a=self.api();import threading
  a.dl=SimpleNamespace(_lock=threading.Lock(),tasks=[],get_history=lambda:[{'id':'f','status':'error','model_id':1,'version_id':2,'file_id':3,'dest_dir':'X:/models'}])
  v={'id':2};f={'id':3};a.api=Mock();a.api.get_model_version.return_value=v;a.api.model_files.return_value=[f];a._enqueue_one=Mock(return_value={'ok':True})
  self.assertTrue(a.history_retry('f')['ok']);self.assertEqual(a._enqueue_one.call_args.args[3:],(v,f,1))
  a.api.model_files.return_value=[{'id':4}];a._enqueue_one.reset_mock();self.assertFalse(a.history_retry('f')['ok']);a._enqueue_one.assert_not_called()
 def test_legacy_without_identity_never_guesses(self):
  a=self.api();import threading
  a.dl=SimpleNamespace(_lock=threading.Lock(),tasks=[],get_history=lambda:[{'id':'old','status':'error'}]);self.assertFalse(a.history_retry('old')['ok'])
if __name__=='__main__':unittest.main()
