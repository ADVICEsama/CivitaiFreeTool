import io,unittest
from unittest.mock import patch
from PIL import Image
import model_share
class ShareTests(unittest.TestCase):
 def setUp(self):self.detail={'name':'test.safetensors','info':{'name':'林间水彩 '+('长标题 '*50),'modelId':123,'type':'LORA','version':{'name':'v1.2','baseModel':'Anima'},'creator':{'username':'示例作者'},'description':'<p>水彩风景</p><script>BAD()</script><p>柔和光影</p>'}}
 def test_plain(self):self.assertEqual(model_share.plain('<p>a</p><script>bad</script><p>b</p>'),'a b')
 def test_links(self):
  self.assertEqual(model_share.model_url(self.detail),'https://civitai.com/models/123')
  self.assertEqual(model_share.model_url({'info':{'url':'https://evil.test/models/123'}}),'')
 def test_themes(self):
  for theme,color in [('dark',(36,42,41)),('light',(238,240,232))]:
   data=model_share.render(self.detail,theme=theme);im=Image.open(io.BytesIO(data));self.assertEqual(im.size,(1200,600));self.assertTrue(all(abs(a-b)<35 for a,b in zip(im.getpixel((1190,200)),color)))
 def test_cover_and_empty_metadata(self):
  buf=io.BytesIO();Image.new('RGB',(400,700),'blue').save(buf,'PNG');data=model_share.render({'name':'x'},buf.getvalue());self.assertEqual(Image.open(io.BytesIO(data)).getpixel((50,80)),(0,0,255))
 def test_qr_target(self):
  with patch.object(model_share.qrcode.QRCode,'add_data',autospec=True) as add:
   model_share.render(self.detail);self.assertEqual(add.call_args.args[1],'https://civitai.com/models/123')
if __name__=='__main__':unittest.main()
