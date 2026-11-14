import base64,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
from PIL import Image
from webui import Api
import model_share
class ModelDetailCacheTests(unittest.TestCase):
 def test_cached_detail_reuses_previews_and_invalidates_sidecar(self):
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'model.safetensors';path.write_bytes(b'model');info=path.with_suffix('.json');info.write_text('{}')
   a=Api.__new__(Api);a.cfg={};a._get_model_detail_uncached=Mock(return_value=json.dumps({'ok':True,'covers':[]}));a._remember_gallery_detail=Mock()
   with patch('model_manager.find_info_file',return_value=str(info)),patch('model_manager.find_cover',return_value=None):
    first=a.get_model_detail(str(path));self.assertEqual(a.get_model_detail(str(path)),first);self.assertEqual(a._get_model_detail_uncached.call_count,1)
    info.write_text('{"changed":true}');a.get_model_detail(str(path));self.assertEqual(a._get_model_detail_uncached.call_count,2)
 def test_supplied_auxiliary_previews_require_no_network(self):
  f=io.BytesIO();Image.new('RGB',(56,84),'red').save(f,'PNG');data=f.getvalue();encoded=base64.b64encode(data).decode()
  a=Api.__new__(Api);a.cfg={};a.get_model_detail=Mock(return_value=json.dumps({'ok':True,'covers':[{'b64':encoded},{'url':'https://example.test/remote.png'}]}));a.get_gallery_image=Mock(return_value={'ok':True,'b64':encoded});a.get_cover_b64=Mock(side_effect=AssertionError('no network for auxiliary preview'))
  with patch.object(model_share,'render',return_value=data) as render:
   self.assertTrue(a.share_model_card('test',preview_thumbs=[{'index':1,'b64':encoded}])['ok']);a.get_gallery_image.assert_called_once_with('test',0);a.get_cover_b64.assert_not_called();self.assertEqual(render.call_args.args[4],[data])
if __name__=='__main__':unittest.main()
