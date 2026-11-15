import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from webui import Api


class DedupeSelectionTests(unittest.TestCase):
    def test_corrupt_saved_review_has_safe_empty_state(self):
        with tempfile.TemporaryDirectory() as directory, patch('webui.config.APP_DIR', directory):
            Path(directory, 'dedupe_result.json').write_text('broken', encoding='utf-8')
            self.assertIsNone(Api.__new__(Api).get_dedupe_result()['completed_at'])

    def test_running_operation_is_not_overwritten(self):
        api = Api.__new__(Api)
        api.mm_progress = {'running': True, 'operation': 'other'}
        self.assertFalse(api.mm_dedupe(['chosen.safetensors'])['started'])
        self.assertEqual(api.mm_progress['operation'], 'other')

    def test_empty_selection_does_not_scan_everything(self):
        api = Api.__new__(Api)
        api.model_rows = [{'path': 'not-selected.safetensors'}]
        with patch('model_manager.compute_sha256') as compute:
            self.assertFalse(api.mm_dedupe([])['started'])
            compute.assert_not_called()

    def test_hash_and_results_are_limited_to_selected_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [str(Path(directory) / f'{i}.safetensors') for i in range(3)]
            for path in paths:
                Path(path).write_bytes(b'identical')
            api = Api.__new__(Api)
            api.cfg = {'hash_threads': 1}
            api.model_rows = [{'path': path, 'name': Path(path).name} for path in paths]
            api._models_roots = lambda: [directory]
            with patch('webui.config.APP_DIR', directory), patch('model_manager.compute_sha256', return_value='a' * 64) as compute:
                self.assertTrue(api.mm_dedupe(paths[:2])['started'])
                deadline = time.monotonic() + 10
                while api.mm_progress['running'] and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertFalse(api.mm_progress['running'])
                self.assertEqual({call.args[0] for call in compute.call_args_list}, set(paths[:2]))
                saved = Api.__new__(Api).get_dedupe_result()
                self.assertEqual(saved['paths'], paths[:2])
                self.assertTrue(saved['completed_at'])
                group = api.mm_progress['result'][0]
                self.assertEqual({group['keep'], *[d['path'] for d in group['dups']]}, set(paths[:2]))


if __name__ == '__main__':
    unittest.main()
