from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes


_ENUM_CURRENT_SETTINGS = -1
_CCHDEVICENAME = 32
_CCHFORMNAME = 32


class _DEVMODEW(ctypes.Structure):
    _fields_ = [
        ("dmDeviceName", wintypes.WCHAR * _CCHDEVICENAME),
        ("dmSpecVersion", wintypes.WORD),
        ("dmDriverVersion", wintypes.WORD),
        ("dmSize", wintypes.WORD),
        ("dmDriverExtra", wintypes.WORD),
        ("dmFields", wintypes.DWORD),
        ("dmOrientation", ctypes.c_short),
        ("dmPaperSize", ctypes.c_short),
        ("dmPaperLength", ctypes.c_short),
        ("dmPaperWidth", ctypes.c_short),
        ("dmScale", ctypes.c_short),
        ("dmCopies", ctypes.c_short),
        ("dmDefaultSource", ctypes.c_short),
        ("dmPrintQuality", ctypes.c_short),
        ("dmColor", ctypes.c_short),
        ("dmDuplex", ctypes.c_short),
        ("dmYResolution", ctypes.c_short),
        ("dmTTOption", ctypes.c_short),
        ("dmCollate", ctypes.c_short),
        ("dmFormName", wintypes.WCHAR * _CCHFORMNAME),
        ("dmLogPixels", wintypes.WORD),
        ("dmBitsPerPel", wintypes.DWORD),
        ("dmPelsWidth", wintypes.DWORD),
        ("dmPelsHeight", wintypes.DWORD),
        ("dmDisplayFlags", wintypes.DWORD),
        ("dmDisplayFrequency", wintypes.DWORD),
        ("dmICMMethod", wintypes.DWORD),
        ("dmICMIntent", wintypes.DWORD),
        ("dmMediaType", wintypes.DWORD),
        ("dmDitherType", wintypes.DWORD),
        ("dmReserved1", wintypes.DWORD),
        ("dmReserved2", wintypes.DWORD),
        ("dmPanningWidth", wintypes.DWORD),
        ("dmPanningHeight", wintypes.DWORD),
    ]


def get_primary_display_resolution() -> dict[str, int]:
    fallback = {"width": 1920, "height": 1080}
    if not sys.platform.startswith("win"):
        return fallback

    user32 = ctypes.windll.user32
    devmode = _DEVMODEW()
    devmode.dmSize = ctypes.sizeof(_DEVMODEW)

    if user32.EnumDisplaySettingsW(None, _ENUM_CURRENT_SETTINGS, ctypes.byref(devmode)):
        width = int(devmode.dmPelsWidth or 0)
        height = int(devmode.dmPelsHeight or 0)
        if width > 0 and height > 0:
            return {"width": width, "height": height}

    width = int(user32.GetSystemMetrics(0) or 0)
    height = int(user32.GetSystemMetrics(1) or 0)
    if width > 0 and height > 0:
        return {"width": width, "height": height}
    return fallback