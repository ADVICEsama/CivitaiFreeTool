"""Completed classification must never be overwritten by a global download target."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,downloader,webui


class CompletedLocationTests(unittest.TestCase):
    def test_global_target_change_never_moves_finished_models(self):
        with tempfile.TemporaryDirectory() as d,patch.object(config,'save',return_value=True):
            root=Path(d);category=root/'Krea2'/'细节';category.mkdir(parents=True)
            file=category/'demo.safetensors';file.write_bytes(b'fixture')
            a=webui.Api.__new__(webui.Api);a.cfg=dict(config.DEFAULTS,models_dir=str(root),models_dirs=[str(root)])
            task=downloader.DownloadTask('https://example.invalid',str(category),file.name);task.status=downloader.ST_DONE
            a.dl=Mock();a.dl.tasks=[task];a.move_file_to=Mock()
            r=json.loads(a.set_download_target(str(root)))
            self.assertTrue(r['ok']);self.assertEqual(r['moved'],0);a.move_file_to.assert_not_called()
            self.assertTrue(file.exists());self.assertEqual(task.dest_dir,str(category))

    def test_completion_callback_ignores_later_global_target(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);category=root/'category';category.mkdir();file=category/'demo.safetensors';file.write_bytes(b'fixture')
            a=webui.Api.__new__(webui.Api);a.cfg=dict(config.DEFAULTS,gen_metadata=False,download_cover=False,download_target_dir=str(root),ask_move_after_download=False)
            a.move_file_to=Mock();a._cache_history_task=Mock();a._todo_remove=Mock();a.dl=Mock();a.dl.tasks=[]
            task=downloader.DownloadTask('https://example.invalid',str(category),file.name);task.status=downloader.ST_DONE
            a._handle_dl_done(task);a.move_file_to.assert_not_called();self.assertTrue(file.exists())

    def test_restored_done_record_does_not_replay_metadata_or_move(self):
        task=downloader.DownloadTask.from_dict({'filename':'demo.safetensors','status':'done'})
        self.assertTrue(task._metadata_started)
        a=webui.Api.__new__(webui.Api)
        with patch.object(webui.threading,'Thread') as thread:
            a._on_dl_update(task);thread.assert_not_called()

    def test_explicit_retry_allows_new_completion_processing(self):
        with patch.object(config,'load_history',return_value=[]),patch.object(config,'save_tasks',return_value=True),patch.object(config,'save_history',return_value=True):
            d=downloader.Downloader(dict(config.DEFAULTS));d._ensure_workers=Mock()
            task=downloader.DownloadTask.from_dict({'filename':'demo.safetensors','status':'done'})
            d.tasks=[task];d.retry_task(task);self.assertFalse(task._metadata_started)


if __name__=='__main__':unittest.main()
