"""本地字体 API 回归：假字体列表；真实系统枚举只读。"""
import os,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import local_fonts,webui
class FontTests(unittest.TestCase):
    def test_font_list_cached_and_not_downloaded(self):
        api=webui.Api.__new__(webui.Api)
        with patch.object(local_fonts,'enumerate_fonts',return_value=['Segoe UI','微软雅黑']) as fonts:
            self.assertEqual(api.get_local_fonts()['fonts'],['Segoe UI','微软雅黑'])
            self.assertTrue(api.get_local_fonts()['ok']);fonts.assert_called_once()
    def test_font_read_failure_is_reported(self):
        api=webui.Api.__new__(webui.Api)
        with patch.object(local_fonts,'enumerate_fonts',side_effect=OSError('fixture unavailable')):
            result=api.get_local_fonts();self.assertFalse(result['ok']);self.assertEqual(result['fonts'],[])
    @unittest.skipUnless(sys.platform=='win32','Windows local GDI enumeration')
    def test_installed_fonts_enumerated_readonly(self):
        fonts=local_fonts.enumerate_fonts();self.assertGreater(len(fonts),0);self.assertEqual(len(fonts),len(set(fonts)))
        self.assertFalse(any(font.startswith('@') for font in fonts))
if __name__=='__main__':unittest.main()
