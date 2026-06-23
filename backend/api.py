from __future__ import annotations

import contextlib
import io
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

from loguru import logger

from backend.paths import ensure_dirs, get_cache_dir, get_data_dir
from backend.services.bing import BingService
from backend.services.intelligent_market import IntelligentMarketService
from backend.services.ltws import LTWSService
from backend.services.sniff import SniffService
from backend.services.spotlight import SpotlightService
from backend.services.sys_wallpaper import get_sys_wallpaper
from backend.services.sys_wallpaper import set_wallpaper as set_sys_wallpaper
from backend.settings_manager import get_settings_store

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
        self.ltws_service = LTWSService(
            sources_dir=get_data_dir() / "wallpaper_sources",
            cache_dir=get_cache_dir(),
            builtin_examples_dir=get_data_dir() / "builtin" / "ltws",
            settings=self.store,
            preview_url_builder=self._build_preview_url,
        )
        # Per-session secret token injected by the launcher (main.py). It is used
        # to build authenticated preview URLs and is never written to disk.
        self._api_token: str | None = None
        self._ensure_favorites()
        self._ensure_history()

    def set_api_token(self, token: str) -> None:
        """Inject the per-session token used to authorize preview URLs."""
        self._api_token = token

    def _favorites_path(self) -> Path:
        return get_data_dir() / "favorites.json"

    def _history_path(self) -> Path:
        return get_data_dir() / "wallpaper_history.json"

    @staticmethod
    def _show_file_dialog(
        dialog_type: str,
        filetypes: list[tuple[str, str]],
        defaultextension: str | None = None,
        initialfile: str | None = None,
    ) -> str | None:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        try:
            if dialog_type == "open":
                path = filedialog.askopenfilename(filetypes=filetypes)
            elif dialog_type == "save":
                kwargs: dict[str, Any] = {"filetypes": filetypes}
                if defaultextension:
                    kwargs["defaultextension"] = defaultextension
                if initialfile:
                    kwargs["initialfile"] = initialfile
                path = filedialog.asksaveasfilename(**kwargs)
            else:
                return None
            return path if path else None
        finally:
            root.destroy()

    def _downloads_dir(self) -> Path:
        raw = self.store.get("storage.download_directory")
        if isinstance(raw, str) and raw.strip():
            return Path(raw.strip())
        return get_data_dir() / "downloads"

    def _ensure_favorites(self) -> None:
        path = self._favorites_path()
        if not path.exists():
            default = {
                "folders": [{"id": "default", "name": "默认收藏夹", "description": "", "order": 0}],
                "items": [],
                "all_tags": [],
            }
            path.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")

    SYSTEM_TAGS = ["Bing", "Windows聚焦"]

    def _migrate_all_tags(self, data: dict[str, Any]) -> dict[str, Any]:
        """确保 favorites 数据包含 all_tags 字段，并包含系统标签。"""
        tags: set[str] = set(data.get("all_tags", []))
        for item in data.get("items", []):
            for tag in item.get("tags", []):
                tags.add(tag)
        for tag in self.SYSTEM_TAGS:
            tags.add(tag)
        data["all_tags"] = sorted(tags)
        return data

    def _ensure_history(self) -> None:
        path = self._history_path()
        if not path.exists():
            path.write_text("[]", encoding="utf-8")

    def _load_favorites(self) -> dict[str, Any]:
        try:
            data = json.loads(self._favorites_path().read_text(encoding="utf-8"))
            # Migrate old default folder name from "全部" to "默认收藏夹"
            for folder in data.get("folders", []):
                if folder.get("id") == "default" and folder.get("name") == "全部":
                    folder["name"] = "默认收藏夹"
                    self._save_favorites(data)
                    break
            data = self._migrate_all_tags(data)
            return data
        except Exception:
            return {"folders": [], "items": [], "all_tags": []}

    def _save_favorites(self, data: dict[str, Any]) -> None:
        self._favorites_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _load_history(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self._history_path().read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save_history(self, data: list[dict[str, Any]]) -> None:
        self._history_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _download_file_sync(
        self, url: str, save_dir: Path, filename: str | None = None, headers: dict[str, str] | None = None
    ) -> str | None:
        import requests

        try:
            preview_path = self._extract_preview_path(url)
            if preview_path is not None:
                path = Path(preview_path)
                if path.is_file() and self.is_path_safe(str(path)):
                    save_dir.mkdir(parents=True, exist_ok=True)
                    if not filename:
                        filename = path.name or "download.jpg"
                    dest = save_dir / self._sanitize_filename(filename)
                    shutil.copy2(path, dest)
                    return str(dest)

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
            logger.error("Download failed: {}", e)
            return None

    @staticmethod
    def _extract_preview_path(url: str) -> str | None:
        """If ``url`` is a local /api/preview URL, return the decoded path."""
        if not url:
            return None
        parsed = urlparse(url)
        if parsed.path != "/api/preview":
            return None
        params = parse_qs(parsed.query)
        paths = params.get("path")
        if not paths:
            return None
        return unquote(paths[0])

    def get_current_wallpaper(self) -> dict[str, str] | None:
        path = get_sys_wallpaper()
        if not path:
            return None
        preview_url = self._build_preview_url(path)
        return {
            "path": path,
            "filename": Path(path).name,
            "preview_url": preview_url,
        }

    # --- Local image serving (no base64: bytes streamed via FastAPI) ---

    def safe_roots(self) -> set[Path]:
        """Directories whose files may be served through the preview endpoint."""
        roots = {Path(get_data_dir()).resolve(), Path(get_cache_dir()).resolve()}
        raw_dl = self.store.get("download_directory") or self.store.get("storage.download_directory")
        if isinstance(raw_dl, str) and raw_dl.strip():
            with contextlib.suppress(Exception):
                roots.add(Path(raw_dl.strip()).resolve())
        return roots

    def is_path_safe(self, image_path: str) -> bool:
        """True when ``image_path`` resolves to a location within a safe root.

        This guards the preview endpoint against directory-traversal: only files
        inside the app's data/cache/download folders can be served.
        """
        try:
            resolved = Path(image_path).resolve()
        except Exception:
            return False
        for root in self.safe_roots():
            try:
                resolved.relative_to(root)
                return True
            except ValueError:
                if str(resolved) == str(root):
                    return True
        return False

    def _build_preview_url(self, image_path: str, max_size: int = 960) -> str | None:
        """Return a relative, token-authenticated URL for a local image.

        Any non-empty path produces a URL; the access control (and the
        requirement that the file actually decodes as an image for paths outside
        the trusted directories) is enforced by the ``/api/preview`` endpoint via
        :meth:`serve_image_bytes`.
        """
        if not image_path:
            return None
        query = f"path={quote(image_path)}&max={max_size}"
        token = self._api_token or ""
        if token:
            query += f"&token={token}"
        return f"/api/preview?{query}"

    def serve_image_bytes(self, image_path: str, max_size: int | None) -> tuple[bytes, str] | None:
        """Return ``(image_bytes, content_type)`` for streaming to the client.

        When ``max_size`` is given, a JPEG thumbnail is generated with Pillow;
        otherwise the original file bytes are returned unchanged (no re-encode).

        Every path is required to actually decode as an image before anything is
        served, regardless of whether it lives in a trusted directory. This
        ensures the preview endpoint cannot be abused to exfiltrate arbitrary
        files (logs, crash reports, favorites.json, ...) that happen to reside
        inside the app's data/cache/download folders.
        """
        path = Path(image_path)
        if not path.is_file():
            return None

        import io

        from PIL import Image

        try:
            with Image.open(path) as img:
                img.verify()  # cheap header/integrity check; rejects non-images
        except Exception:
            logger.debug("serve_image_bytes rejected non-image: {}", path)
            return None

        content_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"

        if max_size:
            try:
                with Image.open(path) as img:
                    preview = img.copy()
                    preview.thumbnail((max_size, max_size))
                    if preview.mode not in {"RGB", "L"}:
                        preview = preview.convert("RGB")
                    buffer = io.BytesIO()
                    preview.save(buffer, format="JPEG", quality=82, optimize=True)
                    return buffer.getvalue(), "image/jpeg"
            except Exception as exc:
                logger.debug("serve_image_bytes thumbnail failed: {}", exc)
                return None

        try:
            return path.read_bytes(), content_type
        except Exception as exc:
            logger.debug("serve_image_bytes read failed: {}", exc)
            return None

    def set_wallpaper(self, path: str) -> dict[str, Any]:
        try:
            set_sys_wallpaper(path)
            self.add_to_history(path, Path(path).name, "set")
            logger.info("Wallpaper set to {}", path)
            return {"success": True}
        except Exception as e:
            logger.error("Failed to set wallpaper {}: {}", path, e)
            return {"success": False, "error": str(e)}

    def get_bing_wallpaper(self) -> dict[str, Any] | None:
        logger.debug("Fetching Bing wallpaper")
        try:
            items = self.bing_service.query_daily(
                market=self.store.get("wallpaper.bing.market", "zh-CN"),
                count=1,
            )
            if not items:
                logger.debug("Bing wallpaper returned no items")
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
        logger.debug("Fetching Spotlight wallpapers")
        try:
            items = self.spotlight_service.list_local_candidates(limit=20)
            if not items:
                logger.debug("Spotlight wallpapers returned no items")
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

    def get_sentence(self) -> dict[str, Any]:
        """Fetch a homepage sentence/quote based on the home_page.source setting."""
        source = self.store.get("home_page.source", "hitokoto")
        if source == "zhaoyu":
            return self._get_zhaoyu()
        if source == "custom":
            return self._get_custom_sentence()
        return self.get_hitokoto()

    def _fallback_sentence(self) -> dict[str, Any]:
        return {
            "hitokoto": "今天也给桌面换一张像样的壁纸。",
            "from": "",
            "from_who": "Little Tree",
        }

    def _get_zhaoyu(self) -> dict[str, Any]:
        import requests

        try:
            resp = requests.get("https://hub.saintic.com/openservice/sentence/", timeout=10)
            payload = resp.json()
            data = payload.get("data", payload) if isinstance(payload, dict) else {}
            content = str(data.get("content") or "").strip()
            if not content:
                return self._fallback_sentence()
            return {
                "hitokoto": content,
                "from": str(data.get("source") or "").strip(),
                "from_who": (str(data.get("author")).strip() or None) if data.get("author") else None,
            }
        except Exception as e:
            logger.warning(f"Zhaoyu failed: {e}, returning default")
            return self._fallback_sentence()

    def _get_custom_sentence(self) -> dict[str, Any]:
        import random

        items = self.store.get("home_page.custom.items", []) or []
        valid = [it for it in items if isinstance(it, dict) and str(it.get("content", "")).strip()]
        if not valid:
            return {
                "hitokoto": "还没有自定义语句，去设置里添加一些吧。",
                "from": "",
                "from_who": None,
            }
        item = random.choice(valid)
        return {
            "hitokoto": str(item.get("content", "")).strip(),
            "from": str(item.get("from", "")).strip(),
            "from_who": item.get("from_who") or None,
        }

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
            return self._fallback_sentence()

    def import_custom_sentences(self) -> list[dict[str, Any]] | None:
        try:
            path = self._show_file_dialog("open", filetypes=[("JSON", "*.json")])
            if not path:
                return None
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
            candidates: list[Any] = []
            if isinstance(raw, list):
                candidates = raw
            elif isinstance(raw, dict):
                candidates = raw.get("items", []) or []
            items: list[dict[str, Any]] = []
            for it in candidates:
                if isinstance(it, dict):
                    content = str(it.get("content") or it.get("hitokoto") or "").strip()
                    if not content:
                        continue
                    items.append(
                        {
                            "content": content,
                            "from": str(it.get("from") or it.get("source") or "").strip(),
                            "from_who": (it.get("from_who") or it.get("author") or None),
                        }
                    )
            if items:
                existing = list(self.store.get("home_page.custom.items", []) or [])
                self.store.set("home_page.custom.items", existing + items)
            return items
        except Exception as e:
            logger.error(f"import_custom_sentences error: {e}")
            return None

    def export_custom_sentences(self) -> str | None:
        try:
            items = self.store.get("home_page.custom.items", []) or []
            path = self._show_file_dialog(
                "save",
                filetypes=[("JSON", "*.json")],
                defaultextension=".json",
                initialfile="custom-sentences.json",
            )
            if not path:
                return None
            Path(path).write_text(
                json.dumps({"items": items}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return path
        except Exception as e:
            logger.error(f"export_custom_sentences error: {e}")
            return None

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

    def copy_image_to_clipboard(self, data: bytes) -> bool:
        """Copy image bytes to the system clipboard.

        Supports Windows (via DIB), macOS (via osascript) and Linux
        (via xclip or wl-copy). Falls back to saving a temporary PNG when
        a native image clipboard format is not available.
        """
        try:
            from PIL import Image

            image = Image.open(io.BytesIO(data))
            logger.debug(
                "copy_image_to_clipboard platform={} size={} mode={}",
                sys.platform,
                image.size,
                image.mode,
            )
            if sys.platform == "win32":
                # Prefer pywin32 when available; it handles window/thread
                # clipboard ownership correctly inside pywebview.
                try:
                    import win32clipboard

                    return self._copy_image_to_clipboard_win32_pywin32(image)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("pywin32 clipboard unavailable ({}), falling back to ctypes", exc)
                    return self._copy_image_to_clipboard_win32(image)
            if sys.platform == "darwin":
                return self._copy_image_to_clipboard_darwin(image)
            return self._copy_image_to_clipboard_linux(image)
        except Exception as e:
            logger.error("Copy image to clipboard failed: {}", e)
            return False

    @staticmethod
    def _copy_image_to_clipboard_win32_pywin32(image: Any) -> bool:
        """Copy a PIL image to the Windows clipboard using pywin32."""
        import io as _io

        import win32clipboard

        output = _io.BytesIO()
        image.convert("RGB").save(output, "BMP")
        dib_data = output.getvalue()[14:]
        output.close()

        try:
            win32clipboard.OpenClipboard()
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardData(win32clipboard.CF_DIB, dib_data)
            return True
        except Exception as e:
            logger.error("win32clipboard copy failed: {}", e)
            return False
        finally:
            with contextlib.suppress(Exception):
                win32clipboard.CloseClipboard()

    @staticmethod
    def _copy_image_to_clipboard_win32(image: Any) -> bool:
        """Copy a PIL image to the Windows clipboard as CF_DIB."""
        import ctypes
        from ctypes import wintypes

        output = io.BytesIO()
        image.convert("RGB").save(output, "BMP")
        # Strip the BITMAPFILEHEADER so the remaining bytes are CF_DIB.
        dib_data = output.getvalue()[14:]
        output.close()

        CF_DIB = 8
        GMEM_MOVEABLE = 0x0002

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        if not user32.OpenClipboard(0):
            err = ctypes.get_last_error()
            logger.error("OpenClipboard failed: error={}", err)
            return False
        try:
            user32.EmptyClipboard()
            h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(dib_data))
            if not h_mem:
                err = ctypes.get_last_error()
                logger.error("GlobalAlloc failed: error={}", err)
                return False
            ptr = kernel32.GlobalLock(h_mem)
            if not ptr:
                err = ctypes.get_last_error()
                logger.error("GlobalLock failed: error={}", err)
                kernel32.GlobalFree(h_mem)
                return False
            try:
                ctypes.memmove(ptr, dib_data, len(dib_data))
            finally:
                kernel32.GlobalUnlock(h_mem)
            if not user32.SetClipboardData(CF_DIB, h_mem):
                err = ctypes.get_last_error()
                logger.error("SetClipboardData failed: error={}", err)
                kernel32.GlobalFree(h_mem)
                return False
            return True
        finally:
            user32.CloseClipboard()

    @staticmethod
    def _copy_image_to_clipboard_darwin(image: Any) -> bool:
        """Copy a PIL image to the macOS clipboard via a temporary PNG."""
        import subprocess
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            image.save(f, "PNG")
            path = f.name

        try:
            script = f'set the clipboard to (read (POSIX file "{path}") as PNG)'
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
            )
            return result.returncode == 0
        finally:
            with contextlib.suppress(Exception):
                os.unlink(path)

    @staticmethod
    def _copy_image_to_clipboard_linux(image: Any) -> bool:
        """Copy a PIL image to the Linux clipboard via xclip or wl-copy."""
        import subprocess
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            image.save(f, "PNG")
            path = f.name

        try:
            for cmd, args in (
                (["xclip", "-selection", "clipboard", "-t", "image/png", "-i", path], None),
                (["wl-copy", "--type", "image/png"], path),
            ):
                try:
                    if args is None:
                        result = subprocess.run(cmd)
                    else:
                        with open(args, "rb") as img:
                            result = subprocess.run(cmd, stdin=img)
                    if result.returncode == 0:
                        return True
                except FileNotFoundError:
                    continue
            return False
        finally:
            with contextlib.suppress(Exception):
                os.unlink(path)

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        """Reduce a client-supplied filename to a safe basename (no traversal)."""
        base = Path(name or "").name
        base = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", base).strip(" .")
        return base or "download"

    def _pick_save_path(self, suggested_name: str) -> str | None:
        """Open a native Save dialog and return the chosen path (or None)."""
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        try:
            path = filedialog.asksaveasfilename(
                defaultextension=".jpg",
                initialfile=suggested_name,
                filetypes=[("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.gif"), ("All files", "*.*")],
            )
            return path or None
        finally:
            root.destroy()

    def save_blob_to_downloads(self, data: bytes, filename: str) -> str | None:
        """Persist raw ``data`` bytes into the downloads directory."""
        try:
            save_dir = self._downloads_dir()
            save_dir.mkdir(parents=True, exist_ok=True)
            filepath = save_dir / self._sanitize_filename(filename)
            filepath.write_bytes(data)
            return str(filepath)
        except Exception as e:
            logger.error(f"Save blob to downloads error: {e}")
            return None

    def save_blob_as(self, data: bytes, filename: str) -> str | None:
        """Prompt for a save location and persist raw ``data`` bytes there."""
        try:
            chosen = self._pick_save_path(self._sanitize_filename(filename))
            if not chosen:
                return None
            Path(chosen).write_bytes(data)
            return chosen
        except Exception as e:
            logger.error(f"Save blob as error: {e}")
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

    def search_baidu_images(self, text: str, index: int = 0, size: int = 30) -> list[dict[str, Any]]:
        """调用百度图片搜索接口返回图片列表。"""
        import urllib.parse

        import requests

        if not text:
            return []
        uri = (
            "https://m.baidu.com/sf/vsearch/image/search/wisesearchresult?"
            f"word={urllib.parse.quote(text)}&pn={index}&rn={size}"
        )
        headers = {"User-Agent": self.store.get("sniff.user_agent", "Mozilla/5.0")}
        try:
            resp = requests.get(uri, headers=headers, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            return [
                {
                    "src": p.get("thumbnailUrl"),
                    "ori": p.get("objurl"),
                    "url": p.get("fromUrl"),
                    "title": p.get("oriTitle"),
                    "width": p.get("width"),
                    "height": p.get("height"),
                    "hex": p.get("shituToken"),
                }
                for p in data.get("linkData", [])
            ]
        except Exception as e:
            logger.error(f"Baidu image search error: {e}")
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
        # 自动将新标签加入 all_tags
        all_tags = set(data.get("all_tags", []))
        for tag in new_item.get("tags", []):
            all_tags.add(tag)
        data["all_tags"] = sorted(all_tags)
        self._save_favorites(data)
        return new_item

    def ensure_tag(self, name: str) -> None:
        data = self._load_favorites()
        all_tags = set(data.get("all_tags", []))
        all_tags.add(name)
        data["all_tags"] = sorted(all_tags)
        self._save_favorites(data)

    def rename_tag(self, old_name: str, new_name: str) -> None:
        data = self._load_favorites()
        all_tags = data.get("all_tags", [])
        if old_name in all_tags:
            all_tags[all_tags.index(old_name)] = new_name
            data["all_tags"] = all_tags
        for item in data.get("items", []):
            tags = item.get("tags", [])
            if old_name in tags:
                item["tags"] = [t if t != old_name else new_name for t in tags]
        self._save_favorites(data)

    def delete_tag(self, name: str) -> None:
        data = self._load_favorites()
        all_tags = data.get("all_tags", [])
        if name in all_tags:
            all_tags.remove(name)
            data["all_tags"] = all_tags
        for item in data.get("items", []):
            tags = item.get("tags", [])
            if name in tags:
                item["tags"] = [t for t in tags if t != name]
        self._save_favorites(data)

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
            # Preview URLs are built live (token-scoped) and never persisted, so
            # old base64 entries are replaced with fresh HTTP URLs each call.
            if i < max_preview_items:
                item["preview_url"] = self._build_preview_url(item.get("path", ""), max_size=320)
            else:
                item.pop("preview_url", None)
        return history

    def add_to_history(self, path: str, title: str, reason: str) -> None:
        history = self._load_history()
        history = [h for h in history if h.get("path") != path]
        history.insert(
            0,
            {
                "path": path,
                "title": title,
                "reason": reason,
                "time": datetime.now().isoformat(),
            },
        )
        history = history[:200]
        self._save_history(history)

    def check_for_updates(self) -> dict[str, Any] | None:
        return None

    def open_folder(self, path: str) -> None:
        # Spawn the OS handler with an argument list (never a shell) so a
        # crafted path containing quotes or shell metacharacters cannot perform
        # command injection.
        if not isinstance(path, str) or not path:
            return
        try:
            if sys.platform == "win32":
                os.startfile(path)
            elif sys.platform == "darwin":
                subprocess.run(["open", path], check=False)
            else:
                subprocess.run(["xdg-open", path], check=False)
        except Exception as e:
            logger.error("open_folder failed for {}: {}", path, e)

    def open_file(self, path: str) -> None:
        # 使用系统默认应用打开文件（在 Windows 上 os.startfile 既可打开文件也可打开目录）
        self.open_folder(path)

    def open_url(self, url: str) -> None:
        webbrowser.open(url)

    def get_wallpaper_sources(self) -> list[dict[str, Any]]:
        try:
            return self.ltws_service.list_sources()
        except Exception as e:
            logger.error(f"get_wallpaper_sources error: {e}")
            return []

    def set_wallpaper_source_enabled(self, source_id: str, enabled: bool) -> dict[str, Any]:
        try:
            return self.ltws_service.set_source_enabled(source_id, enabled)
        except Exception as e:
            logger.error(f"set_wallpaper_source_enabled error: {e}")
            return {"error": str(e)}

    def delete_wallpaper_source(self, source_id: str) -> dict[str, Any]:
        try:
            return self.ltws_service.delete_source(source_id)
        except Exception as e:
            logger.error(f"delete_wallpaper_source error: {e}")
            return {"error": str(e)}

    def execute_wallpaper_source(
        self, source_id: str, api_name: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        try:
            return self.ltws_service.execute_api(source_id, api_name, parameters or {})
        except Exception as e:
            logger.error(f"execute_wallpaper_source error: {e}")
            return []

    def pick_and_import_source(self) -> dict[str, Any] | None:
        try:
            path = self._show_file_dialog(
                "open",
                filetypes=[("Wallpaper Source", "*.ltws *.json *.toml *.yaml *.yml")],
            )
            if not path:
                return None
            return self.ltws_service.import_source(path)
        except Exception as e:
            logger.error(f"pick_and_import_source error: {e}")
            return None

    def import_wallpaper_source_as_draft(self) -> dict[str, Any] | None:
        try:
            path = self._show_file_dialog(
                "open",
                filetypes=[("APICORE / OpenAPI", "*.json *.toml *.yaml *.yml")],
            )
            if not path:
                return None
            return self.ltws_service.import_source_as_payload(path)
        except Exception as e:
            logger.error(f"import_wallpaper_source_as_draft error: {e}")
            return None

    def create_wallpaper_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.ltws_service.create_source(payload)
        except Exception as e:
            logger.error(f"create_wallpaper_source error: {e}")
            return {"error": str(e)}

    def update_wallpaper_source(self, source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return self.ltws_service.update_source(source_id, payload)
        except Exception as e:
            logger.error(f"update_wallpaper_source error: {e}")
            return {"error": str(e)}

    def export_wallpaper_source(self, source_id: str, suggested_name: str | None = None) -> dict[str, Any] | None:
        try:
            import re

            base_name = re.sub(r'[\\/:*?"<>|]+', "-", suggested_name or source_id).strip().strip(".")
            if not base_name:
                base_name = "wallpaper-source"
            if not base_name.lower().endswith(".ltws"):
                base_name = f"{base_name}.ltws"
            path = self._show_file_dialog(
                "save",
                filetypes=[("Wallpaper Source Package", "*.ltws")],
                defaultextension=".ltws",
                initialfile=base_name,
            )
            if not path:
                return None
            return self.ltws_service.export_source(source_id, path)
        except Exception as e:
            logger.error(f"export_wallpaper_source error: {e}")
            return None

    def export_wallpaper_source_payload(
        self,
        payload: dict[str, Any],
        export_format: str,
        suggested_name: str | None = None,
        export_options: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        try:
            import re

            normalized_format = str(export_format or "").strip().lower()
            if normalized_format == "apicore_v1":
                default_name = f"{suggested_name or 'wallpaper-source'}.json"
                file_types = [("APICORE v1", "*.json")]
            elif normalized_format == "apicore_v2":
                default_name = f"{suggested_name or 'wallpaper-source'}.json"
                file_types = [("APICORE v2", "*.json *.yaml *.yml *.toml")]
            elif normalized_format == "openapi_3_2":
                default_name = f"{suggested_name or 'wallpaper-source'}.yaml"
                file_types = [("OpenAPI 3.2", "*.yaml *.yml *.json")]
            else:
                return None
            base_name = re.sub(r'[\\/:*?"<>|]+', "-", default_name).strip().strip(".")
            path = self._show_file_dialog(
                "save",
                filetypes=file_types,
                initialfile=base_name,
            )
            if not path:
                return None
            return self.ltws_service.export_payload(payload, normalized_format, path, export_options)
        except Exception as e:
            logger.error(f"export_wallpaper_source_payload error: {e}")
            return None

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

    def get_local_image_url(self, image_path: str, max_size: int = 960) -> str | None:
        """Return a token-authenticated preview URL for a local image.

        Replaces the former base64 data-URL approach; the bytes are streamed by
        the ``/api/preview`` endpoint on demand.
        """
        return self._build_preview_url(image_path, max_size=max_size)

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
        return self.bing_service.query_daily(market=market, count=count, quality=quality, force_refresh=force_refresh)

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
        return self.spotlight_service.list_local_candidates(limit=limit, force_refresh=force_refresh)

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
        logger.info("Bootstrapping application")
        home_bing = self.bing_service.query_daily(market="zh-CN", count=1)
        quote = self.get_sentence()
        try:
            sources = self.ltws_service.list_sources()
        except Exception as e:
            logger.error(f"bootstrap sources error: {e}")
            sources = []
        logger.info("Bootstrap complete: bing={} sources={}", len(home_bing), len(sources))
        return {
            "settings": self.store.as_dict(),
            "favorites": self._load_favorites(),
            "history": self._load_history(),
            "sources": sources,
            "plugins": [],
            "runtime": {
                "debug": {"enabled": False, "session_enabled": False, "open_devtools_on_start": True},
                "window": {
                    "hide_on_close": self.store.get("ui.hide_on_close", True),
                    "minimize_to_tray": self.store.get("ui.minimize_to_tray", True),
                },
            },
            "home": {
                "bing": home_bing[:1],
                "spotlight": self.spotlight_service.list_local_candidates(limit=4),
                "quote": {
                    "text": quote.get("hitokoto", ""),
                    "author": quote.get("from_who", ""),
                    "source": quote.get("from", ""),
                },
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
            "window": {
                "hide_on_close": self.store.get("ui.hide_on_close", True),
                "minimize_to_tray": self.store.get("ui.minimize_to_tray", True),
            },
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
                {
                    "id": "downloads",
                    "title": "下载",
                    "scope": "data",
                    "size_bytes": total_size,
                    "file_count": file_count,
                    "optimize_supported": False,
                },
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

    def get_log_stats(self) -> dict[str, Any]:
        """Return log file counts, total size, entry/error counts and the active file level."""
        from backend import logging_setup

        return logging_setup.get_log_stats()

    def set_log_file_level(self, level: str) -> dict[str, Any]:
        """Change the level of the *file* sinks only (console is unaffected)."""
        from backend import logging_setup

        logging_setup.set_file_level(level)
        return logging_setup.get_log_stats()

    def clear_logs(self) -> dict[str, Any]:
        """Delete all log files and reopen fresh sinks at the current level."""
        from backend import logging_setup

        return logging_setup.clear_logs()

    def get_debug_log(self, lines: int = 240) -> dict[str, Any]:
        """Return the tail of the current session log file.

        Walks the log directory and reads the most recently modified
        ``app_*.log`` file. ``lines`` is capped to avoid huge payloads.
        """
        log_dir = get_cache_dir() / "logs"
        try:
            log_files = sorted(
                (f for f in log_dir.glob("app_*.log") if f.is_file()),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
        except OSError as exc:
            logger.warning("Failed to list log directory {}: {}", log_dir, exc)
            return {"path": "", "content": "", "truncated": False, "lines": 0, "error": str(exc)}

        if not log_files:
            return {"path": "", "content": "", "truncated": False, "lines": 0}

        target = log_files[0]
        max_lines = max(1, min(lines, 2000))
        try:
            with target.open("r", encoding="utf-8", errors="replace") as f:
                all_lines = f.readlines()
            tail = all_lines[-max_lines:]
            content = "".join(tail)
            return {
                "path": str(target),
                "content": content,
                "truncated": len(all_lines) > max_lines,
                "lines": len(tail),
            }
        except OSError as exc:
            logger.warning("Failed to read log file {}: {}", target, exc)
            return {"path": str(target), "content": "", "truncated": False, "lines": 0, "error": str(exc)}

    def open_debug_log_directory(self) -> dict[str, Any]:
        log_dir = get_cache_dir() / "logs"
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            self.open_folder(str(log_dir))
            return {"opened_path": str(log_dir)}
        except Exception as exc:
            logger.error("Failed to open log directory {}: {}", log_dir, exc)
            return {"opened_path": str(log_dir), "error": str(exc)}

    def open_debug_log_file(self) -> dict[str, Any]:
        log_dir = get_cache_dir() / "logs"
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            log_files = sorted(
                (f for f in log_dir.glob("app_*.log") if f.is_file()),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
        except OSError as exc:
            logger.warning("Failed to list log directory {}: {}", log_dir, exc)
            return {"opened_path": "", "error": str(exc)}

        if not log_files:
            return {"opened_path": ""}

        target = log_files[0]
        try:
            self.open_file(str(target))
            return {"opened_path": str(target)}
        except Exception as exc:
            logger.error("Failed to open log file {}: {}", target, exc)
            return {"opened_path": str(target), "error": str(exc)}

    def save_debug_log(self, target_path: str | None = None) -> dict[str, Any]:
        """Copy the current session log file to a user-chosen location.

        If ``target_path`` is omitted, a native Save dialog is shown.
        Returns the path the log was saved to.
        """
        log_dir = get_cache_dir() / "logs"
        try:
            log_files = sorted(
                (f for f in log_dir.glob("app_*.log") if f.is_file()),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
        except OSError as exc:
            logger.error("Failed to list log directory {}: {}", log_dir, exc)
            return {"saved_path": "", "error": str(exc)}

        if not log_files:
            return {"saved_path": "", "error": "没有可用的日志文件"}

        source = log_files[0]
        destination: Path | None = None
        if target_path:
            destination = Path(target_path)
        else:
            picked_path = self._pick_save_path(source.name)
            if not picked_path:
                return {"saved_path": "", "cancelled": True}
            destination = Path(picked_path)

        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(source.read_bytes())
            logger.info("Debug log saved from {} to {}", source, destination)
            return {"saved_path": str(destination)}
        except Exception as exc:
            logger.error("Failed to save debug log to {}: {}", destination, exc)
            return {"saved_path": "", "error": str(exc)}

    def get_crash_reports(self) -> list[dict[str, Any]]:
        """List generated crash report files ordered by newest first."""
        report_dir = get_cache_dir() / "crash_reports"
        if not report_dir.exists():
            return []
        try:
            files = sorted(
                (f for f in report_dir.glob("crash_report_*.txt") if f.is_file()),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            return [
                {
                    "path": str(f),
                    "name": f.name,
                    "size": f.stat().st_size,
                    "created_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                }
                for f in files
            ]
        except OSError as exc:
            logger.warning("Failed to list crash reports: {}", exc)
            return []

    def open_crash_report(self, report_path: str) -> dict[str, Any]:
        """Open a crash report with the system default application."""
        try:
            self.open_file(report_path)
            return {"opened_path": report_path}
        except Exception as exc:
            logger.error("Failed to open crash report {}: {}", report_path, exc)
            return {"opened_path": "", "error": str(exc)}
