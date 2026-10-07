"""使用 Windows 自带 .NET Framework 编译器构建原生窗口壳；不安装 SDK。"""
from pathlib import Path
import os
import subprocess
import sys

def build(root):
    if sys.platform != 'win32': return None
    root = Path(root)
    src = root/'native'/'CftChrome.cs'
    out = root/'build'/'native'/'CftChrome.dll'
    windir = Path(os.environ.get('WINDIR', r'C:\Windows'))
    compiler = next((windir/'Microsoft.NET'/kind/'v4.0.30319'/'csc.exe' for kind in ('Framework64','Framework')
                     if (windir/'Microsoft.NET'/kind/'v4.0.30319'/'csc.exe').is_file()), None)
    if compiler is None: raise RuntimeError('找不到 .NET Framework C# 编译器')
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        subprocess.run([str(compiler),'/nologo','/target:library','/reference:System.Windows.Forms.dll',
                        '/reference:System.Drawing.dll','/out:'+str(out),str(src)], check=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    return out

if __name__ == '__main__': print(build(Path(__file__).resolve().parents[1]))
