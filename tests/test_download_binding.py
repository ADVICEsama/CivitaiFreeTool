"""Synthetic, offline associations; model bytes must never be altered."""
import copy
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,download_binding,downloader,model_manager,webui


class DownloadBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.file=self.root/'synthetic.safetensors';self.file.write_bytes(b'synthetic downloaded bytes')
        self.sha=hashlib.sha256(self.file.read_bytes()).hexdigest()
        self.task=downloader.DownloadTask('https://example.invalid',str(self.root),self.file.name,'0'*64,
            {'fileId':3,'replace_old':str(self.root/'old.safetensors'),'meta':{'info':{'name':'Landscape','modelId':1,'versionId':2,'version':{'name':'v1'},'files':[{'hashes':{'SHA256':'0'*64}}],'images':[]}}})
        self.task.status='error';self.task.error='SHA256 校验失败';self.task.total=self.file.stat().st_size;self.task.downloaded=self.task.total

    def associate(self):
        return download_binding.associate(self.task,self.sha,True,{})

    def test_inspection_does_not_write(self):
        r=download_binding.inspect(self.task);self.assertEqual(r['actual_sha256'],self.sha)
        self.assertEqual(len(list(self.root.iterdir())),1);self.assertFalse(r['hash_verified'])

    def test_explicit_binding_not_hash_success(self):
        old=self.file.read_bytes();mtime=self.file.stat().st_mtime_ns;r=self.associate()
        self.assertTrue(r['ok']);self.assertFalse(r['hash_verified']);self.assertEqual(self.task.status,'error')
        self.assertEqual(self.file.read_bytes(),old);self.assertEqual(self.file.stat().st_mtime_ns,mtime)
        info=json.loads(Path(r['info_path']).read_text(encoding='utf-8'))
        self.assertEqual(info['modelId'],1);self.assertEqual(info['versionId'],2)
        self.assertEqual(info['localSha256'],self.sha);self.assertFalse(info['association']['hash_verified'])
        self.assertEqual(info['files'][0]['hashes']['SHA256'],self.sha.upper())
        self.assertEqual(info['files'][0]['civitaiHashes']['SHA256'],'0'*64)
        self.assertEqual(self.task.expected_sha256,'0'*64);self.assertEqual(self.task.verification_status,'mismatch')
        self.assertEqual(model_manager.find_info_file(str(self.file)),r['info_path'])

    def test_not_confirmed_cannot_write(self):
        for value in (False,None,1,'true'):
            with self.assertRaises(ValueError):download_binding.associate(self.task,self.sha,value,{})
        self.assertEqual(len(list(self.root.iterdir())),1)

    def test_changed_file_proof_rejected(self):
        self.file.write_bytes(b'x'*self.task.total)
        with self.assertRaisesRegex(ValueError,'确认时不同'):self.associate()
        self.assertFalse(self.file.with_suffix('.civitai.info').exists())

    def test_partial_file_cannot_associate(self):
        self.file.write_bytes(b'x')
        with self.assertRaisesRegex(ValueError,'不完整'):self.associate()

    def test_missing_final_file_and_part_not_used(self):
        self.file.rename(str(self.file)+'.part')
        with self.assertRaisesRegex(ValueError,'不存在'):self.associate()

    def test_unrelated_error_and_running_task_denied(self):
        for status,error in [('error','HTTP 403'),('downloading','SHA256 校验失败'),('done','')]:
            self.task.status=status;self.task.error=error
            with self.assertRaises(ValueError):self.associate()

    def test_invalid_source_information_denied(self):
        self.task.info['meta']['info'].pop('modelId')
        with self.assertRaisesRegex(ValueError,'明确'):self.associate()

    def test_existing_sidecars_never_overwritten(self):
        for suffix in ('.civitai.info','.info.json','.json'):
            p=self.file.with_suffix(suffix);p.write_bytes(b'old metadata')
            with self.assertRaisesRegex(ValueError,'未自动覆盖'):self.associate()
            self.assertEqual(p.read_bytes(),b'old metadata');p.unlink()

    def test_existing_model_never_replaced_or_removed(self):
        old=self.root/'old.safetensors';old.write_bytes(b'old model');self.associate()
        self.assertEqual(old.read_bytes(),b'old model')

    def test_atomic_publish_failure_no_false_binding(self):
        original=copy.deepcopy(self.task.info)
        with patch.object(download_binding.os,'link',side_effect=OSError('disk denied')):
            with self.assertRaises(OSError):self.associate()
        self.assertEqual(self.task.info,original);self.assertEqual(len(list(self.root.iterdir())),1)

    def test_serialization_and_history_retain_warning(self):
        self.associate();saved=downloader.DownloadTask.from_dict(self.task.to_dict())
        self.assertEqual(saved.actual_sha256,self.sha);self.assertEqual(saved.status,'error')
        with patch.object(config,'load_history',return_value=[]):d=downloader.Downloader({})
        with d._lock:d._record_history(saved)
        row=d.get_history()[0];self.assertEqual(row['verification_status'],'mismatch')
        self.assertFalse(row['manual_binding']['hash_verified'])

    def test_api_never_calls_download_done_or_network(self):
        with patch.object(config,'load_history',return_value=[]):d=downloader.Downloader({})
        d.tasks=[self.task];d.save_tasks=Mock(return_value=True)
        a=webui.Api.__new__(webui.Api);a.cfg={'download_cover':False};a.dl=d
        a._history_asset=Mock(return_value=str(self.root/'missing.jpg'));a._cache_history_task=Mock();a._handle_dl_done=Mock()
        with patch.object(webui.threading,'Thread'),patch('civitai_api.build_opener',side_effect=AssertionError('must remain offline')):
            r=a.bind_download_metadata(self.task.id,self.sha,True)
        self.assertTrue(r['ok']);a._handle_dl_done.assert_not_called();d.save_tasks.assert_called_once()
        self.assertEqual(a.get_tasks()[0]['hash_mismatch'],True);self.assertTrue(a.get_tasks()[0]['manual_binding'])

    def test_api_rejects_active_download(self):
        with patch.object(config,'load_history',return_value=[]):d=downloader.Downloader({})
        d.tasks=[self.task];d._active_ids.add(self.task.id)
        a=webui.Api.__new__(webui.Api);a.cfg={};a.dl=d
        self.assertFalse(a.bind_download_metadata(self.task.id,self.sha,True)['ok'])
        self.assertFalse(a.inspect_download_binding(self.task.id)['ok'])

    def test_original_expected_hash_not_replaced_by_local(self):
        self.task.expected_sha256=self.sha
        with self.assertRaisesRegex(ValueError,'匹配官方'):self.associate()

    def test_changed_retry_hash_not_claimed_previously_associated(self):
        self.associate();self.task.actual_sha256='f'*64
        self.assertFalse(download_binding.binding_matches(self.task))
        with patch.object(config,'load_history',return_value=[]):d=downloader.Downloader({})
        with d._lock:d._record_history(self.task)
        self.assertIsNone(d.get_history()[0]['manual_binding'])

    def test_download_verification_records_actual_hash_without_bypass(self):
        with patch.object(config,'load_history',return_value=[]):d=downloader.Downloader({})
        d.save_tasks=Mock(return_value=True)
        for correct in (False,True):
            task=copy.deepcopy(self.task);task.expected_sha256=self.sha if correct else '0'*64
            response=io.BytesIO(b'synthetic downloaded bytes');response.status=200;response.headers={'Content-Length':str(task.total)}
            opener=Mock();opener.open.return_value=response
            with patch('civitai_api.build_opener',return_value=opener):d._download_once(task)
            self.assertEqual(task.actual_sha256,self.sha)
            self.assertEqual(task.verification_status,'verified' if correct else 'mismatch')
            self.assertEqual(task.status,'done' if correct else 'error')

    def test_later_verified_completion_restores_published_metadata(self):
        self.associate();self.task.verification_status='verified';self.task.actual_sha256='0'*64
        a=webui.Api.__new__(webui.Api);a.cfg={'gen_metadata':True,'download_cover':False,'update_keep_old':'keep'}
        a._cache_history_task=Mock();a._handle_dl_done(self.task)
        info=json.loads(self.file.with_suffix('.civitai.info').read_text(encoding='utf-8'))
        self.assertNotIn('association',info);self.assertNotIn('localSha256',info)
        self.assertEqual(info['files'][0]['hashes']['SHA256'],'0'*64)
        self.assertNotIn('manual_binding',self.task.info)


if __name__=='__main__':unittest.main()
