"""来源描述复用与启动路由：仅临时数据，不打开真实浏览器或结束任何程序。"""
import copy,json,sys,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image
import config,webui,main_web,image_gallery

class GalleryReuseTests(unittest.TestCase):
    def fixture(self,d):
        p=Path(d)/'demo.safetensors';p.write_bytes(b'model');p.with_suffix('.civitai.info').write_text(json.dumps({'name':'Demo','images':[]}),encoding='utf-8');Image.new('RGB',(60,90),'blue').save(p.with_suffix('.preview.png'))
        a=webui.Api.__new__(webui.Api);a.cfg={};return a,p
    def test_reuses_detail_description_without_reencoding_all_thumbnails(self):
        with TemporaryDirectory() as d:
            a,p=self.fixture(d);detail=json.loads(a.get_model_detail(str(p)));self.assertTrue(detail['covers'][0]['source_revision'])
            a.get_model_detail=Mock(side_effect=AssertionError('must not rebuild thumbnails'))
            self.assertTrue(a.get_gallery_image(str(p),0)['ok']);self.assertTrue(a.get_gallery_metadata(str(p),0)['ok']);a.get_model_detail.assert_not_called()
    def test_local_picture_change_invalidates_description(self):
        with TemporaryDirectory() as d:
            a,p=self.fixture(d);old=json.loads(a.get_model_detail(str(p)))['covers'][0]['source_revision'];real=a.get_model_detail;a.get_model_detail=Mock(wraps=real)
            Image.new('RGB',(80,100),'red').save(p.with_suffix('.preview.png'));r=a.get_gallery_image(str(p),0)
            self.assertEqual(r['width'],80);a.get_model_detail.assert_called_once();new=json.loads(real(str(p)))['covers'][0]['source_revision'];self.assertNotEqual(old,new)
    def test_metadata_file_change_invalidates_description(self):
        with TemporaryDirectory() as d:
            a,p=self.fixture(d);a.get_model_detail(str(p));real=a.get_model_detail;a.get_model_detail=Mock(wraps=real);p.with_suffix('.civitai.info').write_text(json.dumps({'name':'Changed longer name','images':[]}),encoding='utf-8')
            self.assertTrue(a.get_gallery_image(str(p),0)['ok']);a.get_model_detail.assert_called_once()
    def test_account_change_invalidates_description(self):
        with TemporaryDirectory() as d:
            a,p=self.fixture(d);a.get_model_detail(str(p));real=a.get_model_detail;a.get_model_detail=Mock(wraps=real);a.cfg['api_key']='mock-account-change'
            self.assertTrue(a.get_gallery_image(str(p),0)['ok']);a.get_model_detail.assert_called_once()
    def test_description_cache_is_bounded(self):
        a=webui.Api.__new__(webui.Api);a.cfg={}
        for i in range(40):a._remember_gallery_detail('fixture/'+str(i),[{'url':'https://image.civitai.com/'+str(i)}])
        self.assertLessEqual(len(a._gallery_detail_cache),32)
    def test_index_bool_or_out_of_range_still_rejected_on_cache_hit(self):
        with TemporaryDirectory() as d:
            a,p=self.fixture(d);a.get_model_detail(str(p))
            for index in [True,-1,99,'0']:
                with self.assertRaises(ValueError):a._gallery_item(str(p),index)

class StartupRouteTests(unittest.TestCase):
    def test_default_prefers_window_even_when_fallback_enabled(self):
        self.assertEqual(main_web._launch_ui_mode(['app.exe'],copy.deepcopy(config.DEFAULTS)),'window')
    def test_saved_browser_mode_does_not_attempt_window(self):
        with patch.object(config,'load',return_value={'ui_mode':'browser'}),patch.object(sys,'argv',['app.exe']),patch.object(main_web,'_browser_mode',return_value='browser') as browser,patch.object(main_web,'_single_instance',side_effect=AssertionError('native startup must not run')):
            self.assertEqual(main_web.main(),'browser');browser.assert_called_once()
    def test_fallback_is_not_the_normal_startup_route(self):
        for fallback in [True,False]:self.assertEqual(main_web._launch_ui_mode(['app.exe'],{'ui_mode':'window','browser_fallback_enabled':fallback}),'window')
    def test_only_explicit_cli_overrides_saved_choice(self):
        self.assertEqual(main_web._launch_ui_mode(['app.exe','--window'],{'ui_mode':'browser'}),'window');self.assertEqual(main_web._launch_ui_mode(['app.exe','--browser'],{'ui_mode':'window'}),'browser')
    def test_invalid_saved_mode_falls_back_to_window(self):
        for mode in [None,False,'bad','native']:self.assertEqual(main_web._launch_ui_mode(['app.exe'],{'ui_mode':mode}),'window')

if __name__=='__main__':unittest.main()
