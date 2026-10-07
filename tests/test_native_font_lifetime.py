"""模拟 WinForms Font.Equals 保留原对象及 pythonnet getter 返回新代理。"""
import unittest,sys,types
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import native_chrome

class FontProxy:
    def __init__(self,value):self.value=value
    def Dispose(self):self.value['disposed']=True

class Label:
    def __init__(self):self.value={'signature':('Microsoft YaHei UI',13),'disposed':False}
    @property
    def Font(self):return FontProxy(self.value) # 每次 getter 的 Python 代理均不相同。
    @Font.setter
    def Font(self,value):
        if self.value['signature']!=value.value['signature']:self.value=value.value

class FontLifetimeTests(unittest.TestCase):
    def test_repeated_refresh_and_equivalent_fonts_do_not_dispose_active_font(self):
        made=[]
        def factory(family,size,*_):
            value={'signature':(family,size),'disposed':False};made.append(value);return FontProxy(value)
        drawing=types.ModuleType('System.Drawing')
        drawing.Font=factory;drawing.FontStyle=types.SimpleNamespace(Regular=0);drawing.GraphicsUnit=types.SimpleNamespace(Pixel=0)
        drawing.Color=types.SimpleNamespace(FromArgb=lambda r,g,b:types.SimpleNamespace(R=r,G=g,B=b))
        system=types.ModuleType('System');system.Object=types.SimpleNamespace(ReferenceEquals=lambda a,b:a.value is b.value)
        chrome=native_chrome.IntegratedChrome.__new__(native_chrome.IntegratedChrome)
        chrome.title=Label();shared=chrome.title.value;chrome.current_font=None;chrome.font_signature=None
        chrome.bar=types.SimpleNamespace();chrome.buttons=[];chrome.layout=lambda:None
        with patch.dict(sys.modules,{'System':system,'System.Drawing':drawing}):
            for _ in range(50):chrome.refresh({'text_scale':1})
            self.assertEqual(len(made),0);self.assertFalse(shared['disposed'])
            for _ in range(50):chrome.refresh({'font':'Segoe UI','text_scale':1.1})
            self.assertEqual(len(made),0);self.assertFalse(shared['disposed'])

if __name__=='__main__':unittest.main()
