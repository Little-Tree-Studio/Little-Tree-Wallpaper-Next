import os
import json
import uuid
import webbrowser
from pathlib import Path
from datetime import datetime
from typing import Any
from loguru import logger

from .paths import get_data_dir, get_config_dir, get_cache_dir, ensure_dirs
from .settings_manager import get_settings_store
from .wallpaper import (
    get_sys_wallpaper, set_wallpaper, get_bing_wallpaper,
    get_spotlight_wallpapers, download_file, get_hitokoto,
)

ensure_dirs()

class BackendAPI:
    def __init__(self) -> None:
        self.store = get_settings_store()
        self._ensure_favorites()
        self._ensure_history()

    def _favorites_path(self) -> Path:
        return get_data_dir() / "favorites.json"

    def _history_path(self) -> Path:
        return get_data_dir() / "wallpaper_history.json"

    def _ensure_favorites(self) -> None:
        path = self._favorites_path()
        if not path.exists():
            default = {
                "folders": [{"id": "default", "name": "全部", "description": "", "order": 0}],
                "items": [],
            }
            path.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")

    def _ensure_history(self) -> None:
        path = self._history_path()
        if not path.exists():
            path.write_text("[]", encoding="utf-8")

    def _load_favorites(self) -> dict[str, Any]:
        try:
            return json.loads(self._favorites_path().read_text(encoding="utf-8"))
        except Exception:
            return {"folders": [], "items": []}

    def _save_favorites(self, data: dict[str, Any]) -> None:
        self._favorites_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _load_history(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self._history_path().read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save_history(self, data: list[dict[str, Any]]) -> None:
        self._history_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_current_wallpaper(self) -> dict[str, str] | None:
        path = get_sys_wallpaper()
        if path:
            return {"path": path, "filename": Path(path).name}
        return None

    def set_wallpaper(self, path: str) -> dict[str, Any]:
        success = set_wallpaper(path)
        if success:
            self.add_to_history(path, Path(path).name, "set")
        return {"success": success}

    def get_bing_wallpaper(self) -> dict[str, Any] | None:
        ua = self.store.get("sniff.user_agent")
        return get_bing_wallpaper(ua)

    def get_spotlight_wallpapers(self) -> list[dict[str, Any]] | None:
        ua = self.store.get("sniff.user_agent")
        return get_spotlight_wallpapers(ua)

    def get_hitokoto(self, categories: list[str] | None = None) -> dict[str, Any] | None:
        cfg = self.store.get("home_page.hitokoto", {})
        cats = categories or cfg.get("categories", [])
        region = cfg.get("region", "domestic")
        return get_hitokoto(cats, region)

    def download_file(self, url: str, filename: str | None = None) -> str | None:
        ua = self.store.get("sniff.user_agent")
        save_dir = self.store.get("storage.download_directory") or str(get_data_dir() / "downloads")
        return download_file(url, save_dir, filename, headers={"User-Agent": ua})

    def copy_to_clipboard(self, text: str) -> None:
        try:
            import pyperclip
            pyperclip.copy(text)
        except Exception as e:
            logger.error(f"Clipboard error: {e}")

    def save_file_dialog(self, data: str, filename: str) -> None:
        # Simplified: save to downloads dir
        save_dir = self.store.get("storage.download_directory") or str(get_data_dir() / "downloads")
        os.makedirs(save_dir, exist_ok=True)
        path = os.path.join(save_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write(data)

    def sniff_images(self, url: str) -> list[dict[str, Any]]:
        # Simplified image sniffing
        try:
            from urllib.parse import urljoin
            import requests
            from html.parser import HTMLParser

            ua = self.store.get("sniff.user_agent")
            timeout = self.store.get("sniff.timeout_seconds", 40)
            headers = {"User-Agent": ua}
            if self.store.get("sniff.use_source_as_referer", True):
                headers["Referer"] = url
            else:
                ref = self.store.get("sniff.referer")
                if ref:
                    headers["Referer"] = ref

            resp = requests.get(url, headers=headers, timeout=timeout)
            content_type = resp.headers.get("Content-Type", "")
            if content_type.startswith("image/"):
                return [{"id": uuid.uuid4().hex, "url": url, "filename": Path(url).name or "image.jpg", "content_type": content_type}]

            images = []
            seen = set()

            class ImgParser(HTMLParser):
                def handle_starttag(self, tag, attrs):
                    attr_dict = dict(attrs)
                    src = None
                    if tag == "img":
                        src = attr_dict.get("data-src") or attr_dict.get("src")
                    elif tag == "meta":
                        prop = attr_dict.get("property", "")
                        if prop in ("og:image", "twitter:image"):
                            src = attr_dict.get("content")
                    elif tag in ("source", "video"):
                        src = attr_dict.get("src")
                    if src:
                        full = urljoin(url, src)
                        if full not in seen:
                            seen.add(full)
                            images.append({
                                "id": uuid.uuid4().hex,
                                "url": full,
                                "filename": Path(full).name or "image.jpg",
                                "content_type": "",
                            })

            parser = ImgParser()
            parser.feed(resp.text)
            return images
        except Exception as e:
            logger.error(f"Sniff error: {e}")
            return []

    def get_favorites(self) -> dict[str, Any]:
        return self._load_favorites()

    def add_favorite(self, item: dict[str, Any]) -> dict[str, Any]:
        data = self._load_favorites()
        new_item = {
            **item,
            "id": uuid.uuid4().hex,
            "created_at": datetime.now().isoformat(),
        }
        data["items"].append(new_item)
        self._save_favorites(data)
        return new_item

    def update_favorite(self, item: dict[str, Any]) -> None:
        data = self._load_favorites()
        for i, it in enumerate(data["items"]):
            if it["id"] == item["id"]:
                data["items"][i] = item
                break
        self._save_favorites(data)

    def remove_favorite(self, id: str) -> None:
        data = self._load_favorites()
        data["items"] = [it for it in data["items"] if it["id"] != id]
        self._save_favorites(data)

    def create_favorite_folder(self, name: str, description: str = "") -> dict[str, Any]:
        data = self._load_favorites()
        folder = {"id": uuid.uuid4().hex, "name": name, "description": description, "order": len(data["folders"])}
        data["folders"].append(folder)
        self._save_favorites(data)
        return folder

    def get_store_resources(self, type: str) -> list[dict[str, Any]]:
        # Placeholder: return empty list
        return []

    def install_store_resource(self, resource: dict[str, Any]) -> None:
        logger.info(f"Installing {resource}")

    def get_settings(self) -> dict[str, Any]:
        return self.store.as_dict()

    def set_settings(self, settings: dict[str, Any]) -> None:
        self.store._data = settings
        self.store.save()

    def get_setting(self, key: str) -> Any:
        return self.store.get(key)

    def set_setting(self, key: str, value: Any) -> None:
        self.store.set(key, value)

    def get_history(self) -> list[dict[str, Any]]:
        return self._load_history()

    def add_to_history(self, path: str, title: str, reason: str) -> None:
        history = self._load_history()
        # Deduplicate by path
        history = [h for h in history if h.get("path") != path]
        history.insert(0, {
            "path": path, "title": title, "reason": reason,
            "time": datetime.now().isoformat(),
        })
        history = history[:200]
        self._save_history(history)

    def check_for_updates(self) -> dict[str, Any] | None:
        return None

    def open_folder(self, path: str) -> None:
        if sys.platform == "win32":
            os.startfile(path)
        elif sys.platform == "darwin":
            os.system(f'open "{path}"')
        else:
            os.system(f'xdg-open "{path}"')

    def open_url(self, url: str) -> None:
        webbrowser.open(url)

    def get_wallpaper_sources(self) -> list[dict[str, Any]]:
        return []

    def select_local_image(self) -> str | None:
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            path = filedialog.askopenfilename(filetypes=[("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.gif")])
            root.destroy()
            return path or None
        except Exception:
            return None

    def export_favorites(self, folder_id: str | None = None) -> str:
        import zipfile
        data = self._load_favorites()
        if folder_id:
            data["items"] = [it for it in data["items"] if it["folder_id"] == folder_id]
        export_path = get_data_dir() / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.ltfav"
        with zipfile.ZipFile(export_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps(data, ensure_ascii=False, indent=2))
        return str(export_path)

    def import_favorites(self, path: str) -> None:
        import zipfile
        with zipfile.ZipFile(path, "r") as zf:
            data = json.loads(zf.read("manifest.json"))
        current = self._load_favorites()
        existing_ids = {it["id"] for it in current["items"]}
        for item in data.get("items", []):
            if item["id"] not in existing_ids:
                current["items"].append(item)
        for folder in data.get("folders", []):
            if not any(f["id"] == folder["id"] for f in current["folders"]):
                current["folders"].append(folder)
        self._save_favorites(current)

    def get_version(self) -> str:
        return "2.0.0"

    def get_platform(self) -> str:
        return sys.platform

import sys
