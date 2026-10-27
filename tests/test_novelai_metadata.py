"""Synthetic NovelAI fixtures only: never save user images or private prompts."""
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
import image_gallery
import webui


def legacy():
    return {'prompt': 'synthetic lake <lora:not-a-local-dependency:1>',
            'uc': 'synthetic blur', 'steps': 28, 'scale': 5.5,
            'sampler': 'k_euler', 'seed': 1234, 'width': 832, 'height': 1216,
            'model_name': 'nai-diffusion-test', 'noise_schedule': 'native'}


def multichar():
    fields = legacy()
    fields['v4_prompt'] = {'caption': {'base_caption': 'synthetic group', 'char_captions': [
        {'char_caption': 'synthetic first character', 'centers': [{'x': .25, 'y': .5}]},
        {'char_caption': 'synthetic second character', 'centers': [{'x': .75, 'y': .5}]}]}}
    fields['v4_negative_prompt'] = {'caption': {'base_caption': 'synthetic defects', 'char_captions': [
        {'char_caption': '', 'centers': [{'x': .25, 'y': .5}]},
        {'char_caption': 'synthetic extra limbs', 'centers': [{'x': .75, 'y': .5}]}]}}
    return fields


def png(path, fields, extras=None):
    meta = PngImagePlugin.PngInfo()
    meta.add_text('Software', 'NovelAI')
    meta.add_text('Description', 'description fallback')
    meta.add_text('Comment', json.dumps(fields, ensure_ascii=False))
    for key, value in (extras or {}).items():
        meta.add_text(key, value)
    Image.new('RGBA', (83, 121), (30, 40, 50, 255)).save(path, pnginfo=meta)


