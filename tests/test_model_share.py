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
 def test_emoji_clusters_and_digits(self):
  self.assertEqual(model_share.text_clusters('A👩🏽‍🎨🇹🇼1️⃣B'),['A','👩🏽‍🎨','🇹🇼','1️⃣','B'])
  self.assertEqual(model_share.text_family('1'),'digits')
  self.assertEqual(model_share.text_family('１'),'digits')
  self.assertEqual(model_share.text_family('😀'),'emoji')
  self.assertEqual(model_share.text_family('1️⃣'),'emoji')
 def test_emoji_render_and_font_routing(self):
  detail={'name':'模型 123 😀','info':{'description':'Emoji 👩🏽‍🎨 🇹🇼 1️⃣ ✨ / 数字 2026 v1.2'}}
  fonts=[];original=model_share.ImageFont.truetype
  def load(path,*args,**kw):fonts.append(str(path));return original(path,*args,**kw)
  with patch.object(model_share.ImageFont,'truetype',side_effect=load):
   data=model_share.render(detail)
  self.assertIn('LINESeedSans_Bd.otf',' '.join(fonts))
  if model_share.sys.platform=='win32':self.assertIn('seguiemj.ttf',' '.join(fonts))
  self.assertEqual(Image.open(io.BytesIO(data)).size,(1200,600))
 def test_custom_digit_route(self):
  with patch.object(model_share,'custom_font_file',return_value=None) as resolve:
   model_share.render({'name':'数字 123'},font_config={'ui_font_scripts':{'digits':['Test Digits']},'ui_font_stack':['Test Default']})
  self.assertTrue(any(args.args[0]==['Test Digits','Test Default'] for args in resolve.call_args_list))
 def test_word_wrapping_and_paragraphs(self):
  self.assertEqual(model_share.wrap_text('Dario when are you going',12,len),['Dario when','are you','going'])
  self.assertEqual(model_share.plain('<p>one</p><p>two</p>',paragraphs=True).split(),['one','two'])
  self.assertIn('\n',model_share.plain('<p>one</p><p>two</p>',paragraphs=True))
 def test_gallery_strip_with_long_description(self):
  image=io.BytesIO();Image.new('RGB',(100,200),'red').save(image,'PNG')
  data=model_share.render({'name':'Test','info':{'description':'long description '*100}},previews=[image.getvalue()])
  out=Image.open(io.BytesIO(data));self.assertEqual(out.getpixel((450,520)),(255,0,0))
 def test_qr_target(self):
  with patch.object(model_share.qrcode.QRCode,'add_data',autospec=True) as add:
   model_share.render(self.detail);self.assertEqual(add.call_args.args[1],'https://civitai.com/models/123')
if __name__=='__main__':unittest.main()
