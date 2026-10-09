"""Workflow report / inspector data: synthetic JSON and PNG only."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import webui


class WorkflowLayoutTests(unittest.TestCase):
    def analyze(self, data):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'workflow.json'
            p.write_text(json.dumps(data), encoding='utf-8')
            return json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(p)))

    def test_full_node_list_ids_and_parameters(self):
        r = self.analyze({'nodes':[{'id':i,'type':'Sampler','widgets_values':[1,2,3,4,5,6,7]} for i in range(55)]})
        self.assertTrue(r['ok']); self.assertEqual(len(r['nodes']),55)
        self.assertEqual(r['nodes'][52]['id'],52)
        self.assertEqual(len(r['nodes'][0]['widgets']),7)
        self.assertFalse(r['nodes'][0]['parameter_names_known'])

    def test_ui_connections_resolve_actual_source(self):
        r = self.analyze({'nodes':[{'id':8,'type':'VAE','inputs':[{'name':'samples','link':12}], 'outputs':[{'name':'image','type':'IMAGE'}]}], 'links':[[12,7,0,8,0,'LATENT']]})
        self.assertEqual(r['nodes'][0]['inputs'][0]['source'],7)
        self.assertEqual(r['nodes'][0]['outputs'][0]['type'],'IMAGE')

    def test_api_arbitrary_ids_wrapper_and_model_refs(self):
        r = self.analyze({'prompt':{'99':{'class_type':'Loader','inputs':{'ckpt_name':'watercolor.safetensors'}},'110':{'class_type':'KSampler','inputs':{'steps':24,'model':['99',0]}}}})
        self.assertTrue(r['ok']); self.assertEqual(r['models'],['watercolor.safetensors'])
        n = r['nodes'][1]; self.assertEqual(n['parameters'],[{'name':'steps','value':24}]); self.assertEqual(n['inputs'][0]['source'],'99')

    def test_api_unwrapped_arbitrary_id_recognized(self):
        self.assertTrue(self.analyze({'928':{'class_type':'Loader','inputs':{}}})['ok'])

    def test_prompts_not_silently_truncated(self):
        p = 'mountain lake '*150
        r = self.analyze({'nodes':[{'id':1,'type':'CLIPTextEncode','widgets_values':[p]}]})
        self.assertEqual(r['pos_prompt'],p)

    def test_png_ui_api_merge_no_duplicate_nodes(self):
        from PIL import Image, PngImagePlugin
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'workflow.png'; meta=PngImagePlugin.PngInfo()
            meta.add_text('workflow',json.dumps({'nodes':[{'id':7,'type':'Sampler','widgets_values':[24]}]}))
            meta.add_text('prompt',json.dumps({'7':{'class_type':'Sampler','inputs':{'steps':24}}}))
            Image.new('RGB',(2,2)).save(p,pnginfo=meta)
            r=json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(p)))
            self.assertEqual(r['node_count'],1); self.assertEqual(r['nodes'][0]['parameters'][0]['name'],'steps')

    def test_missing_model_root_still_returns_missing_refs(self):
        a=webui.Api.__new__(webui.Api);a.cfg={'models_dir':'','download_dir':''}
        self.assertEqual(json.loads(a.workflow_model_matches(['x.safetensors'])),[{'ref':'x.safetensors','local':False,'path':''}])


if __name__ == '__main__': unittest.main()
