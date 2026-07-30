# -*- mode: python ; coding: utf-8 -*-
# Auto-generated. Edit tools/build.py if you need to change the bundle recipe.
import sys
from pathlib import Path

block_cipher = None

DATAS = [
    ('build.json', '.'),
    ('backend/README.md', 'backend'),
    ('frontend/dist', 'frontend/dist'),
]

HIDDENIMPORTS = [
    "webview.platforms.winforms",
    "webview.platforms.edgechromium",
    "clr_loader",
    "win32com",
    "win32com.client",
    "pywintypes",
    "win32gui",
    "win32api",
    "windows_toasts",
    "winrt.windows.data.xml.dom",
    "winrt.windows.foundation",
    "winrt.windows.foundation.collections",
    "winrt.windows.ui.notifications",
    "AppKit",
    "Foundation",
    "gi",
]

a = Analysis(
    ['backend/main.py'],
    pathex=[str(Path('backend/main.py').resolve().parent.parent)],
    binaries=[],
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
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='小树壁纸 Next' if sys.platform != 'win32' else 'LittleTreeWallpaper',
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
