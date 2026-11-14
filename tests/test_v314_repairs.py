import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock as Mock
from PIL import Image
import image_gallery,config,app_updates
from webui import Api
class RepairTests(unittest.TestCase):
 def data(self):
  out=io.BytesIO();Image.new('RGB',(160,240),'red').save(out,'PNG');return out.getvalue()
 def test_default_cache_reuse_and_set_cover(self):
  with tempfile.TemporaryDirectory() as temp,patch.object(config,'APP_DIR',temp):
   model=Path(temp)/'model.safetensors';model.write_bytes(b'model');a=Api.__new__(Api);a.cfg={};a._cover_cache={}
   first={'url':'https://image.civitai.com/fixture/width=450/image.png'};second={'url':'https://image.civitai.com/fixture/original=true/image.png'}
   image_gallery.cache_store(first,{},'original',self.data())
   with patch('civitai_api.build_opener',side_effect=AssertionError('must not request network')):
    data=image_gallery.read_bytes(second,{})[0];self.assertEqual(data,self.data())
    result=a.set_model_cover(str(model),'',second['url']);self.assertTrue(result['ok'],result)
    covers=json.loads(a.get_covers([str(model)],1024));self.assertIn(str(model),covers)
   self.assertEqual(Image.open(result['cover']).getpixel((10,10)),(255,0,0))
 def test_update_versions_and_safe_link(self):
  opener=Mock();opener.open.return_value.__enter__.return_value.read.return_value=json.dumps({'tag_name':'v3.0.99','html_url':'https://evil.invalid'}).encode()
  result=app_updates.check('3.0.14',opener);self.assertTrue(result['available']);self.assertTrue(result['url'].startswith('https://github.com/ADVICEsama/'))
  opener.open.return_value.__enter__.return_value.read.return_value=json.dumps({'tag_name':'v3.0.13'}).encode();self.assertFalse(app_updates.check('3.0.14',opener)['available'])
if __name__=='__main__':unittest.main()

