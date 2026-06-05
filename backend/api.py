from __future__ import annotations

import json
import os
import sys
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger

from backend.paths import get_data_dir, get_config_dir, get_cache_dir, ensure_dirs
from backend.settings_manager import get_settings_store
from backend.services.sys_wallpaper import get_sys_wallpaper, set_wallpaper as set_sys_wallpaper
from backend.services.bing import BingService
from backend.services.spotlight import SpotlightService
from backend.services.sniff import SniffService
from backend.services.intelligent_market import IntelligentMarketService

ensure_dirs()


class BackendAPI:
    def __init__(self) -> None:
        self.store = get_settings_store()
        self.bing_service = BingService()
        self.spotlight_service = SpotlightService()
        self.sniff_service = SniffService()
        self.im_service = IntelligentMarketService(
            cache_dir=get_cache_dir(),
            settings_store=self.store,
        )
        self._ensure_favorites()
        self._ensure_history()

    def _favorites_path(self) -> Path:
        return get_data_dir() / "favorites.json"

    def _history_path(self) -> Path:
        return get_data_dir() / "wallpaper_history.json"

    def _downloads_dir(self) -> Path:
        raw = self.store.get("storage.download_directory")
        if isinstance(raw, str) and raw.strip():
            return Path(raw.strip())
        return get_data_dir() / "downloads"

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

    def _download_file_sync(self, url: str, save_dir: Path, filename: str | None = None, headers: dict[str, str] | None = None) -> str | None:
        import requests
        try:
            h = dict(headers or {})
            h.setdefault("User-Agent", self.store.get("sniff.user_agent", "Mozilla/5.0"))
            resp = requests.get(url, headers=h, timeout=60, stream=True)
            resp.raise_for_status()
            save_dir.mkdir(parents=True, exist_ok=True)
            if not filename:
                cd = resp.headers.get("Content-Disposition", "")
                if "filename=" in cd:
                    filename = cd.split("filename=")[-1].strip('"')
                else:
                    filename = Path(url.split("?")[0].split("/")[-1]) or "download.jpg"
            filepath = save_dir / filename
            with open(filepath, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            return str(filepath)
        except Exception as e:
            logger.error(f"Download failed: {e}")
            return None

    def get_current_wallpaper(self) -> dict[str, str] | None:
        path = get_sys_wallpaper()
        if not path:
            return None
        preview_url = self._build_preview_data_url(path)
        return {
            "path": path,
            "filename": Path(path).name,
            "preview_url": preview_url,
        }

    def _build_preview_data_url(self, image_path: str, max_size: int = 960) -> str | None:
        try:
            from PIL import Image
            import io, base64
            with Image.open(image_path) as img:
                preview = img.copy()
                preview.thumbnail((max_size, max_size))
                if preview.mode not in {"RGB", "L"}:
                    preview = preview.convert("RGB")
                buffer = io.BytesIO()
                preview.save(buffer, format="JPEG", quality=82, optimize=True)
                encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
                return f"data:image/jpeg;base64,{encoded}"
        except Exception as exc:
            logger.debug("build preview data url failed: {}", exc)
            return None

    def set_wallpaper(self, path: str) -> dict[str, Any]:
        try:
            set_sys_wallpaper(path)
            self.add_to_history(path, Path(path).name, "set")
            return {"success": True}
        except Exception as e:
            logger.error(f"Failed to set wallpaper: {e}")
            return {"success": False, "error": str(e)}

    def get_bing_wallpaper(self) -> dict[str, Any] | None:
        try:
            items = self.bing_service.query_daily(
                market=self.store.get("wallpaper.bing.market", "zh-CN"),
                count=1,
            )
            if not items:
                return None
            item = items[0]
            meta = item.get("metadata", {})
            return {
                "url": item.get("image_url", ""),
                "title": item.get("title", ""),
                "copyright": item.get("description", ""),
                "startdate": meta.get("startdate", ""),
            }
        except Exception as e:
            logger.error(f"Bing wallpaper error: {e}")
            return None

    def get_spotlight_wallpapers(self) -> list[dict[str, Any]] | None:
        try:
            items = self.spotlight_service.list_local_candidates(limit=20)
            if not items:
                return None
            return [
                {
                    "url": item.get("image_url", ""),
                    "title": item.get("title", ""),
                    "copyright": item.get("description", ""),
                }
                for item in items
            ]
        except Exception as e:
            logger.error(f"Spotlight error: {e}")
            return None

    def get_hitokoto(self, categories: list[str] | None = None) -> dict[str, Any]:
        import requests
        cfg = self.store.get("home_page.hitokoto", {})
        cats = categories or cfg.get("categories", [])
        region = cfg.get("region", "domestic")
        base = "https://v1.hitokoto.cn" if region == "domestic" else "https://international.v1.hitokoto.cn"
        try:
            params = {}
            if cats:
                for c in cats:
                    params["c"] = c
            resp = requests.get(base, params=params, timeout=10)
            data = resp.json()
            return {
                "hitokoto": data.get("hitokoto", ""),
                "from": data.get("from", ""),
                "from_who": data.get("from_who"),
            }
        except Exception as e:
            logger.warning(f"Hitokoto failed: {e}, returning default")
            return {
                "hitokoto": "今天也给桌面换一张像样的壁纸。",
                "from": "",
                "from_who": "Little Tree",
            }

    def download_file(self, url: str, filename: str | None = None) -> str | None:
        save_dir = self._downloads_dir()
        ua = self.store.get("sniff.user_agent", "Mozilla/5.0")
        return self._download_file_sync(url, save_dir, filename, headers={"User-Agent": ua})

    def copy_to_clipboard(self, text: str) -> None:
        try:
            import pyperclip
            pyperclip.copy(text)
        except Exception as e:
            logger.error(f"Clipboard error: {e}")

    def save_file_dialog(self, data: str, filename: str) -> str | None:
        try:
            import tkinter as tk
            from tkinter import filedialog
            import base64
            root = tk.Tk()
            root.withdraw()
            path = filedialog.asksaveasfilename(
                defaultextension=".jpg",
                initialfile=filename,
                filetypes=[("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.gif"), ("All files", "*.*")],
            )
            root.destroy()
            if not path:
                return None
            # data may be a data URI like data:image/jpeg;base64,/9j/4AAQ...
            content = data
            if content.startswith("data:"):
                header, b64 = content.split(",", 1)
                content = base64.b64decode(b64)
            else:
                content = content.encode("utf-8")
            Path(path).write_bytes(content)
            return str(path)
        except Exception:
            return None

    def save_base64_file(self, data: str, filename: str) -> str | None:
        try:
            import base64
            save_dir = self._downloads_dir()
            save_dir.mkdir(parents=True, exist_ok=True)
            filepath = save_dir / filename
            content = data
            if content.startswith("data:"):
                header, b64 = content.split(",", 1)
                content = base64.b64decode(b64)
            else:
                content = content.encode("utf-8")
            filepath.write_bytes(content)
            return str(filepath)
        except Exception as e:
            logger.error(f"Save base64 file error: {e}")
            return None

    def sniff_images(self, url: str) -> list[dict[str, Any]]:
        try:
            ua = self.store.get("sniff.user_agent", "Mozilla/5.0")
            timeout = int(self.store.get("sniff.timeout_seconds", 15))
            items = self.sniff_service.sniff_images(url, user_agent=ua, timeout_seconds=timeout)
            return [
                {
                    "id": item.get("id", uuid.uuid4().hex),
                    "url": item.get("image_url", ""),
                    "filename": Path(item.get("image_url", "")).name or "image.jpg",
                    "content_type": "",
                }
                for item in items
            ]
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
        return []

    def install_store_resource(self, resource: dict[str, Any]) -> None:
        logger.info(f"Installing {resource}")

    def list_intelligent_market_sources(self, force: bool = False) -> list[dict[str, Any]]:
        try:
            return self.im_service.list_sources(force=force)
        except Exception as e:
            logger.error(f"list_intelligent_market_sources error: {e}")
            return []

    def check_intelligent_market_sources_health(
        self, source_ids: list[str] | None = None, force: bool = False
    ) -> list[dict[str, Any]]:
        try:
            return self.im_service.check_sources_health(source_ids=source_ids, force=force)
        except Exception as e:
            logger.error(f"check_intelligent_market_sources_health error: {e}")
            return []

    def execute_intelligent_market_source(
        self, source_id: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        try:
            return self.im_service.execute_source(source_id, parameters or {})
        except Exception as e:
            logger.error(f"execute_intelligent_market_source error: {e}")
            return []

    def get_settings(self) -> dict[str, Any]:
        return self.store.as_dict()

    def set_settings(self, settings: dict[str, Any]) -> None:
        self.store._data = settings
        self.store.save()

    def get_setting(self, key: str) -> Any:
        return self.store.get(key)

    def set_setting(self, key: str, value: Any) -> None:
        self.store.set(key, value)

    def get_history(self, max_preview_items: int = 20) -> list[dict[str, Any]]:
        history = self._load_history()
        for i, item in enumerate(history):
            if i >= max_preview_items:
                break
            if not item.get("preview_url"):
                item["preview_url"] = self._build_preview_data_url(item.get("path", ""), max_size=320)
        return history

    def add_to_history(self, path: str, title: str, reason: str) -> None:
        history = self._load_history()
        history = [h for h in history if h.get("path") != path]
        preview_url = self._build_preview_data_url(path, max_size=320)
        history.insert(0, {
            "path": path, "title": title, "reason": reason,
            "time": datetime.now().isoformat(),
            "preview_url": preview_url,
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

    def open_file(self, path: str) -> None:
        # 使用系统默认应用打开文件（在 Windows 上 os.startfile 既可打开文件也可打开目录）
        self.open_folder(path)

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

    # --- New API methods for enhanced functionality ---

    def query_bing(
        self,
        category: str = "daily",
        market: str = "zh-CN",
        count: int = 8,
        quality: str = "highDef",
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        if category == "recent":
            return self.bing_service.query_recent(
                market=market, count=count, quality=quality, force_refresh=force_refresh
            )
        return self.bing_service.query_daily(
            market=market, count=count, quality=quality, force_refresh=force_refresh
        )

    def query_spotlight(
        self,
        source: str = "local",
        limit: int = 20,
        market: str = "zh-CN",
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        if source == "online":
            return self.spotlight_service.list_online_candidates(
                limit=limit, market=market, force_refresh=force_refresh
            )
        return self.spotlight_service.list_local_candidates(
            limit=limit, force_refresh=force_refresh
        )

    def clear_source_cache(self, source: str | None = None) -> dict[str, Any]:
        """Drop cached Bing/Spotlight responses so the next call refetches."""
        cleared: list[str] = []
        if source in (None, "bing"):
            from backend.services.bing import BingService
            BingService._cache.clear()
            cleared.append("bing")
        if source in (None, "spotlight"):
            from backend.services.spotlight import SpotlightService
            SpotlightService._cache.clear()
            cleared.append("spotlight")
        return {"cleared": cleared}

    def bootstrap(self) -> dict[str, Any]:
        home_bing = self.bing_service.query_daily(market="zh-CN", count=1)
        quote = self.get_hitokoto()
        return {
            "settings": self.store.as_dict(),
            "favorites": self._load_favorites(),
            "history": self._load_history(),
            "sources": [],
            "plugins": [],
            "runtime": {
                "debug": {"enabled": False, "session_enabled": False, "open_devtools_on_start": True},
                "window": {"hide_on_close": self.store.get("ui.hide_on_close", True), "minimize_to_tray": self.store.get("ui.minimize_to_tray", True)},
            },
            "home": {
                "bing": home_bing[:1],
                "spotlight": self.spotlight_service.list_local_candidates(limit=4),
                "quote": {"text": quote.get("hitokoto", ""), "author": quote.get("from_who", ""), "source": quote.get("from", "")},
                "current_wallpaper": self.get_current_wallpaper(),
            },
        }

    def list_history(self) -> list[dict[str, Any]]:
        return self._load_history()

    def record_current_wallpaper(self) -> dict[str, Any] | None:
        info = self.get_current_wallpaper()
        if info and info.get("path"):
            self.add_to_history(info["path"], info.get("filename", "当前壁纸"), "record")
        return info

    def runtime_snapshot(self) -> dict[str, Any]:
        return {
            "auto_change": {"enabled": False, "mode": "off", "running": False},
            "debug": {"enabled": False, "session_enabled": False, "open_devtools_on_start": True},
            "window": {"hide_on_close": self.store.get("ui.hide_on_close", True), "minimize_to_tray": self.store.get("ui.minimize_to_tray", True)},
        }

    def get_storage_overview(self) -> dict[str, Any]:
        downloads_dir = self._downloads_dir()
        total_size = 0
        file_count = 0
        if downloads_dir.exists():
            for f in downloads_dir.rglob("*"):
                if f.is_file():
                    try:
                        total_size += f.stat().st_size
                        file_count += 1
                    except OSError:
                        pass
        return {
            "download_directory": str(downloads_dir),
            "default_download_directory": str(get_data_dir() / "downloads"),
            "items": [
                {"id": "downloads", "title": "下载", "scope": "data", "size_bytes": total_size, "file_count": file_count, "optimize_supported": False},
            ],
        }

    def pick_download_directory(self) -> dict[str, str] | None:
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            path = filedialog.askdirectory()
            root.destroy()
            if path:
                return {"path": path}
        except Exception as e:
            logger.error(f"Pick directory error: {e}")
        return None

    def set_download_directory(self, directory: str | None = None) -> dict[str, Any]:
        if directory:
            self.store.set("storage.download_directory", directory)
        else:
            self.store.set("storage.download_directory", str(get_data_dir() / "downloads"))
        return {
            "settings": self.store.as_dict(),
            "storage": self.get_storage_overview(),
        }

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        for key, value in updates.items():
            self.store.set(key, value)
        return self.store.as_dict()

    def trigger_auto_change_now(self, plan_id: str | None = None) -> dict[str, Any]:
        return {"enabled": False, "mode": "off", "running": False, "last_result": None}

    def get_debug_log(self, lines: int = 240) -> dict[str, Any]:
        return {"path": "", "content": "", "truncated": False, "lines": 0}

    def open_debug_log_directory(self) -> dict[str, Any]:
        return {"opened_path": str(get_data_dir())}

    def open_debug_log_file(self) -> dict[str, Any]:
        return {"opened_path": ""}
