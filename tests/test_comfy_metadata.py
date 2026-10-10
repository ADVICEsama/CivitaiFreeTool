"""Synthetic fixtures only; never commit users' PNGs or prompts."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image, PngImagePlugin
import comfy_metadata as parser
import config
import image_gallery
import webui


def node(kind, **inputs):
    return {'class_type': kind, 'inputs': inputs}


def fixture():
    return {'2': node('KSampler', positive=['45', 1], negative=['8', 0], steps=20),
            '45': node(parser.WEILIN, positive='mountain landscape', auto_random=False),
            '8': node('ConditioningZeroOut', conditioning=['45', 1]),
            '32': node('CLIPTextEncode', text='unused old positive'),
            '33': node('CLIPTextEncode', text='unused old negative')}


class ComfyPromptTests(unittest.TestCase):
    def test_weilin_and_zero_negative(self):
        r = parser.extract_prompts(fixture())
        self.assertEqual(r['prompt'], 'mountain landscape')
        self.assertEqual(r['negativePrompt'], '')
        self.assertIn('负向条件已清零', r['promptExtractionNote'])

    def test_api_wrapper(self):
        self.assertEqual(parser.extract_prompts({'prompt': fixture()})['prompt'], 'mountain landscape')

    def test_json_positive_uses_prompt_not_editor_state(self):
        g = fixture(); g['45']['inputs']['positive'] = json.dumps({'prompt':'lake', 'tags':['editor state']})
        self.assertEqual(parser.extract_prompts(g)['prompt'], 'lake')

    def test_opt_text_resolved_and_prefixed(self):
        g = fixture();g['45']['inputs']['opt_text'] = ['60', 0];g['60'] = node('CR Text', text='watercolor')
        self.assertEqual(parser.extract_prompts(g)['prompt'], 'watercolor, mountain landscape')

    def test_unknown_trigger_output_not_guessed(self):
        g = fixture();g['45']['inputs']['opt_text'] = ['60', 0]
        g['60'] = node('UnknownCustomNode', text='not the output')
        r = parser.extract_prompts(g)
        self.assertEqual(r['prompt'], 'mountain landscape');self.assertIn('外接文字', r['promptExtractionNote'])

    def test_random_template_never_executed_or_claimed_final(self):
        g = fixture();g['45']['inputs'].update(auto_random=True, random_template='private-template.txt')
        r = parser.extract_prompts(g);self.assertEqual(r['prompt'], 'mountain landscape')
        self.assertIn('无法重建', r['promptExtractionNote'])

    def test_show_text_cached_output_never_used(self):
        g = fixture();g['45']['inputs']['opt_text'] = ['60', 0]
        g['60'] = node('ShowText|pysssss', text_0='stale output', text=['32',0])
        self.assertEqual(parser.extract_prompts(g)['prompt'], 'mountain landscape')

    def test_clip_linked_to_weilin_string_slot(self):
        g = fixture();g['2']['inputs']['positive'] = ['70',0];g['70'] = node('CLIPTextEncode', text=['45',0])
        self.assertEqual(parser.extract_prompts(g)['prompt'], 'mountain landscape')

    def test_clip_uses_connected_text_only(self):
        g = fixture();g['2']['inputs'].update(positive=['33',0],negative=['32',0])
        r = parser.extract_prompts(g);self.assertEqual(r['prompt'],'unused old negative')
        self.assertEqual(r['negativePrompt'],'unused old positive')

    def test_conditioning_combine_deduplicates_and_stops_zero(self):
        g = fixture();g['2']['inputs']['positive'] = ['70',0]
        g['70'] = node('ConditioningCombine', conditioning_1=['45',1],conditioning_2=['8',0])
        self.assertEqual(parser.extract_prompts(g)['prompt'], 'mountain landscape')

    def test_unknown_conditioning_does_not_walk_unrelated_inputs(self):
        g = fixture();g['2']['inputs']['positive'] = ['70',0]
        g['70'] = node('UnknownConditioningNode', text=['32',0])
        r = parser.extract_prompts(g);self.assertEqual(r['prompt'],'');self.assertIn('无法还原',r['promptExtractionNote'])

    def test_cycle_bounded(self):
        g = fixture();g['45']['inputs']['opt_text'] = ['45',0]
        r = parser.extract_prompts(g);self.assertIn('循环',r['promptExtractionNote'])

    def test_api_does_not_fallback_to_disabled_ui_nodes(self):
        wf = {'nodes':[{'id':32,'type':'CLIPTextEncode','mode':2,'widgets_values':['old']}]}
        self.assertEqual(parser.extract_prompts(fixture(),wf)['prompt'],'mountain landscape')
        self.assertEqual(parser.extract_prompts(None,wf),{})

    def test_ui_only_real_sampler_connections(self):
        wf = {'nodes':[{'id':1,'type':'KSampler','inputs':[{'name':'positive','link':1},{'name':'negative','link':2}]},
                       {'id':2,'type':'CLIPTextEncode','widgets_values':['positive']},
                       {'id':3,'type':'CLIPTextEncode','widgets_values':['negative']},
                       {'id':4,'type':'CLIPTextEncode','mode':4,'widgets_values':['bypassed']}],
              'links':[[1,2,0,1,0,'CONDITIONING'],[2,3,0,1,1,'CONDITIONING']]}
        r=parser.extract_prompts(None,wf);self.assertEqual(r['prompt'],'positive');self.assertEqual(r['negativePrompt'],'negative')

    def test_no_sampler_api_not_assigned_polarity_by_order(self):
        self.assertEqual(parser.extract_prompts({'1':node('CLIPTextEncode',text='unknown usage')}),{})

    def test_custom_advanced_guider(self):
        g=fixture();g['2']=node('SamplerCustomAdvanced',guider=['70',0]);g['70']=node('CFGGuider',positive=['45',1],negative=['8',0])
        self.assertEqual(parser.extract_prompts(g)['prompt'],'mountain landscape')

    def test_extraction_never_changes_graph(self):
        g=fixture();original=copy.deepcopy(g);parser.extract_prompts(g);self.assertEqual(g,original)

    def test_malformed_ui_collections_ignored(self):
        for wf in ({'nodes':{}}, {'nodes':'bad'}, {'links':1}, {'nodes':[None,False,{}]}):
            self.assertEqual(parser.extract_prompts(workflow=wf),{})

    def test_ui_only_gallery_fallback_identical(self):
        wf={'nodes':[{'id':1,'type':'CLIPTextEncode','widgets_values':['single saved text']}]}
        r=image_gallery.generation(saved={'workflow':json.dumps(wf)})
        self.assertEqual(r['meta']['prompt'],'single saved text')
        self.assertIn('用途未核实',r['metadata_note'])

    def test_gallery_and_workflow_same_result_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'synthetic.png';info=PngImagePlugin.PngInfo()
            info.add_text('prompt',json.dumps(fixture()),zip=True)
            info.add_text('workflow',json.dumps({'nodes':[{'id':32,'type':'CLIPTextEncode','mode':2,'widgets_values':['old']}]}),zip=True)
            Image.new('RGB',(4,4)).save(p,pnginfo=info);before=p.read_bytes()
            a=json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(p)))
            b=image_gallery.generation(local_path=str(p))
            self.assertEqual(a['pos_prompt'],'mountain landscape');self.assertEqual(a['pos_prompt'],b['meta']['prompt'])
            self.assertEqual(a['neg_prompt'],b['meta']['negativePrompt']);self.assertIn('已清零',b['metadata_note'])
            self.assertIn('已清零',image_gallery.preview({'local_path':str(p)},{})['metadata_note'])
            self.assertEqual(p.read_bytes(),before)

    def test_parser_revision_invalidates_metadata_but_preserves_original(self):
        with tempfile.TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            cfg={'cache_original_images':True};item={'url':'https://image.civitai.com/a/width=100/img.png'}
            with patch.object(image_gallery,'PARSER_REVISION','old-parser'):
                image_gallery.cache_store(item,cfg,'original',b'original bytes')
                image_gallery.cache_store(item,cfg,'metadata',{'ok':True,'meta':{'prompt':'wrong'}})
                image_gallery.cache_store(item,cfg,'preview',{'ok':True,'meta':{'prompt':'wrong'}})
            self.assertEqual(image_gallery.cache_load(item,cfg,'original'),b'original bytes')
            self.assertIsNone(image_gallery.cache_load(item,cfg,'metadata'))
            self.assertIsNone(image_gallery.cache_load(item,cfg,'preview'))


if __name__ == '__main__':
    unittest.main()
