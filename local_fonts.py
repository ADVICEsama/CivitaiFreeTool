"""枚举系统已安装字体，不下载字体文件。"""
import sys

def enumerate_fonts():
    if sys.platform!='win32':
        import subprocess
        try:
            output=subprocess.check_output(['fc-list',':','family'],timeout=8,text=True)
            return sorted({family.strip() for line in output.splitlines() for family in line.split(',') if family.strip()},key=str.casefold)
        except (OSError,subprocess.SubprocessError):return []
    import ctypes
    from ctypes import wintypes as w
    class LOGFONTW(ctypes.Structure):
        _fields_=[(name,w.LONG) for name in ('lfHeight','lfWidth','lfEscapement','lfOrientation','lfWeight')]+[(name,w.BYTE) for name in ('lfItalic','lfUnderline','lfStrikeOut','lfCharSet','lfOutPrecision','lfClipPrecision','lfQuality','lfPitchAndFamily')]+[('lfFaceName',w.WCHAR*32)]
    callback_type=ctypes.WINFUNCTYPE(ctypes.c_int,ctypes.POINTER(LOGFONTW),ctypes.c_void_p,w.DWORD,w.LPARAM)
    user=ctypes.windll.user32;gdi=ctypes.windll.gdi32
    user.GetDC.argtypes=[w.HWND];user.GetDC.restype=w.HDC
    user.ReleaseDC.argtypes=[w.HWND,w.HDC];user.ReleaseDC.restype=ctypes.c_int
    gdi.EnumFontFamiliesExW.argtypes=[w.HDC,ctypes.POINTER(LOGFONTW),callback_type,w.LPARAM,w.DWORD]
    gdi.EnumFontFamiliesExW.restype=ctypes.c_int
    families=set()
    @callback_type
    def collect(font,metrics,font_type,param):
        name=font.contents.lfFaceName.strip()
        if name and not name.startswith('@'):families.add(name)
        return 1
    font=LOGFONTW();font.lfCharSet=1
    dc=user.GetDC(None)
    if not dc:return []
    try:gdi.EnumFontFamiliesExW(dc,ctypes.byref(font),collect,0,0)
    finally:user.ReleaseDC(None,dc)
    return sorted(families,key=str.casefold)
