"""No network / real downloads: variant URLs, choices and extension acknowledgement."""
import copy
import json
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import civitai_api, config, webui
from download_selection import FileChoiceBroker

FILES=[{'id':i,'name':f'landscape_{i}.safetensors','type':'Model','sizeKB':100+i,'downloadUrl':f'https://civitai.com/api/download/models/123?type=Model&format=SafeTensor&fp=fp{i}&fileId={i}','hashes':{'SHA256':str(i)*64}} for i in range(3)]


class DownloadSelectionTests(unittest.TestCase):
    def start(self, broker, acknowledge=True):
        results=[];t=threading.Thread(target=lambda:results.extend(broker.choose(FILES,'Demo')));t.start()
        for _ in range(100):
            row=broker.get()
            if row:
                if acknowledge:broker.acknowledge(row['id'])
                return t,results,row
            time.sleep(.01)
        self.fail('choice did not appear')

    def test_default_policy_and_normalization(self):
        self.assertEqual(config.DEFAULTS['multi_file_download'],'ask')
        c={'multi_file_download':'bad'};config.normalize_ui_preferences(c);self.assertEqual(c['multi_file_download'],'ask')

    def test_first_all_single_no_dialog(self):
        b=FileChoiceBroker();self.assertEqual(b.choose(FILES,'Demo','first'),FILES[:1]);self.assertEqual(b.choose(FILES,'Demo','all'),FILES);self.assertEqual(b.choose(FILES[:1],'Demo'),FILES[:1]);self.assertIsNone(b.get())

    def test_no_interaction_defaults_first(self):
        b=FileChoiceBroker(timeout=.12);t,r,_=self.start(b);t.join(1);self.assertFalse(t.is_alive());self.assertEqual(r,FILES[:1])

    def test_no_invisible_auto_download_before_ack(self):
        b=FileChoiceBroker(timeout=.1);t,r,row=self.start(b,acknowledge=False)
        time.sleep(.15);self.assertTrue(t.is_alive());self.assertFalse(b.get()['shown'])
        b.acknowledge(row['id']);t.join(1);self.assertEqual(r,FILES[:1])

    def test_acknowledgement_does_not_restart_countdown(self):
        b=FileChoiceBroker(timeout=.3);t,r,row=self.start(b)
        before=b.get()['seconds'];time.sleep(.05);self.assertTrue(b.acknowledge(row['id'])['ok'])
        self.assertLess(b.get()['seconds'],before);self.assertFalse(b.acknowledge('wrong')['ok'])
        b.respond(row['id'],[]);t.join(1)

    def test_diffusion_models_and_future_weight_types_not_dropped(self):
        files=copy.deepcopy(FILES[:2])
        for i,f in enumerate(files):f.update(type='Diffusion Model',metadata={'fp':'fp8' if i==0 else 'bf16'})
        a=civitai_api.CivitaiAPI();self.assertEqual(a.model_files({'files':files}),files)
        files[1]['type']='Future Weight Type';self.assertEqual(a.model_files({'files':files}),files)

    def test_only_attachments_fail_closed_not_download_primary(self):
        with self.assertRaises(civitai_api.CivitaiError):
            civitai_api.CivitaiAPI().model_files({'files':[{'name':'training.zip','type':'Training Data','primary':True}]})

    def test_multiselect_pause_then_confirm_exact_variants(self):
        b=FileChoiceBroker(timeout=.1);t,r,row=self.start(b)
        self.assertTrue(b.respond(row['id'],pause=True)['ok']);time.sleep(.15);self.assertTrue(t.is_alive())
        self.assertTrue(b.respond(row['id'],[2,1,2])['ok']);t.join(1);self.assertEqual(r,[FILES[2],FILES[1]])

    def test_cancel_no_download_and_old_id_rejected(self):
        b=FileChoiceBroker();t,r,row=self.start(b)
        self.assertFalse(b.respond('old',[0])['ok']);self.assertTrue(b.respond(row['id'],[])['ok']);t.join(1);self.assertEqual(r,[]);self.assertIsNone(b.get())

    def test_invalid_indices_rejected(self):
        b=FileChoiceBroker();t,r,row=self.start(b)
        for ids in [[-1],[3],[True],['1'],{}]:self.assertFalse(b.respond(row['id'],ids)['ok'])
        b.respond(row['id'],[]);t.join(1)

    def test_pending_payload_contains_no_download_urls(self):
        b=FileChoiceBroker();t,r,row=self.start(b);self.assertNotIn('downloadUrl',json.dumps(row));self.assertNotIn('hashes',json.dumps(row));b.respond(row['id'],[]);t.join(1)

    def test_exact_per_file_download_urls(self):
        a=civitai_api.CivitaiAPI()
        for f in FILES:self.assertEqual(a.file_download_url({'id':123,'files':FILES},f),f['downloadUrl'])

    def test_bare_variant_url_augmented_with_actual_file_id(self):
        a=civitai_api.CivitaiAPI()
        self.assertEqual(a.file_download_url({'id':123,'files':FILES},{'id':3272646,'downloadUrl':'https://civitai.red/api/download/models/123'}),'https://civitai.red/api/download/models/123?fileId=3272646')

    def test_current_website_file_id_fallback(self):
        a=civitai_api.CivitaiAPI()
        for file_id in [3272664,3272646,3272667,3272648]:
            self.assertEqual(a.file_download_url({'id':3383888,'files':FILES},{'id':file_id}),f'https://civitai.com/api/download/models/3383888?fileId={file_id}')

    def test_missing_variant_url_not_wrong_primary(self):
        a=civitai_api.CivitaiAPI();files=copy.deepcopy(FILES);files[1].pop('downloadUrl');files[1].pop('id')
        with self.assertRaises(civitai_api.CivitaiError):a.file_download_url({'id':123,'files':files},files[1])

    def test_attachments_not_selected(self):
        a=civitai_api.CivitaiAPI();self.assertEqual(a.model_files({'files':FILES+[{'type':'Training Data','name':'training.zip'}]}),FILES)

    def test_external_host_url_rejected(self):
        with self.assertRaises(civitai_api.CivitaiError):civitai_api.CivitaiAPI().file_download_url({'files':FILES},{'downloadUrl':'https://evil.example/file'})

    def api(self, policy):
        a=webui.Api.__new__(webui.Api);a.cfg={**config.DEFAULTS,'multi_file_download':policy,'translate_filename':False};a.api=civitai_api.CivitaiAPI();a.api.get_model_version=Mock(return_value={'id':123,'name':'v1','files':copy.deepcopy(FILES)});a.api.get_model=Mock(return_value={'id':456,'name':'Demo'});a.dl=Mock();a._file_choices=FileChoiceBroker();return a

    def test_enqueue_all_file_urls_hashes_and_names_unique(self):
        a=self.api('all');r=a._enqueue_one('https://civitai.red/models/456?modelVersionId=123')
        self.assertTrue(r['ok']);tasks=[c.args[0] for c in a.dl.add_task.call_args_list];self.assertEqual(len(tasks),3);self.assertEqual([t.url for t in tasks],[f['downloadUrl'] for f in FILES]);self.assertEqual(len({t.filename for t in tasks}),3);self.assertEqual([t.expected_sha256 for t in tasks],[f['hashes']['SHA256'] for f in FILES])

    def test_choose_non_primary_diffusion_model_before_enqueue(self):
        a=self.api('ask');version=a.api.get_model_version.return_value
        for f in version['files']:f['type']='Diffusion Model'
        result=[];thread=threading.Thread(target=lambda:result.append(a._enqueue_one('https://civitai.red/models/456?modelVersionId=123')));thread.start()
        for _ in range(100):
            row=a.get_download_file_choice()
            if row:break
            time.sleep(.01)
        self.assertEqual(len(row['files']),3);a.dl.add_task.assert_not_called()
        a.acknowledge_download_file_choice(row['id']);a.respond_download_file_choice(row['id'],[1])
        thread.join(1);self.assertFalse(thread.is_alive());self.assertTrue(result[0]['ok'])
        self.assertEqual(a.dl.add_task.call_args.args[0].info['fileId'],FILES[1]['id'])

    def test_explicit_file_id_honored_not_primary(self):
        a=self.api('ask');r=a._enqueue_one('https://civitai.red/api/download/models/123?fileId=1')
        self.assertTrue(r['ok']);self.assertEqual(a.dl.add_task.call_args.args[0].info['fileId'],1);self.assertIsNone(a.get_download_file_choice())

    def test_unknown_explicit_file_id_never_primary(self):
        a=self.api('ask');r=a._enqueue_one('https://civitai.red/api/download/models/123?fileId=999')
        self.assertFalse(r['ok']);a.dl.add_task.assert_not_called()

    def test_update_download_also_goes_through_choice(self):
        a=self.api('all');r=a._enqueue_one('https://civitai.red/models/456?modelVersionId=123',skip_if_exists=True)
        self.assertTrue(r['ok']);self.assertEqual(a.dl.add_task.call_count,3)

    def test_parse_urls_enqueues_all(self):
        a=self.api('all');self.assertTrue(a.parse_urls(['https://civitai.red/models/456?modelVersionId=123'])['started'])
        for _ in range(100):
            if a.get_parse_state()['finished']:break
            time.sleep(.01)
        self.assertEqual(a.dl.add_task.call_count,3)

    def test_same_filename_variants_get_distinct_paths_and_metadata(self):
        a=self.api('all');version=a.api.get_model_version.return_value
        for f in version['files']: f['name']='same.safetensors'
        r=a._enqueue_one('https://civitai.red/models/456?modelVersionId=123')
        self.assertTrue(r['ok']);tasks=[c.args[0] for c in a.dl.add_task.call_args_list]
        self.assertEqual(len({t.filename for t in tasks}),3)
        for t,f in zip(tasks,version['files']):
            self.assertEqual(t.info['fileId'],f['id'])
            self.assertEqual(t.info['meta']['sd']['hashes'],f['hashes'])

    def test_extension_acknowledges_without_waiting_for_choice(self):
        a=self.api('ask');a.dl_enqueue_url=Mock(return_value={'started':True});a._notify_ext_download_started=Mock()
        self.assertTrue(a.dl_submit_url('https://civitai.red/models/456')['started']);a.dl.add_task.assert_not_called();a._notify_ext_download_started.assert_called_once()


if __name__=='__main__':unittest.main()
