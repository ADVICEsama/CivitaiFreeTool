import base64, io, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock, patch
from PIL import Image
from webui import Api
import config, system_proxy, app_updates


class FollowupTests(unittest.TestCase):
    def test_cached_cover_written_next_to_model_without_network(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);model=root/'model.safetensors';model.write_bytes(b'model')
            cached=root/'cached.jpg';Image.new('RGB',(80,100),'red').save(cached)
            a=Api.__new__(Api);a._detail_cache_path=Mock(return_value=str(cached));a.get_cover_b64=Mock()
            result=a._ensure_download_preview(str(model),{'images':[{'url':'https://example.test/a.jpg'}]})
            self.assertEqual(Path(result),root/'model.preview.png')
            with Image.open(result) as im:self.assertEqual(im.format,'PNG')
            a.get_cover_b64.assert_not_called()
            before=Path(result).read_bytes();a._ensure_download_preview(str(model),{});self.assertEqual(Path(result).read_bytes(),before)

    def test_cover_enabled_by_default(self):
        self.assertTrue(config.DEFAULTS['download_cover'])

    def test_detect_only_reachable_system_proxy(self):
        cfg={}
        with patch.object(system_proxy.sys,'platform','win32'),patch.object(system_proxy.urllib.request,'getproxies_registry',return_value={'http':'http://127.0.0.1:7890'}),patch.object(system_proxy.socket,'create_connection') as connect:
            self.assertTrue(system_proxy.enable_detected_proxy(cfg));connect.assert_called_once_with(('127.0.0.1',7890),timeout=.35)
            self.assertTrue(cfg['proxy_enabled']);self.assertFalse(system_proxy.enable_detected_proxy(cfg))

    def test_unreachable_proxy_does_not_change_config(self):
        cfg={'proxy_enabled':False}
        with patch.object(system_proxy.sys,'platform','win32'),patch.object(system_proxy.urllib.request,'getproxies_registry',return_value={'http':'http://127.0.0.1:7890'}),patch.object(system_proxy.socket,'create_connection',side_effect=OSError):
            self.assertFalse(system_proxy.enable_detected_proxy(cfg));self.assertEqual(cfg,{'proxy_enabled':False})

    def test_update_rate_limit_falls_back_to_official_release(self):
        opener=Mock();response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.geturl.return_value='https://github.com/ADVICEsama/CivitaiFreeTool/releases/tag/v3.0.18'
        opener.open.side_effect=[OSError('rate limit'),response]
        self.assertTrue(app_updates.check('3.0.17',opener)['available'])

    def test_update_rejects_foreign_redirect(self):
        opener=Mock();response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.geturl.return_value='https://example.test/releases/tag/v9.0.0';opener.open.side_effect=[OSError(),response]
        self.assertFalse(app_updates.check('3.0.17',opener)['ok'])


if __name__=='__main__':unittest.main()
