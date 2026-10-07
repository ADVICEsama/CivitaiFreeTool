"""下载持久化回归：所有文件在临时目录；不发起下载、不启动桥接服务器。"""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config
import downloader


class DownloadHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patches = [patch.object(config, "TASKS_PATH", str(self.root / "tasks.json")),
                        patch.object(config, "HISTORY_PATH", str(self.root / "history.json")),
                        patch.object(downloader.Downloader, "_ensure_workers")]
        for p in self.patches:
            p.start()
        self.dl = downloader.Downloader({"max_concurrent_downloads": 1})

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def task(self, filename="example.safetensors"):
        return downloader.DownloadTask("https://example.invalid/download?signature=fixture", str(self.root), filename)

    def finish(self, task, status=downloader.ST_DONE):
        task.status = status
        task.total = task.downloaded = 2048
        task.progress = 100
        self.dl._notify(task)

    def test_auto_save_enqueue_and_completion(self):
        task = self.task()
        self.dl.add_task(task)
        self.assertEqual(config.load_tasks()[0]["id"], task.id)
        self.finish(task)
        other = downloader.Downloader({})
        other.load_tasks(resume=False)
        self.assertEqual(other.tasks[0].id, task.id)
        self.assertEqual(other.tasks[0].status, downloader.ST_DONE)
        self.assertEqual(other.tasks[0].progress, 100)
        self.assertEqual(len(other.get_history()), 1)
        self.assertNotIn("signature", json.dumps(other.get_history()))

    def test_clear_queue_keeps_history_across_restarts(self):
        task = self.task()
        self.dl.add_task(task)
        self.finish(task)
        self.dl.clear_finished()
        self.assertEqual(config.load_tasks(), [])
        other = downloader.Downloader({})
        other.load_tasks(resume=False)
        other.load_tasks(resume=False)
        self.assertEqual(len(other.get_history()), 1)
        self.assertEqual(other.tasks, [])

    def test_remove_pending_records_cancel_without_file_deletion(self):
        task = self.task()
        model = self.root / task.filename
        model.write_bytes(b"fixture")
        self.dl.add_task(task)
        self.dl.remove_task(task)
        self.assertEqual(config.load_tasks(), [])
        self.assertEqual(config.load_history()[0]["status"], downloader.ST_CANCELED)
        self.assertTrue(model.exists())

    def test_error_and_cancel_details_survive(self):
        for status in (downloader.ST_ERROR, downloader.ST_CANCELED):
            task = self.task(status + ".safetensors")
            task.error = "fixture error"
            self.dl.add_task(task)
            self.finish(task, status)
        other = downloader.Downloader({})
        other.load_tasks(resume=False)
        self.assertEqual(len(other.tasks), 2)
        self.assertTrue(all(t.error == "fixture error" for t in other.tasks))
        self.assertTrue(all(t.finished_at for t in other.tasks))

    def test_interrupted_does_not_auto_start(self):
        for status in (downloader.ST_DOWNLOADING, downloader.ST_PENDING):
            task = self.task(status)
            task.status = status
            self.dl.tasks.append(task)
        self.dl.save_tasks()
        other = downloader.Downloader({})
        with patch.object(other, "_ensure_workers") as start:
            other.load_tasks(resume=False)
            start.assert_not_called()
        self.assertTrue(all(t.status == downloader.ST_PAUSED for t in other.tasks))
        self.assertTrue(other._queue.empty())

    def test_retry_updates_one_history_entry(self):
        task = self.task()
        self.dl.add_task(task)
        self.finish(task, downloader.ST_ERROR)
        self.dl.retry_task(task)
        self.finish(task)
        self.assertEqual(len(config.load_history()), 1)
        self.assertEqual(config.load_history()[0]["status"], downloader.ST_DONE)

    def test_legacy_migration_has_stable_id_and_unknown_time(self):
        config.save_tasks([{"filename":"old.safetensors", "status":"done", "downloaded":1024, "total":1024}])
        first = downloader.Downloader({})
        first.load_tasks(resume=False)
        second = downloader.Downloader({})
        second.load_tasks(resume=False)
        self.assertEqual(first.tasks[0].id, second.tasks[0].id)
        self.assertIsNone(second.get_history()[0]["finished_at"])
        self.assertEqual(len(second.get_history()), 1)

    def test_invalid_entries_skip_and_backup_recovery(self):
        config.save_tasks([None, 2, {}, {"filename":"good.safetensors", "status":"done"}])
        config.save_tasks([{"filename":"latest.safetensors", "status":"done"}])
        Path(config.TASKS_PATH).write_text("{broken", encoding="utf-8")
        other = downloader.Downloader({})
        other.load_tasks(resume=False)
        self.assertEqual([t.filename for t in other.tasks], ["good.safetensors"])

    def test_atomic_write_failure_keeps_previous_data(self):
        config.save_tasks([{"filename":"previous"}])
        with patch.object(config.os, "replace", side_effect=OSError("fixture permission error")):
            self.assertFalse(config.save_tasks([{"filename":"new"}]))
        self.assertEqual(config.load_tasks()[0]["filename"], "previous")
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_storage_failure_is_reported(self):
        with patch.object(config, "save_history", return_value=False):
            self.assertFalse(self.dl.save_tasks())
        self.assertIn("保存失败", self.dl.persistence_error)

    def test_concurrent_snapshots_are_valid(self):
        task = self.task()
        self.dl.add_task(task)
        self.finish(task)
        threads = [threading.Thread(target=self.dl.save_tasks) for _ in range(12)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())
        self.assertEqual(len(config.load_history()), 1)
        self.assertEqual(len(config.load_tasks()), 1)

    def test_web_api_restores_without_bridge_or_download(self):
        import webui
        task = self.task()
        self.dl.add_task(task)
        self.finish(task)
        with patch.object(config, "load", return_value={}), patch.object(webui.Api, "_new_api"), \
             patch.object(webui.Api, "_load_updates", return_value={}), \
             patch.object(webui.browser_bridge, "start"), patch.object(webui.browser_bridge, "set_api"), \
             patch.object(webui.browser_bridge, "set_download_handler"):
            api = webui.Api()
        self.assertEqual(api.get_tasks()[0]["id"], task.id)
        self.assertEqual(api.get_download_history()["items"][0]["id"], task.id)


if __name__ == "__main__":
    unittest.main()
