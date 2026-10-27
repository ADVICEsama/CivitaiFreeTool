import unittest
from unittest.mock import patch
import config
from webui import Api
class AppearanceTargets(unittest.TestCase):
 def api(self):
  api=Api.__new__(Api)
  api.cfg={'models_dir':'D:/Synthetic','models_dirs':['D:/Synthetic']}
  api._model_inventory=[{'path':'D:/Synthetic/A/a.safetensors','base':'Actual','type':'LORA'}, {'path':'D:/Synthetic/A/Child/b.safetensors','base':'Actual','type':'LORA'}, {'path':'D:/Synthetic/B/c.safetensors','base':'Another','type':'VAE'}]
  api.model_rows=api._model_inventory[:1]
  api._models_roots=lambda:['D:/Synthetic']
  return api
 def test_targets_include_hidden_inventory_not_invented_bases(self):
  a=self.api();r=a.get_model_appearance_targets();self.assertEqual(r['model_count'],3);self.assertEqual({x['label'] for x in r['bases']},{'Actual','Another'});self.assertEqual(next(x['count'] for x in r['bases'] if x['label']=='Actual'),2)
 def test_folder_targets_include_parent_and_subdirectory(self):
  a=self.api();r={x['key']:x for x in a.get_model_appearance_targets()['folders']};self.assertEqual(r['folder:d:/synthetic/a']['count'],2);self.assertEqual(r['folder:d:/synthetic/a/child']['count'],1);self.assertNotIn('folder:d:',r)
 def test_empty_inventory_no_hardcoded_choices(self):
  a=self.api();a._model_inventory=[];self.assertEqual(a.get_model_appearance_targets(),{'bases':[],'folders':[],'model_count':0})
 def test_no_inventory_legacy_fallback(self):
  a=self.api();del a._model_inventory;self.assertEqual(a.get_model_appearance_targets()['model_count'],1)
 def test_folder_style_is_canonical_and_opacity_bounded(self):
  value=config.normalize_model_card_styles({'folder:D:\\Synthetic\\A':{'glow':'#12Ab34','frames':[],'opacity':145}})
  self.assertEqual(value['folder:d:/synthetic/a']['glow'],'#12ab34');self.assertEqual(value['folder:d:/synthetic/a']['opacity'],100)
if __name__=='__main__':unittest.main()