class NovelAIMetadataTests(unittest.TestCase):
    def test_uppercase_comment_legacy_parameters(self):
        r = parser.extract_novelai_metadata({'Software': 'NovelAI', 'Comment': json.dumps(legacy())})
        self.assertEqual(r['prompt'], legacy()['prompt'])
        self.assertEqual(r['negativePrompt'], legacy()['uc'])
        self.assertEqual(r['Steps'], 28)
        self.assertEqual(r['CFG scale'], 5.5)
        self.assertEqual(r['Model'], 'nai-diffusion-test')
        self.assertNotIn('resources', r)
        self.assertNotIn('models', r)

    def test_character_prompts_order_and_coordinates_are_preserved(self):
        fields = multichar()
        r = parser.extract_novelai_metadata({'Comment': json.dumps(fields)})
        self.assertEqual(r['prompt'], 'synthetic group\n\n[角色 1]\nsynthetic first character\n\n[角色 2]\nsynthetic second character')
        self.assertEqual(r['negativePrompt'], 'synthetic defects\n\n[角色 2]\nsynthetic extra limbs')
        self.assertEqual(r['NovelAI characters'][0]['centers'], [{'x': .25, 'y': .5}])
        self.assertEqual(r['NovelAI characters'][1]['negativePrompt'], 'synthetic extra limbs')
        self.assertEqual(r['NovelAI saved parameters'], fields)
        self.assertIn('原始坐标与结构', r['promptExtractionNote'])

    def test_empty_structured_caption_is_authoritative(self):
        fields = multichar()
        fields['v4_prompt']['caption'] = {'base_caption': '', 'char_captions': []}
        self.assertEqual(parser.extract_novelai_metadata({'Comment': fields})['prompt'], '')

    def test_description_fallback_and_malformed_json_note(self):
        r = parser.extract_novelai_metadata({'Software': 'NovelAI', 'Description': 'synthetic fallback', 'Comment': '{'})
        self.assertEqual(r['prompt'], 'synthetic fallback')
        self.assertEqual(r['negativePrompt'], '')
        self.assertNotIn('Model', r)
        self.assertIn('无法解析', r['promptExtractionNote'])

    def test_casefold_and_exif_ascii_usercomment(self):
        fields = json.dumps(legacy()).encode()
        r = parser.extract_novelai_metadata({'sOfTwArE': 'NovelAI', 'USERCOMMENT': b'ASCII\0\0\0' + fields})
        self.assertEqual(r['negativePrompt'], legacy()['uc'])

    def test_exif_unicode_usercomment(self):
        r = parser.extract_novelai_metadata({'UserComment': b'UNICODE\0' + json.dumps(legacy()).encode('utf-16')})
        self.assertEqual(r['Seed'], 1234)

    def test_unrelated_or_invalid_metadata_not_misclassified(self):
        for info in (None, [], {'Comment': '{'}, {'Comment': '{"prompt":"generic","steps":20}'},
                     {'Comment': b'\xff\xfe'}, {'Comment': '[]'}):
            with self.subTest(info_type=type(info).__name__):
                self.assertEqual(parser.extract_novelai_metadata(info), {})

    def test_oversized_comment_is_rejected(self):
        with patch.object(parser, 'NOVELAI_COMMENT_LIMIT', 30):
            self.assertEqual(parser.extract_novelai_metadata({'Software': 'NovelAI', 'Comment': json.dumps(legacy())}), {})
            self.assertEqual(parser.extract_novelai_metadata({'Software': 'NovelAI', 'Comment': legacy()}), {})

    def test_decoded_parameters_are_json_only_and_independent(self):
        fields = multichar()
        original = copy.deepcopy(fields)
        r = parser.extract_novelai_metadata({'Comment': fields})
        r['NovelAI saved parameters']['v4_prompt']['caption']['base_caption'] = 'changed'
        self.assertEqual(fields, original)
        fields['seed'] = float('nan')
        self.assertEqual(parser.extract_novelai_metadata({'Comment': fields}), {})

    def test_invalid_centers_are_ignored_without_losing_prompt(self):
        fields = multichar()
        fields['v4_prompt']['caption']['char_captions'][0]['centers'] = [
            {'x': 1e400, 'y': .5}, {'x': True, 'y': .5}, {'x': 10 ** 500, 'y': .5}, {'x': .25, 'y': .5}]
        r = parser.extract_novelai_metadata({'Comment': json.dumps(fields)})
        self.assertEqual(r['NovelAI characters'][0]['centers'], [{'x': .25, 'y': .5}])

    def test_gallery_and_workflow_agree_and_never_modify_source(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'novelai.png'
            png(path, multichar())
            before = path.read_bytes()
            gallery = image_gallery.generation(local_path=str(path))
            result = json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(path)))
            self.assertTrue(result['ok'])
            self.assertEqual(result['source'], 'novelai')
            self.assertEqual(result['pos_prompt'], gallery['meta']['prompt'])
            self.assertEqual(result['neg_prompt'], gallery['meta']['negativePrompt'])
            self.assertEqual(result['generation_parameters']['Steps'], 28)
            self.assertEqual(result['generation_parameters']['Model'], 'nai-diffusion-test')
            self.assertEqual(result['prompt_notes'], gallery['metadata_note'])
            for field in ('nodes', 'edges', 'models', 'disabled_models'):
                self.assertEqual(result[field], [])
            self.assertEqual(result['node_count'], 0)
            self.assertFalse(result['has_workflow'])
            self.assertTrue(result['preview_b64'])
            self.assertIn('NovelAI', gallery['metadata_source'])
            self.assertEqual(path.read_bytes(), before)

    def test_forge_parameters_take_precedence_over_comment(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'mixed-forge.png'
            png(path, multichar(), {'parameters': 'synthetic forge\nNegative prompt: synthetic forge negative\nSteps: 10, Model: Local, Seed: 42'})
            gallery = image_gallery.generation(local_path=str(path))
            result = json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(path)))
            self.assertEqual(result['source'], 'forge')
            self.assertEqual(result['pos_prompt'], 'synthetic forge')
            self.assertEqual(gallery['meta']['prompt'], result['pos_prompt'])
            self.assertEqual(result['models'], ['Local'])

    def test_comfy_graph_takes_precedence_over_comment(self):
        graph = {'1': {'class_type': 'CLIPTextEncode', 'inputs': {'text': 'synthetic comfy'}},
                 '2': {'class_type': 'KSampler', 'inputs': {'positive': ['1', 0]}}}
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'mixed-comfy.png'
            png(path, multichar(), {'prompt': json.dumps(graph)})
            gallery = image_gallery.generation(local_path=str(path))
            result = json.loads(webui.Api.__new__(webui.Api).analyze_workflow(str(path)))
            self.assertEqual(result['source'], 'comfyui')
            self.assertEqual(result['pos_prompt'], 'synthetic comfy')
            self.assertEqual(gallery['meta']['prompt'], result['pos_prompt'])
            self.assertNotIn('NovelAI saved parameters', result['generation_parameters'])


if __name__ == '__main__':
    unittest.main()
