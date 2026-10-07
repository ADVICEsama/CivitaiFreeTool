# -*- mode: python ; coding: utf-8 -*-


from pathlib import Path
import runpy
native_dll = runpy.run_path(str(Path(SPECPATH)/'scripts'/'build_native.py'))['build'](SPECPATH)
extra_data = [(str(native_dll), 'native')] if native_dll else []
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
    a.binaries,
    a.datas,
    [],
    name='CivitaiFreeToolWeb',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version='version_info.txt',
    icon=['icon.ico'],
)
