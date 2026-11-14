import base64,io,json,unittest
from unittest.mock import Mock,patch
from PIL import Image
from webui import Api
import model_share
class SharePreviewBudgetTests(unittest.TestCase):
 def test_extra_images_never_request_originals(self):
  buf=io.BytesIO();Image.new('RGB',(160,240),'red').save(buf,'PNG');data=buf.getvalue();b64=base64.b64encode(data).decode();a=Api.__new__(Api);a.cfg={}
  a.get_model_detail=Mock(return_value=json.dumps({'ok':True,'covers':[{'b64':b64},{'b64':b64},{'url':'https://image.civitai.com/test/width=450/image.png'}]}));a.get_gallery_image=Mock(return_value={'ok':True,'b64':b64});a.get_cover_b64=Mock(return_value=b64);a._detail_cache_path=Mock(return_value='not-a-cached-image')
  with patch.object(model_share,'render',return_value=data) as render:
   result=a.share_model_card('test.safetensors');self.assertTrue(result['ok']);a.get_gallery_image.assert_called_once_with('test.safetensors',0);a.get_cover_b64.assert_called_once_with('https://image.civitai.com/test/width=450/image.png',160,timeout=2);self.assertEqual(render.call_args.args[4],[data,data])
if __name__=='__main__':unittest.main()
