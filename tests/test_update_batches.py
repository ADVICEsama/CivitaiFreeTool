"""Local temporary models, fake Civitai responses; no real credentials or network."""
import copy
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import config
import webui


class ImmediateThread:
    def __init__(self, target, **kwargs): self.target = target
    def start(self): self.target()


class UpdateBatchTests(unittest.TestCase):
    def api(self):
        a = webui.Api.__new__(webui.Api)
        a.cfg = copy.deepcopy(config.DEFAULTS)
        a.cfg['api_key'] = 'synthetic-test-key'
        a._updates = {'checked_at': 0, 'items': {}}
        a._mm_upd_state = {'running': False}
        a._save_updates = Mock()
        a._enrich_upd_records = Mock()
        a._resolve_model_path = lambda p: p
        a._wl = lambda: {}
        a._site_url = lambda mid, vid=None: 'https://example.test/models/' + str(mid)
        a.api = Mock()
        a.model_rows = []
        return a

    def test_snapshot_independence_retention_and_status(self):
        a = self.api()
        source = {'model.pt': {'ver_list': [{'name': 'v2'}]}}
        a._mm_upd_state = {'batch_id': 'one', 'checked_at': 1, 'done': 2, 'total': 2}
        a._record_update_batch(source)
        source['model.pt']['ver_list'][0]['name'] = 'changed'
        self.assertEqual(a._updates['batches'][0]['items']['model.pt']['ver_list'][0]['name'], 'v2')
        self.assertEqual(a._updates['batches'][0]['status'], 'complete')
        for i in range(25):
            a._mm_upd_state = {'batch_id': str(i), 'checked_at': i, 'total': 3, 'done': 1, 'cancelled': True}
            a._record_update_batch({})
        self.assertEqual(len(a._updates['batches']), 20)
        self.assertEqual(a._updates['batches'][0]['status'], 'stopped')
        a._mm_upd_state = {'batch_id': 'partial', 'total': 3, 'done': 2, 'failed': 1}
        self.assertEqual(a._record_update_batch({})['status'], 'partial')

    def test_payload_keeps_legacy_and_filters_missing_or_external_models(self):
        with TemporaryDirectory() as folder, TemporaryDirectory() as outside:
            a = self.api()
            live = str(Path(folder) / 'live.pt'); Path(live).write_bytes(b'fake')
            external = str(Path(outside) / 'outside.pt'); Path(external).write_bytes(b'fake')
            a.cfg.update(models_dir=folder, models_dirs=[folder])
            records = {live: {'model_name': 'live'}, external: {}, str(Path(folder) / 'missing.pt'): {}}
            a._updates['items'] = records
            self.assertEqual(a.get_model_updates()['batches'], [])
            a._mm_upd_state = {'batch_id': 'a', 'total': 1, 'done': 1}
            a._record_update_batch(records)
            payload = a.get_model_updates()
            self.assertEqual(set(payload['items']), {live})
            self.assertEqual(set(payload['batches'][0]['items']), {live})

    def run_check(self, a):
        with patch.object(webui.threading, 'Thread', ImmediateThread), patch.object(webui.time, 'sleep'):
            return a.mm_check_updates(True)

    def models(self, a, folder, count):
        for i in range(count):
            p = Path(folder) / (str(i) + '.pt'); p.write_bytes(b'fake')
            a.model_rows.append({'path': str(p), 'modelId': i + 1, 'verId': 10, 'base': 'MOSS'})
        a.api.get_model.return_value = {'name': 'Demo', 'type': 'Checkpoint', 'modelVersions': [
            {'id': 20, 'name': 'v2', 'baseModel': 'MOSS', 'publishedAt': '2026-10-25'},
            {'id': 10, 'name': 'v1', 'baseModel': 'MOSS', 'publishedAt': '2026-10-01'}]}

    def test_success_records_actual_results_without_losing_old_cache(self):
        with TemporaryDirectory() as folder:
            a = self.api(); self.models(a, folder, 2)
            old = str(Path(folder) / 'old.pt'); Path(old).write_bytes(b'fake')
            a._updates['items'][old] = {'model_name': 'Earlier'}
            result = self.run_check(a)
            self.assertTrue(result['started'])
            self.assertEqual(a._mm_upd_state['done'], 2)
            self.assertEqual(a._updates['batches'][0]['newer'], 2)
            self.assertEqual(len(a._updates['batches'][0]['items']), 2)
            self.assertIn(old, a._updates['items'])
            a._save_updates.assert_called()

    def test_selected_check_preserves_full_check_timestamp(self):
        with TemporaryDirectory() as folder:
            a = self.api(); self.models(a, folder, 2)
            a._updates['checked_at'] = 99
            path = a.model_rows[1]['path']
            with patch.object(webui.threading, 'Thread', ImmediateThread), patch.object(webui.time, 'sleep'):
                result = a.mm_check_updates(True, [path])
            self.assertEqual(result['paths'], [path])
            self.assertEqual(a._updates['checked_at'], 99)
            batch = a._updates['batches'][0]
            self.assertEqual((batch['scope'], batch['total']), ('selected', 1))
            self.assertEqual(set(batch['items']), {path})

    def test_cancel_keeps_only_completed_results_and_failure_is_not_success(self):
        with TemporaryDirectory() as folder:
            a = self.api(); self.models(a, folder, 2)
            response = a.api.get_model.return_value
            def stop_after_one(mid): a._mm_cancel = True; return response
            a.api.get_model.side_effect = stop_after_one
            self.run_check(a)
            batch = a._updates['batches'][0]
            self.assertEqual((batch['done'], batch['status'], len(batch['items'])), (1, 'stopped', 1))
            a = self.api(); self.models(a, folder, 6)
            a.api.get_model.side_effect = RuntimeError('synthetic offline')
            self.run_check(a)
            self.assertEqual(a._updates['batches'][0]['status'], 'partial')
            self.assertEqual(a._updates['batches'][0]['failed'], 5)
            self.assertIn('请求失败', a._mm_upd_state['msg'])

    def test_clear_results_never_touches_models_or_whitelist(self):
        a = self.api()
        original = {'items': {'some-model': {'has_update': True}}, 'batches': [{'id':'test'}], 'checked_at':123, 'whitelist':['keep']}
        a._updates = copy.deepcopy(original)
        a._mm_upd_state['running'] = True
        self.assertFalse(a.clear_model_update_results()['ok'])
        self.assertEqual(a._updates, original)
        a._mm_upd_state['running'] = False
        a._save_updates.return_value = False
        self.assertFalse(a.clear_model_update_results()['ok'])
        self.assertEqual(a._updates, original)
        a._save_updates.return_value = True
        self.assertTrue(a.clear_model_update_results()['ok'])
        self.assertEqual(a._updates, {'items':{},'batches':[],'checked_at':0,'whitelist':['keep']})



if __name__ == '__main__': unittest.main()
