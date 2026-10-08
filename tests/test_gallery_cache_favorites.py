"""新功能均使用临时数据和 mock，不访问个人配置、模型或在线账户。"""
import io,json,sys,unittest,copy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image,PngImagePlugin
import config,image_gallery,webui

class LocalGalleryTests(unittest.TestCase):
    def image_bytes(self):
        out=io.BytesIO();png=PngImagePlugin.PngInfo();png.add_text('parameters','mountain\nNegative prompt: blur\nSteps: 24, Seed: 7')
        Image.new('RGB',(120,180),'blue').save(out,format='PNG',pnginfo=png);return out.getvalue()

    def test_original_and_preview_survive_offline_restart(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            cfg={'cache_original_images':True};item={'url':'https://image.civitai.com/fixture/width=450/img.png'}
            response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False);response.read.return_value=self.image_bytes()
            opener=Mock();opener.open.return_value=response
            with patch('civitai_api.build_opener',return_value=opener):first=image_gallery.preview(item,cfg)
            self.assertEqual(first['meta']['prompt'],'mountain');self.assertEqual(opener.open.call_count,1)
            with patch('civitai_api.build_opener',side_effect=AssertionError('must remain offline')):
                second=image_gallery.preview(item,cfg);raw=image_gallery.read_bytes(item,cfg)[0]
            self.assertTrue(second['cache_hit']);self.assertEqual(first['b64'],second['b64']);self.assertEqual(raw,self.image_bytes())

    def test_disable_does_not_read_or_write_cache(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            item={'url':'https://image.civitai.com/fixture/width=450/img.png'}
            image_gallery.cache_store(item,{'cache_original_images':True},'original',self.image_bytes())
            self.assertIsNone(image_gallery.cache_load(item,{'cache_original_images':False},'original'))
            before=len(list((Path(d)/'gallery_cache').iterdir()));image_gallery.cache_store(item,{},'preview',{'ok':True});self.assertEqual(before,len(list((Path(d)/'gallery_cache').iterdir())))

    def test_local_file_change_invalidates_cached_preview(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            p=Path(d)/'img.png';p.write_bytes(self.image_bytes());cfg={'cache_original_images':True};item={'local_path':str(p)}
            a=image_gallery.preview(item,cfg);Image.new('RGB',(60,90),'red').save(p);b=image_gallery.preview(item,cfg)
            self.assertEqual((a['width'],b['width']),(120,60));self.assertFalse(b.get('cache_hit',False))

    def test_corrupt_preview_falls_back_to_valid_original(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            item={'url':'https://image.civitai.com/fixture/width=450/img.png'};cfg={'cache_original_images':True}
            image_gallery.cache_store(item,cfg,'original',self.image_bytes());image_gallery.cache_store(item,cfg,'preview',{'ok':True,'b64':'invalid'})
            with patch('civitai_api.build_opener',side_effect=AssertionError('network forbidden')):r=image_gallery.preview(item,cfg)
            self.assertTrue(r['ok']);self.assertEqual(r['meta']['prompt'],'mountain')

    def test_metadata_is_account_scoped_and_no_credentials_written(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            item={'url':'https://image.civitai.com/fixture/width=450/img.png'};cfg={'cache_original_images':True,'api_key':'mock-private-secret'}
            data={'ok':True,'meta':{'prompt':'landscape'}};image_gallery.cache_store(item,cfg,'metadata',data)
            self.assertEqual(image_gallery.cache_load(item,cfg,'metadata'),data)
            self.assertIsNone(image_gallery.cache_load(item,{**cfg,'api_key':'different-mock'},'metadata'))
            for p in (Path(d)/'gallery_cache').iterdir():self.assertNotIn(cfg['api_key'],p.read_text())

    def test_clear_removes_only_cache_files_and_preserves_models(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            folder=Path(d)/'gallery_cache';folder.mkdir();model=folder/'user.safetensors';model.write_bytes(b'model')
            image_gallery.cache_store({'url':'https://image.civitai.com/fixture/img.png'},{'cache_original_images':True},'original',self.image_bytes())
            self.assertEqual(image_gallery.clear_cache(),1);self.assertEqual(model.read_bytes(),b'model')

    def test_metadata_api_reuses_persistent_known_data(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            item={'url':'https://image.civitai.com/fixture/img.png','image_id':7};cfg={'cache_original_images':True,'api_key':'fixture'}
            api=webui.Api.__new__(webui.Api);api.cfg=cfg;api._gallery_item=Mock(return_value=item)
            image_gallery.cache_store(item,cfg,'metadata',{'ok':True,'meta':{'prompt':'mountain'},'resources':[],'online_metadata':True})
            with patch('civitai_api.CivitaiAPI',side_effect=AssertionError('no request')):r=api.get_gallery_metadata('fixture',0)
            self.assertEqual(r['meta']['prompt'],'mountain')

    def test_capacity_evicts_oldest_and_stays_under_limit(self):
        with TemporaryDirectory() as d,patch.object(config,'APP_DIR',d):
            cfg={'cache_original_images':True,'gallery_cache_mb':64}
            for i in range(3):image_gallery.cache_store({'url':'https://image.civitai.com/'+str(i)},cfg,'original',b'x'*(25*1024*1024))
            files=list((Path(d)/'gallery_cache').iterdir());self.assertLessEqual(sum(p.stat().st_size for p in files),64*1024*1024);self.assertEqual(len(files),2)

    def test_new_cache_is_in_data_migration_whitelist(self):
        import data_storage
        self.assertIn('gallery_cache',data_storage.DATA_NAMES)

class FavoriteResourceTests(unittest.TestCase):
    def api(self):
        a=webui.Api.__new__(webui.Api);a.cfg=copy.deepcopy(config.DEFAULTS);a.model_rows=[];a.dl=Mock();a.api=Mock();a.open_url=Mock();return a
    def test_favorite_toggle_and_save_failure_rollback(self):
        a=self.api()
        with patch.object(config,'save',return_value=True):
            self.assertTrue(a.toggle_model_favorite('D:/models/a.safetensors')['favorite']);self.assertFalse(a.toggle_model_favorite('D:/models/a.safetensors')['favorite'])
        with patch.object(config,'save',return_value=False):self.assertFalse(a.toggle_model_favorite('D:/models/a.safetensors')['ok'])
        self.assertEqual(a.cfg['model_favorites'],[])
    def test_favorite_follows_file_relocation(self):
        a=self.api();a.cfg['model_favorites']=['D:/models/a.safetensors']
        with patch.object(config,'save',return_value=True):a._relocate_model('D:/models/a.safetensors','D:/models/b.safetensors')
        self.assertEqual(a.cfg['model_favorites'],['D:/models/b.safetensors']);a.dl.relocate.assert_called_once()
    def test_resource_model_id_and_version_resolution(self):
        a=self.api();a.api.get_model_version.return_value={'modelId':55}
        self.assertTrue(a.open_gallery_resource({'modelId':9})['direct']);a.open_url.assert_called_with('https://civitai.red/models/9')
        self.assertTrue(a.open_gallery_resource({'modelVersionId':77})['direct']);a.open_url.assert_called_with('https://civitai.red/model-versions/77')
    def test_resource_exact_local_match_else_no_guessing(self):
        a=self.api();a.model_rows=[{'name':'foo.safetensors','modelId':9}]
        self.assertTrue(a.open_gallery_resource({'name':'foo.safetensors'})['direct'])
        r=a.open_gallery_resource({'name':'a & b.safetensors','model':'invalid'});self.assertFalse(r['ok']);self.assertEqual(a.open_url.call_count,1)
    def test_frame_and_cache_limits_and_invalid_favorites(self):
        for value in [None,'bad',float('inf'),-1,10,0,60,144,360,1000]:
            cfg={'effects_fps_limit':value,'gallery_cache_mb':value,'model_favorites':'invalid'};config.normalize_ui_preferences(cfg)
            self.assertTrue(cfg['effects_fps_limit']==0 or 15<=cfg['effects_fps_limit']<=360);self.assertTrue(64<=cfg['gallery_cache_mb']<=8192);self.assertEqual(cfg['model_favorites'],[])
        cfg={'model_favorites':['p','p','',1]};config.normalize_ui_preferences(cfg);self.assertEqual(cfg['model_favorites'],['p'])

if __name__=='__main__':unittest.main()
