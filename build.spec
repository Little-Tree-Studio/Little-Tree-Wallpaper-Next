# -*- mode: python ; coding: utf-8 -*-
# Auto-generated. Edit tools/build.py if you need to change the bundle recipe.
# Layout is controlled by the LTW_BUILD_MODE environment variable:
#   onefile (default) -> single executable in dist/
#   onedir            -> folder bundle in dist/<APP_NAME>/
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

block_cipher = None

ONEDIR = os.environ.get('LTW_BUILD_MODE', 'onefile') == 'onedir'
APP_NAME = '小树壁纸 Next' if sys.platform != 'win32' else 'LittleTreeWallpaper'

DATAS = [
    ('build.json', '.'),
    ('backend/README.md', 'backend'),
    ('frontend/dist', 'frontend/dist'),
]

LUMIVIEW_DATAS, LUMIVIEW_BINARIES, LUMIVIEW_HIDDENIMPORTS = collect_all('lumiview')
WRYVIEW_DATAS, WRYVIEW_BINARIES, WRYVIEW_HIDDENIMPORTS = collect_all('wryview')
DATAS += LUMIVIEW_DATAS + WRYVIEW_DATAS

HIDDENIMPORTS = [
    "win32com",
    "win32com.client",
    "pywintypes",
    "win32gui",
    "win32api",
    "pycaw",
    "pycaw.pycaw",
    "comtypes",
    "windows_toasts",
    "winrt.windows.data.xml.dom",
    "winrt.windows.foundation",
    "winrt.windows.foundation.collections",
    "winrt.windows.ui.notifications",
    "AppKit",
    "Foundation",
    "gi",
] + LUMIVIEW_HIDDENIMPORTS + WRYVIEW_HIDDENIMPORTS

a = Analysis(
    ['backend/main.py'],
    pathex=[str(Path('backend/main.py').resolve().parent.parent)],
    binaries=LUMIVIEW_BINARIES + WRYVIEW_BINARIES,
    datas=DATAS,
    hiddenimports=HIDDENIMPORTS,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [] if ONEDIR else a.binaries,
    [] if ONEDIR else a.zipfiles,
    [] if ONEDIR else a.datas,
    [],
    name=APP_NAME,
    exclude_binaries=ONEDIR,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='frontend/dist/logo.ico' if sys.platform == 'win32' else None,
)

if ONEDIR:
    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name=APP_NAME,
    )
