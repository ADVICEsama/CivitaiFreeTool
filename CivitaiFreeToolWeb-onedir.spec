# -*- mode: python ; coding: utf-8 -*-
"""onedir 变体：仅用于启动速度对比测试，不替换官方发布配置（CivitaiFreeToolWeb.spec）。

与 onefile 的唯一差别：
  1. EXE() 加 exclude_binaries=True 且不内嵌 binaries/datas
  2. 用 COLLECT() 把依赖铺成目录，启动时不再自解压到 %TEMP%
  3. 关闭 UPX（压缩只拖慢解包、并容易被杀软扫描）

产物目录：dist_onedir/CivitaiFreeToolWeb/
"""

from pathlib import Path
import runpy

native_dll = runpy.run_path(str(Path(SPECPATH)/'scripts'/'build_native.py'))['build'](SPECPATH)
extra_data = [(str(native_dll), 'native')] if native_dll else []
extra_data += runpy.run_path(str(Path(SPECPATH)/'scripts'/'bundle_ssl_data.py'))['collect_ssl_runtime_data']()

a = Analysis(
    ['main_web.py'],
    pathex=[],
    binaries=[],
    datas=[('web', 'web')] + extra_data,
    hiddenimports=['clr', 'pystray._win32'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='CivitaiFreeToolWeb',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version='version_info.txt',
    icon=['icon.ico'],
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='CivitaiFreeToolWeb',
)
