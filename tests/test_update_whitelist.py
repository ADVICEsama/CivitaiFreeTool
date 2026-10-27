"""Atomic chooser writes use only a temporary directory and synthetic model IDs."""
import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import webui


class UpdateWhitelistTests(unittest.TestCase):
    def api(self, folder):
        a = webui.Api.__new__(webui.Api)
        a._wl_cache = {'999': 'Original'}
        a._wl_path = lambda: str(Path(folder) / 'whitelist.json')
        a._updates = {'items': {'one.pt': {'model_id': '100'}, 'two.pt': {'model_id': '200'}},
                      'batches': [{'id': 'history', 'items': {'one.pt': {'model_id': '100'}}}]}
        a._save_updates = Mock(return_value=True)
        return a

    def test_atomic_save_groups_model_id_and_preserves_history(self):
        with TemporaryDirectory() as folder:
            a = self.api(folder)
            result = a.save_update_whitelist([{'model_id': '999', 'name': 'Original'}, {'model_id': 100, 'name': 'Demo'}], ['999'])
            self.assertTrue(result['ok'])
            self.assertEqual(a._wl_cache, {'999': 'Original', '100': 'Demo'})
            self.assertEqual(json.loads(Path(a._wl_path()).read_text('utf-8'))['model_ids'], a._wl_cache)
            self.assertEqual(set(a._updates['items']), {'two.pt'})
            self.assertIn('one.pt', a._updates['batches'][0]['items'])

    def test_failure_or_conflict_does_not_mutate_state(self):
        with TemporaryDirectory() as folder:
            a = self.api(folder); before = copy.deepcopy(a._updates)
            with patch.object(webui.config, '_save_json_atomic', return_value=False):
                self.assertFalse(a.save_update_whitelist([], ['999'])['ok'])
            self.assertEqual(a._wl_cache, {'999': 'Original'})
            self.assertEqual(a._updates, before)
            self.assertFalse(a.save_update_whitelist([], ['other'])['ok'])
            self.assertFalse(Path(a._wl_path()).exists())

    def test_input_validation_clear_and_secondary_cache_failure(self):
        with TemporaryDirectory() as folder:
            a = self.api(folder)
            for entries in [None, {}, [None], [{'model_id': '../unsafe'}], [{'model_id': '0'}]]:
                self.assertFalse(a.save_update_whitelist(entries)['ok'])
            self.assertTrue(a.save_update_whitelist([], ['999'])['ok'])
            self.assertEqual(a._wl_cache, {})
            a._save_updates.side_effect = OSError('synthetic cache failure')
            result = a.save_update_whitelist([{'model_id': '100', 'name': 'Demo'}], [])
            self.assertTrue(result['ok'])
            self.assertFalse(result['cache_saved'])
            self.assertEqual(a._wl_cache, {'100': 'Demo'})


if __name__ == '__main__': unittest.main()
