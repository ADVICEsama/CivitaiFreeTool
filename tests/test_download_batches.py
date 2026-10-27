"""Batch metadata must survive persistence without inventing batches for legacy records."""
import tempfile
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config
import downloader

class BatchHistoryTests(TestCase):
    def test_round_trip_and_history_keep_batch(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(config,'TASKS_PATH',str(Path(temp)/'tasks.json')), patch.object(config,'HISTORY_PATH',str(Path(temp)/'history.json')), patch.object(downloader.Downloader,'_ensure_workers'):
            engine=downloader.Downloader({})
            info={'batch_id':'request-batch-a','batch_started_at':1792800000}
            a=downloader.DownloadTask('https://example.invalid/a',temp,'a.safetensors',info=dict(info))
            b=downloader.DownloadTask('https://example.invalid/b',temp,'b.safetensors',info=dict(info))
            engine.add_task(a);engine.add_task(b)
            self.assertEqual(a.batch_id,b.batch_id)
            restored=downloader.DownloadTask.from_dict(a.to_dict())
            self.assertEqual(restored.batch_id,'request-batch-a');self.assertEqual(restored.batch_started_at,1792800000)
            a.status=downloader.ST_DONE;engine._notify(a)
            history=engine.get_history()[0]
            self.assertEqual(history['batch_id'],'request-batch-a');self.assertEqual(history['batch_started_at'],1792800000)
            engine.remove_task(a,cleanup_partial=False)
            self.assertEqual(engine.get_history()[0]['batch_id'],'request-batch-a')
            self.assertTrue(engine.save_tasks())
    def test_legacy_does_not_get_a_fabricated_batch(self):
        t=downloader.DownloadTask.from_dict({'id':'old','filename':'old.safetensors','status':'done','created_at':1700000000})
        self.assertEqual(t.batch_id,'');self.assertIsNone(t.batch_started_at)
        self.assertEqual(t.to_dict()['batch_id'],'')
    def test_direct_new_requests_are_distinct(self):
        a=downloader.DownloadTask('a','','a');b=downloader.DownloadTask('b','','b')
        self.assertNotEqual(a.batch_id,b.batch_id);self.assertGreater(a.batch_started_at,0)
if __name__=='__main__':main()
