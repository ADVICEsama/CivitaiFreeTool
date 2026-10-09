"""Forge PNG, real connections and local update sync, synthetic metadata only."""
import copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import config,webui
from PIL import Image,PngImagePlugin


class WorkflowForgeSyncTests(unittest.TestCase):
    def test_forge_prompts_model_lora_and_parameters(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'forge.png';meta=PngImagePlugin.PngInfo();meta.add_text('parameters','watercolor landscape <lora:Watercolor:0.8>\nNegative prompt: blurry\nSteps: 24, Sampler: Euler, CFG scale: 7, Seed: 123, Model: Mountain, Size: 512x768')
            Image.new('RGB',(8,8)).save(p,pnginfo=meta);r=json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(p)))
            self.assertTrue(r['ok']);self.assertEqual(r['source'],'forge');self.assertEqual(r['models'],['Mountain','Watercolor']);self.assertEqual(r['neg_prompt'],'blurry');self.assertEqual(r['generation_parameters']['Steps'],'24');self.assertEqual(r['edges'],[]);self.assertEqual(r['nodes'],[]);self.assertTrue(r['preview_b64'])

    def test_comfy_nodes_preserve_actual_positions_and_edges(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'wf.json';p.write_text(json.dumps({'nodes':[{'id':1,'type':'Loader','pos':[20,30]},{'id':2,'type':'Sampler','pos':[350,40],'inputs':[{'name':'model','link':8}]}],'links':[[8,1,0,2,0,'MODEL']]}))
            r=json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(p)));self.assertEqual(r['nodes'][0]['position'],[20,30]);self.assertEqual(r['edges'],[{'source':1,'target':2,'input':'model','slot':0}])

    def test_compressed_workflow_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'wf.png';meta=PngImagePlugin.PngInfo();meta.add_text('workflow',json.dumps({'nodes':[{'id':8,'type':'Loader'}]}),zip=True)
            Image.new('RGB',(2,2)).save(p,pnginfo=meta);r=json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(p)));self.assertTrue(r['ok']);self.assertEqual(r['nodes'][0]['id'],8)

    def test_local_stems_match_only_when_unique(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'Watercolor.safetensors').write_bytes(b'fixture');a=webui.Api.__new__(webui.Api);a.cfg={'models_dir':str(root)}
            self.assertTrue(json.loads(a.workflow_model_matches(['Watercolor']))[0]['local'])
            (root/'Watercolor.ckpt').write_bytes(b'other');self.assertFalse(json.loads(a.workflow_model_matches(['Watercolor']))[0]['local'])

    def api(self,root,alive):
        a=webui.Api.__new__(webui.Api);a.cfg=dict(config.DEFAULTS,models_dir=str(root),models_dirs=[str(root)]);a.mm_scan_state={'running':False};a._mm_upd_state={'running':False};a._updates={'checked_at':99,'items':{str(alive):{'model_name':'Live'},str(root/'deleted.safetensors'):{'model_name':'Deleted'}}};a.model_rows=[{'path':str(alive)}];a.scan_models=Mock(return_value={'started':True});return a

    def test_sync_removes_stale_cache_only(self):
        with tempfile.TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            root=Path(d);live=root/'live.safetensors';live.write_bytes(b'fixture');a=self.api(root,live);r=a.sync_local_model_updates();self.assertTrue(r['ok']);self.assertEqual(r['removed'],1);self.assertTrue(live.exists());self.assertEqual(set(a._updates['items']),{str(live)});self.assertTrue((root/'model_updates.json').exists())

    def test_offline_root_preserves_all_records(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'offline';a=self.api(root,root/'live.safetensors');before=copy.deepcopy(a._updates);self.assertFalse(a.sync_local_model_updates()['ok']);self.assertEqual(a._updates,before);a.scan_models.assert_not_called()

    def test_failed_save_preserves_old_records(self):
        with tempfile.TemporaryDirectory() as d,patch.object(config,'_save_json_atomic',return_value=False):
            root=Path(d);live=root/'live.safetensors';live.write_bytes(b'fixture');a=self.api(root,live);before=copy.deepcopy(a._updates);self.assertFalse(a.sync_local_model_updates()['ok']);self.assertEqual(a._updates,before)

    def test_busy_check_does_not_race_sync(self):
        a=self.api(Path('.'),Path('live'));a._mm_upd_state['running']=True;self.assertFalse(a.sync_local_model_updates()['ok']);a.scan_models.assert_not_called()


if __name__=='__main__':unittest.main()
