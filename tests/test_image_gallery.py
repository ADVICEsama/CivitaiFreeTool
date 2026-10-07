import sys,unittest,json,base64
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image,PngImagePlugin
import image_gallery,webui

class GalleryTests(unittest.TestCase):
    def test_saved_civitai_meta_and_resources_retained(self):
        r=image_gallery.generation({'id':123,'width':1024,'height':1536,'meta':{'prompt':'landscape','steps':12},'resources':[{'name':'Landscape','modelId':7}]})
        self.assertEqual(r['meta']['steps'],12);self.assertEqual(r['resources'][0]['modelId'],7)
        self.assertEqual(r['image_page'],'https://civitai.com/images/123')
    def test_missing_data_not_invented(self):
        r=image_gallery.generation({});self.assertEqual(r['meta'],{});self.assertEqual(r['resources'],[])
    def test_png_parameters_parsed(self):
        with TemporaryDirectory() as d:
            p=Path(d)/'example.png';meta=PngImagePlugin.PngInfo();meta.add_text('parameters','a watercolor landscape\nNegative prompt: blur\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 123, Size: 640x480')
            Image.new('RGB',(20,30),'blue').save(p,pnginfo=meta)
            r=image_gallery.generation({},str(p));self.assertEqual(r['meta']['prompt'],'a watercolor landscape');self.assertEqual(r['meta']['negativePrompt'],'blur');self.assertEqual(r['meta']['Seed'],'123')
    def test_comfy_workflow_stays_read_only(self):
        with TemporaryDirectory() as d:
            p=Path(d)/'example.png';meta=PngImagePlugin.PngInfo();meta.add_text('prompt','{"7":{"class_type":"CLIPTextEncode","inputs":{"text":"landscape"}}}');Image.new('RGB',(10,10)).save(p,pnginfo=meta)
            r=image_gallery.generation({},str(p));self.assertIn('comfyPrompt',r['meta']);self.assertNotIn('prompt',r['meta'])
    def test_original_url_only_official_cdn(self):
        self.assertEqual(image_gallery.original_url('https://image.civitai.com/uuid/width=450/test.jpeg'),'https://image.civitai.com/uuid/original=true/test.jpeg')
        for u in ['http://127.0.0.1/img','https://evil.example/img','https://image.civitai.com.evil.example/img','file:///C:/a.png']:
            with self.assertRaises(ValueError):image_gallery.original_url(u)
    def test_original_bytes_preserved_and_preview_does_not_write(self):
        with TemporaryDirectory() as d:
            p=Path(d)/'example.png';Image.new('RGB',(30,50),'blue').save(p)
            b= p.read_bytes();data,fmt,w,h,orig=image_gallery.read_bytes({'local_path':str(p)},{});self.assertEqual(data,b);self.assertEqual((w,h),(30,50));self.assertTrue(orig)
            r=image_gallery.preview({'local_path':str(p)},{});self.assertTrue(r['ok']);self.assertEqual(p.read_bytes(),b);self.assertEqual(len(list(Path(d).iterdir())),1)
    def test_cached_preview_explicitly_not_original(self):
        with TemporaryDirectory() as d:
            p=Path(d)/'example.png';Image.new('RGB',(10,10)).save(p);r=image_gallery.preview({'b64':base64.b64encode(p.read_bytes()).decode()},{});self.assertFalse(r['original_available'])
    def test_invalid_gallery_index_never_reads_arbitrary_path(self):
        api=webui.Api.__new__(webui.Api);api.get_model_detail=Mock(return_value=json.dumps({'ok':True,'covers':[{}]}))
        for index in (-1,1,True,'0'):
            with self.assertRaises(ValueError):api._gallery_item('fixture',index)
    def test_save_uses_explicit_dialog_and_exact_source_bytes(self):
        with TemporaryDirectory() as d:
            src=Path(d)/'src.png';out=Path(d)/'out.png';Image.new('RGB',(20,10)).save(src)
            api=webui.Api.__new__(webui.Api);api.cfg={};api._gallery_item=Mock(return_value={'local_path':str(src)})
            w=Mock();w.create_file_dialog.return_value=(str(out),)
            with patch.object(webui.webview,'windows',[w]):r=api.save_gallery_image('fixture.safetensors',0)
            self.assertTrue(r['ok']);self.assertEqual(out.read_bytes(),src.read_bytes());w.create_file_dialog.assert_called_once()
    def test_cancel_save_writes_nothing(self):
        with TemporaryDirectory() as d:
            src=Path(d)/'src.png';Image.new('RGB',(10,10)).save(src)
            api=webui.Api.__new__(webui.Api);api.cfg={};api._gallery_item=Mock(return_value={'local_path':str(src)});w=Mock();w.create_file_dialog.return_value=None
            with patch.object(webui.webview,'windows',[w]):r=api.save_gallery_image('fixture.safetensors',0)
            self.assertTrue(r['canceled']);self.assertEqual(len(list(Path(d).iterdir())),1)
    def test_single_rename_never_falls_back_to_all_models(self):
        with TemporaryDirectory() as d:
            p=Path(d)/'fixture.safetensors';p.write_bytes(b'fixture');info=Path(d)/'fixture.civitai.info';info.write_text(json.dumps({'name':'Fixture'}),encoding='utf-8')
            api=webui.Api.__new__(webui.Api);api.cfg={};api.dl=Mock();api.model_rows=[{'path':'unrelated.safetensors'}]
            target=str(Path(d)/'new.safetensors')
            with patch.object(webui.model_manager,'rename_to_civitai',return_value=(target,['renamed'])) as rename:
                preview=api.rename_detail_to_civitai(str(p),True);self.assertTrue(preview['ok']);api.dl.relocate.assert_not_called()
                result=api.rename_detail_to_civitai(str(p),False);self.assertTrue(result['ok']);api.dl.relocate.assert_called_once_with(str(p),target)
                self.assertEqual(rename.call_count,2);self.assertEqual(api.model_rows[0]['path'],'unrelated.safetensors')

class ClipboardDibTests(unittest.TestCase):
    def test_jpeg_converts_to_real_dib(self):
        import io,struct
        from PIL import Image
        data=io.BytesIO();Image.new('RGB',(7,9),'blue').save(data,format='JPEG')
        dib=image_gallery.clipboard_dib(data.getvalue());self.assertNotEqual(dib[:2],b'BM');self.assertEqual(struct.unpack('<Iii',dib[:12]),(40,7,9))
    def test_native_copy_uses_owned_window_handle(self):
        import types
        api=webui.Api.__new__(webui.Api)
        api._window_appearance_controller=types.SimpleNamespace(window=types.SimpleNamespace(native=types.SimpleNamespace(Handle=types.SimpleNamespace(ToInt64=lambda:123))))
        api.get_gallery_image=Mock(return_value={'ok':True,'b64':base64.b64encode(b'fixture image bytes').decode()})
        with patch.object(image_gallery,'copy_clipboard_image',return_value=True) as copy:
            self.assertTrue(api.copy_gallery_image('fixture.model',0)['ok']);copy.assert_called_once_with(b'fixture image bytes',123)

    def test_invalid_or_oversized_input_rejected(self):
        with self.assertRaises(Exception):image_gallery.clipboard_dib(b'not an image')
        with self.assertRaises(ValueError):image_gallery.clipboard_dib(b'x'*(image_gallery.LIMIT+1))

if __name__=='__main__':unittest.main()
