import os
import sys
import ctypes
import subprocess
import requests
from pathlib import Path
from typing import Any
from loguru import logger

from .paths import get_data_dir

def get_sys_wallpaper() -> str | None:
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop") as key:
                value, _ = winreg.QueryValueEx(key, "WallPaper")
                return value if value else None
        except Exception:
            return None
    elif sys.platform == "darwin":
        try:
            script = 'tell application "Finder" to get POSIX path of (desktop picture as alias)'
            result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
            return result.stdout.strip() or None
        except Exception:
            return None
    else:
        try:
            result = subprocess.run(
                ["gsettings", "get", "org.gnome.desktop.background", "picture-uri"],
                capture_output=True, text=True
            )
            path = result.stdout.strip().strip("'")
            if path.startswith("file://"):
                return path[7:]
            return path or None
        except Exception:
            return None

def set_wallpaper(path: str) -> bool:
    if not os.path.exists(path):
        logger.error(f"Wallpaper file not found: {path}")
        return False
    try:
        if sys.platform == "win32":
            abs_path = os.path.abspath(path)
            SPI_SETDESKWALLPAPER = 20
            ctypes.windll.user32.SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, abs_path, 3)
            try:
                import winreg
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop", 0, winreg.KEY_SET_VALUE) as key:
                    winreg.SetValueEx(key, "WallPaper", 0, winreg.REG_SZ, abs_path)
            except Exception:
                pass
            return True
        elif sys.platform == "darwin":
            script = f'tell application "Finder" to set desktop picture to POSIX file "{os.path.abspath(path)}"'
            subprocess.run(["osascript", "-e", script], check=True)
            return True
        else:
            abs_path = os.path.abspath(path)
            for cmd in [
                ["gsettings", "set", "org.gnome.desktop.background", "picture-uri", f"file://{abs_path}"],
                ["gsettings", "set", "org.gnome.desktop.background", "picture-uri-dark", f"file://{abs_path}"],
            ]:
                try:
                    subprocess.run(cmd, check=True, capture_output=True)
                except Exception:
                    pass
            try:
                subprocess.run(["feh", "--bg-fill", abs_path], check=True, capture_output=True)
            except Exception:
                pass
            return True
    except Exception as e:
        logger.error(f"Failed to set wallpaper: {e}")
        return False

def get_bing_wallpaper(user_agent: str | None = None) -> dict[str, Any] | None:
    ua = user_agent or "Mozilla/5.0"
    try:
        url = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN"
        resp = requests.get(url, headers={"User-Agent": ua}, timeout=15)
        data = resp.json()
        images = data.get("images", [])
        if not images:
            return None
        img = images[0]
        return {
            "url": f"https://www.bing.com{img['url']}",
            "title": img.get("title", ""),
            "copyright": img.get("copyright", ""),
            "startdate": img.get("startdate", ""),
        }
    except Exception as e:
        logger.error(f"Failed to get Bing wallpaper: {e}")
        return None

def get_spotlight_wallpapers(user_agent: str | None = None) -> list[dict[str, Any]] | None:
    ua = user_agent or "Mozilla/5.0"
    try:
        url = (
            "https://fd.api.msn.com/api/v1.0/highlightlist?plalevel=Full"
            "&configNames=InternalPhoto|BICIInternalPhoto"
            "&pubids=14660033|20489161|14717670|14717551|14717664|14717723|14717773"
            "&activecards=InternalPhoto|BICIInternalPhoto"
            "&collg=82F4D700B5F2A8A37A40C4BCEF7CE8D5"
            "&collt=Selections|Friendly"
            "&appkey=f642dc2d-b6f4-45ea-8d1c-3e1d535f1f1c"
        )
        resp = requests.get(url, headers={"User-Agent": ua}, timeout=15)
        data = resp.json()
        items = data.get("tiles", [])
        results = []
        for item in items:
            image = item.get("image", {})
            if image.get("imageurl"):
                results.append({
                    "url": image["imageurl"],
                    "title": item.get("title", ""),
                    "copyright": item.get("copyright", ""),
                })
        return results or None
    except Exception as e:
        logger.error(f"Failed to get Spotlight wallpapers: {e}")
        return None

def download_file(url: str, save_path: str | None = None, filename: str | None = None,
                  timeout: int = 60, headers: dict[str, str] | None = None) -> str | None:
    try:
        h = headers or {}
        h.setdefault("User-Agent", "Mozilla/5.0")
        resp = requests.get(url, headers=h, timeout=timeout, stream=True)
        resp.raise_for_status()
        if save_path is None:
            save_path = str(get_data_dir() / "downloads")
        os.makedirs(save_path, exist_ok=True)
        if not filename:
            cd = resp.headers.get("Content-Disposition", "")
            if "filename=" in cd:
                filename = cd.split("filename=")[-1].strip('"')
            else:
                filename = Path(url.split("?")[0].split("/")[-1]) or "download.jpg"
        filepath = os.path.join(save_path, filename)
        with open(filepath, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        return filepath
    except Exception as e:
        logger.error(f"Download failed: {e}")
        return None

def get_hitokoto(categories: list[str] | None = None, region: str = "domestic") -> dict[str, Any] | None:
    base = "https://v1.hitokoto.cn" if region == "domestic" else "https://international.v1.hitokoto.cn"
    try:
        params = {}
        if categories:
            for c in categories:
                params[f"c"] = c
        resp = requests.get(base, params=params, timeout=10)
        data = resp.json()
        return {
            "hitokoto": data.get("hitokoto", ""),
            "from": data.get("from", ""),
            "from_who": data.get("from_who"),
        }
    except Exception as e:
        logger.error(f"Hitokoto failed: {e}")
        return None
