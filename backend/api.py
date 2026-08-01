from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import mimetypes
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import uuid
import webbrowser
from collections.abc import Callable
from datetime import datetime
from functools import wraps
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

from loguru import logger

from backend.app_meta import (
    VERSION,
    get_app_info,
    get_build_info,
    get_metadata,
)
from backend.paths import ensure_dirs, get_cache_dir, get_config_dir, get_data_dir
from backend.plugins import PluginManager
from backend.plugins.validation import SAFE_IMAGE_SUFFIXES
from backend.services.automation import AutomationService
from backend.services.bing import BingService
from backend.services.cnu import CNUService
from backend.services.download import (
    DownloadError,
    WriteResult,
    stream_to_file_atomic,
    write_blob_atomic,
)
from backend.services.download import (
    sanitize_filename as _shared_sanitize_filename,
)
from backend.services.dynamic_wallpaper import (
    SUPPORTED_IMAGE_SUFFIXES,
    SUPPORTED_VIDEO_SUFFIXES,
    WindowsDynamicWallpaperService,
)
from backend.services.intelligent_market import IntelligentMarketService
from backend.services.ltws import LTWSService
from backend.services.pexels import PexelsService
from backend.services.pixivel import PixivelService
from backend.services.sniff import SniffService
from backend.services.spotlight import SpotlightService
from backend.services.storage import StorageService
from backend.services.sys_wallpaper import get_display_resolutions, get_sys_wallpaper
from backend.services.sys_wallpaper import set_wallpaper as set_sys_wallpaper
from backend.services.theme import DEFAULT_THEME_ID, ThemeService
from backend.services.timeline import TimelineService
from backend.settings_manager import get_settings_store

AUTOMATION_IMAGE_SUFFIXES = SAFE_IMAGE_SUFFIXES | {".avif", ".bmp"}

ensure_dirs()


def _favorites_transaction(method: Any) -> Any:
    @wraps(method)
    def wrapped(self: Any, *args: Any, **kwargs: Any) -> Any:
        with self.store.transaction(), self._favorites_lock:
            return method(self, *args, **kwargs)

    return wrapped


def _storage_references_transaction(method: Any) -> Any:
    @wraps(method)
    def wrapped(self: Any, *args: Any, **kwargs: Any) -> Any:
        with self.store.transaction(), self._storage_references_lock:
            return method(self, *args, **kwargs)

    return wrapped


class BackendAPI:
    def __init__(self) -> None:
        self.store = get_settings_store()
        self.plugin_manager = PluginManager()
        self.bing_service = BingService()
        self.cnu_service = CNUService()
        self.pexels_service = PexelsService()
        self.pixivel_service = PixivelService()
        self.spotlight_service = SpotlightService()
        self.sniff_service = SniffService()
        self.timeline_service = TimelineService()
        self.dynamic_wallpaper_service = WindowsDynamicWallpaperService()
        self.theme_service = ThemeService(get_config_dir() / "themes")
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
        self._dynamic_editor_window: Any | None = None
        self._dynamic_editor_url = ""
        self._dynamic_editor_allow_close = False
        self._pending_wallpaper_lock = threading.RLock()
        self._pending_static_wallpaper: dict[str, Any] | None = None
        self._desktop_notify: Callable[[str, str], None] | None = None
        self._favorites_lock = threading.RLock()
        self._automation_rotation_lock = threading.RLock()
        self._storage_references_lock = threading.RLock()
        self._storage_task_lock = threading.Lock()
        self._storage_task_state: dict[str, Any] = {
            "id": "",
            "running": False,
            "kind": "",
            "title": "",
            "message": "",
            "current": 0,
            "total": 1,
            "success": None,
            "error": "",
            "moved": 0,
            "undeleted": 0,
            "started_at": "",
            "finished_at": "",
        }
        self._ensure_favorites()
        self._ensure_history()
        self.storage_service = StorageService(
            self.store,
            self._downloads_dir,
            self._favorites_path,
            self._protected_storage_paths,
        )
        self.storage_service.start_automatic_maintenance()
        self.automation_service = AutomationService(
            get_data_dir() / "automations.json",
            self._request_background_wallpaper,
            self._resolve_automation_resource,
            self._normalize_automation_setting_input,
            self.start_dynamic_wallpaper,
            self.control_dynamic_wallpaper,
            self.stop_dynamic_wallpaper,
            data_root=get_data_dir() / "automation_data",
            notify=lambda title, message: self._desktop_notify(title, message) if self._desktop_notify else None,
            manage_dynamic_wallpaper=self.automation_dynamic_wallpaper,
        )

    @staticmethod
    def _automation_config_value(config: dict[str, Any], pointer: str) -> Any:
        current: Any = config
        for part in pointer.lstrip("/").split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            if not isinstance(current, dict) or part not in current:
                return None
            current = current[part]
        return current

    def _normalize_automation_setting_input(
        self,
        node_type: str,
        pointer: str,
        value: Any,
        config: dict[str, Any],
    ) -> Any:
        """Coerce connected values, including select IDs and 1-based indexes."""
        static_options: dict[tuple[str, str], list[str]] = {
            ("trigger", "/kind"): ["manual", "startup", "interval", "schedule"],
            ("condition", "/expression/left/type"): ["system", "variable"],
            ("condition", "/expression/operator"): ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "matches"],
            ("function", "/name"): ["add", "multiply", "concat", "length", "lower", "upper", "random_int"],
            ("match", "/operator"): ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "starts_with", "ends_with", "matches"],
            ("loop", "/mode"): ["count", "items", "while"],
            ("calculate", "/operation"): ["add", "subtract", "multiply", "divide", "mod", "power", "min", "max"],
            ("open_target", "/kind"): ["auto", "file", "folder", "url"],
            ("system_action", "/action"): ["shutdown", "restart", "logout", "sleep"],
            ("write_file", "/action"): ["create", "write", "append"],
            ("datetime", "/timezone"): ["local", "utc"],
            ("fetch_resource", "/source"): ["im", "bing", "spotlight", "cnu", "pixiv", "ltws", "folder", "favorites"],
            ("fetch_resource", "/category"): ["daily", "recent"],
            ("fetch_resource", "/market"): ["zh-CN", "en-US", "ja-JP", "de-DE", "fr-FR"],
            ("fetch_resource", "/quality"): ["highDef", "ultraHighDef"],
            ("fetch_resource", "/spotlight_source"): ["online", "local"],
            ("fetch_resource", "/section"): ["selected", "inspiration", "discovery"],
            ("fetch_resource", "/order"): ["recommend", "hot", "recent", "shuffle", "sequential"],
            ("fetch_resource", "/mode"): [
                "day", "week", "month", "day_male", "day_female", "week_original", "week_rookie",
                "day_manga", "day_r18", "week_r18", "day_male_r18", "day_female_r18", "week_r18g",
            ],
            ("fetch_resource", "/selection"): ["random", "first", "index"],
            ("fetch_resource", "/work_selection"): ["random", "first", "index"],
            ("fetch_resource", "/image_selection"): ["random", "first", "index"],
            ("dynamic_wallpaper", "/action"): ["start", "get_type", "video_control", "replace_video", "slideshow_control", "slideshow_transition", "slideshow_source", "slideshow_settings", "play", "pause", "reload", "stop"],
            ("dynamic_wallpaper", "/video_action"): ["auto", "play", "pause"],
            ("dynamic_wallpaper", "/slideshow_action"): ["next", "previous"],
            ("dynamic_wallpaper", "/source"): ["folder", "favorites"],
            ("dynamic_wallpaper", "/transition"): ["fade", "slide-left", "slide-up", "zoom", "blur", "wipe", "flip", "ken-burns"],
        }
        options = static_options.get((node_type, pointer))
        if node_type == "fetch_resource" and pointer == "/source_id":
            if config.get("source") == "im":
                options = [str(item.get("id")) for item in self.list_intelligent_market_sources()]
            elif config.get("source") == "ltws":
                options = [str(item.get("identifier")) for item in self.get_wallpaper_sources() if item.get("enabled")]
        elif node_type == "fetch_resource" and pointer == "/api_name":
            source_id = str(config.get("source_id") or "")
            source = next(
                (item for item in self.get_wallpaper_sources() if str(item.get("identifier")) == source_id),
                None,
            )
            options = [str(item.get("name")) for item in (source or {}).get("apis", [])]
        elif node_type == "fetch_resource" and pointer.startswith("/parameters/"):
            parameter_key = pointer.split("/", 2)[-1].replace("~1", "/").replace("~0", "~")
            if config.get("source") == "im":
                source = next(
                    (item for item in self.list_intelligent_market_sources() if item.get("id") == config.get("source_id")),
                    None,
                )
                parameter = next((item for item in (source or {}).get("parameters", []) if item.get("key") == parameter_key), None)
                if parameter and isinstance(parameter.get("options"), list):
                    options = [str(item) for item in parameter["options"]]
            elif config.get("source") == "ltws":
                source = next(
                    (item for item in self.get_wallpaper_sources() if item.get("identifier") == config.get("source_id")),
                    None,
                )
                api = next((item for item in (source or {}).get("apis", []) if item.get("name") == config.get("api_name")), None)
                parameter = next((item for item in (api or {}).get("parameters", []) if item.get("key") == parameter_key), None)
                if parameter and isinstance(parameter.get("choices"), list):
                    options = [str(item) for item in parameter["choices"]]

        if options is not None:
            if isinstance(value, str):
                if value in options:
                    return value
                raise ValueError(f"设置 {pointer} 不包含选项：{value}")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and float(value).is_integer():
                index = int(value)
                if 1 <= index <= len(options):
                    return options[index - 1]
                raise ValueError(f"设置 {pointer} 的选项序号应在 1 到 {len(options)} 之间")
            raise ValueError(f"设置 {pointer} 需要选项字符串或从 1 开始的数字序号")

        if node_type == "function" and pointer == "/args":
            values = value if isinstance(value, list) else [value]
            return [item if isinstance(item, dict) else {"type": "literal", "value": item} for item in values]

        configured = self._automation_config_value(config, pointer)
        if isinstance(configured, bool):
            if isinstance(value, str):
                return value.strip().lower() in {"1", "true", "yes", "on"}
            return bool(value)
        if isinstance(configured, int) and not isinstance(configured, bool):
            return int(float(value))
        if isinstance(configured, float):
            return float(value)
        return value

    @staticmethod
    def _select_automation_item(items: list[dict[str, Any]], config: dict[str, Any], key: str = "selection") -> dict[str, Any]:
        if not items:
            raise RuntimeError("资源接口没有返回壁纸")
        strategy = str(config.get(key) or "random")
        if strategy == "first":
            return items[0]
        if strategy == "index":
            index = max(0, min(len(items) - 1, int(config.get(f"{key}_index", 1)) - 1))
            return items[index]
        import random

        return random.choice(items)

    def _select_automation_rotation_item(
        self,
        items: list[dict[str, Any]],
        config: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        if not items:
            raise RuntimeError("轮换队列中没有可用壁纸")
        identities = [str(item["rotation_id"]) for item in items]
        item_by_id = {str(item["rotation_id"]): item for item in items}
        fingerprint_payload = {
            "source": config.get("source"),
            "scope": config.get("scope"),
            "folder_id": config.get("folder_id"),
            "item_ids": config.get("item_ids"),
            "path": config.get("path"),
            "recursive": bool(config.get("recursive", False)),
            "order": config.get("order", "shuffle"),
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        node_namespace = hashlib.sha256(str(context["node_id"]).encode("utf-8")).hexdigest()[:16]
        state_path = Path(str(context["data_directory"])) / f"rotation-{node_namespace}.json"
        with self._automation_rotation_lock:
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except Exception:
                state = {}
            if state.get("fingerprint") != fingerprint:
                state = {"fingerprint": fingerprint, "cycle_ids": [], "remaining_ids": [], "last_id": ""}
            current_ids = set(identities)
            cycle_ids = [item_id for item_id in state.get("cycle_ids", []) if item_id in current_ids]
            remaining = [item_id for item_id in state.get("remaining_ids", []) if item_id in current_ids]
            additions = [item_id for item_id in identities if item_id not in set(cycle_ids)]
            if str(config.get("order") or "shuffle") == "shuffle":
                random.shuffle(additions)
            cycle_ids.extend(additions)
            remaining.extend(additions)
            if not remaining:
                cycle_ids = list(identities)
                remaining = list(identities)
                if str(config.get("order") or "shuffle") == "shuffle":
                    random.shuffle(remaining)
                last_id = str(state.get("last_id") or "")
                if len(remaining) > 1 and remaining[0] == last_id:
                    remaining[0], remaining[1] = remaining[1], remaining[0]
            selected_id = remaining.pop(0)
            self._write_json_atomic(state_path, {
                "fingerprint": fingerprint,
                "cycle_ids": cycle_ids,
                "remaining_ids": remaining,
                "last_id": selected_id,
            })
        return item_by_id[selected_id]

    def _favorite_rotation_items(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        data = self._load_favorites()
        scope = str(config.get("scope") or "folder")
        if scope == "selected":
            selected_ids = {str(item_id) for item_id in config.get("item_ids", [])}
            items = [item for item in data.get("items", []) if str(item.get("id")) in selected_ids]
        else:
            folder_id = str(config.get("folder_id") or "")
            if not any(str(folder.get("id")) == folder_id for folder in data.get("folders", [])):
                raise ValueError("轮换绑定的收藏夹已不存在")
            items = [item for item in data.get("items", []) if str(item.get("folder_id")) == folder_id]
        return [{**item, "rotation_id": str(item.get("id"))} for item in items if item.get("id")]

    def _folder_rotation_items(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        folder = Path(str(config.get("path") or "")).expanduser().resolve()
        if not folder.is_dir():
            raise NotADirectoryError(f"轮换文件夹不存在：{folder}")
        iterator = folder.rglob("*") if bool(config.get("recursive", False)) else folder.glob("*")
        paths = sorted(
            (path for path in iterator if path.is_file() and not path.is_symlink() and path.suffix.lower() in AUTOMATION_IMAGE_SUFFIXES),
            key=lambda path: str(path.relative_to(folder)).casefold(),
        )
        return [{"rotation_id": str(path), "path": str(path), "title": path.stem} for path in paths]

    def _resolve_automation_resource(self, config: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Resolve one configured source result into a verified local image path."""
        try:
            source = str(config.get("source") or "bing")
            item: dict[str, Any]
            if source == "folder":
                item = self._select_automation_rotation_item(self._folder_rotation_items(config), config, context)
                path = str(item["path"])
                return {"success": True, "path": path, "item": item}
            if source == "favorites":
                item = self._select_automation_rotation_item(self._favorite_rotation_items(config), config, context)
                local_path = Path(str(item.get("local_path") or "")).expanduser()
                if local_path.is_file() and local_path.suffix.lower() in AUTOMATION_IMAGE_SUFFIXES:
                    return {"success": True, "path": str(local_path.resolve()), "item": item}
                image_url = str(item.get("source_url") or item.get("preview_url") or "")
                if not image_url:
                    raise RuntimeError(f"收藏「{item.get('title') or item.get('id')}」没有可用图片")
                suffix = Path(urlparse(self._unwrap_session_url(image_url)).path).suffix.lower()
                filename = f"favorite-{item['id']}{suffix if suffix in AUTOMATION_IMAGE_SUFFIXES else '.jpg'}"
                headers = {"Referer": str(item["source_page_url"])} if item.get("source_page_url") else {}
                path = self._download_file_sync(image_url, self._downloads_dir() / "automation" / "favorites", filename=filename, headers=headers)
                if not path:
                    raise RuntimeError(f"收藏「{item.get('title') or item.get('id')}」下载失败")
                stable_item = {key: value for key, value in item.items() if key != "rotation_id"}
                self.update_favorite({**stable_item, "local_path": path})
                return {"success": True, "path": path, "item": item}
            if source == "bing":
                items = self.query_bing(
                    str(config.get("category") or "daily"),
                    str(config.get("market") or "zh-CN"),
                    max(1, min(20, int(config.get("count", 8)))),
                    str(config.get("quality") or "highDef"),
                    bool(config.get("force_refresh", False)),
                )
                item = self._select_automation_item(items, config)
            elif source == "spotlight":
                items = self.query_spotlight(
                    str(config.get("spotlight_source") or "online"),
                    max(1, min(100, int(config.get("limit", 20)))),
                    str(config.get("market") or "zh-CN"),
                    bool(config.get("force_refresh", False)),
                )
                item = self._select_automation_item(items, config)
            elif source == "cnu":
                section = str(config.get("section") or "selected")
                if section == "selected":
                    works = self.query_cnu_selected(int(config.get("page", 1)), int(config.get("limit", 20)), bool(config.get("force_refresh", False)))
                else:
                    works = self.query_cnu_works(
                        section,
                        str(config.get("order") or ("recent" if section == "inspiration" else "recommend")),
                        str(config.get("category_id") or "0"),
                        int(config.get("page", 1)),
                        int(config.get("limit", 20)),
                        bool(config.get("force_refresh", False)),
                    )
                work = self._select_automation_item(works, config, "work_selection")
                item = self._select_automation_item(self.get_cnu_work(str(work["id"])), config, "image_selection")
            elif source == "pixiv":
                mode = str(config.get("mode") or "day")
                if "r18" in mode and not bool(self.store.get("wallpaper.allow_NSFW", False)):
                    raise ValueError("Pixiv R18 排行榜需要先在设置中启用 NSFW 内容")
                works = self.query_pixivel_ranking(
                    mode,
                    int(config.get("page", 1)),
                    int(config.get("limit", 30)),
                    bool(config.get("force_refresh", False)),
                    str(config.get("ranking_date") or "") or None,
                )
                work = self._select_automation_item(works, config, "work_selection")
                item = self._select_automation_item(self.get_pixivel_work(str(work["id"])), config, "image_selection")
            elif source == "im":
                items = self.execute_intelligent_market_source(
                    str(config.get("source_id") or ""),
                    config.get("parameters") if isinstance(config.get("parameters"), dict) else {},
                )
                item = self._select_automation_item(items, config)
            elif source == "ltws":
                source_id = str(config.get("source_id") or "")
                api_name = str(config.get("api_name") or "")
                sources = self.get_wallpaper_sources()
                source_document = next((entry for entry in sources if str(entry.get("identifier")) == source_id), None)
                api_document = next(
                    (entry for entry in (source_document or {}).get("apis", []) if str(entry.get("name")) == api_name),
                    None,
                )
                parameters = {
                    str(param.get("key")): param.get("default", "")
                    for param in (api_document or {}).get("parameters", [])
                    if isinstance(param, dict) and param.get("key")
                }
                if isinstance(config.get("parameters"), dict):
                    parameters.update(config["parameters"])
                items = self.execute_wallpaper_source(source_id, api_name, parameters)
                item = self._select_automation_item(items, config)
            else:
                raise ValueError("不支持的自动化资源类型")

            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            image_url = str(metadata.get("original_image_url") or item.get("image_url") or "")
            if source == "spotlight" and str(config.get("spotlight_source") or "online") == "local":
                path = image_url
            else:
                headers: dict[str, str] = {}
                if source == "cnu":
                    headers = {
                        "Referer": str(metadata.get("referer") or "http://www.cnu.cc/"),
                        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    }
                elif source == "im" and metadata.get("referer"):
                    headers["Referer"] = str(metadata["referer"])
                path = self._download_file_sync(image_url, self._downloads_dir() / "automation", headers=headers)
            if not path or not Path(path).is_file():
                raise RuntimeError("资源图片下载或校验失败")
            return {"success": True, "path": str(path), "item": item}
        except Exception as exc:
            logger.error("Automation resource resolution failed: {}", exc)
            return {"success": False, "path": "", "item": None, "error": str(exc)}

    def get_automation_resource_catalog(self) -> dict[str, Any]:
        return {
            "intelligent_market": self.list_intelligent_market_sources(),
            "wallpaper_sources": self.get_wallpaper_sources(),
            "favorite_folders": self._load_favorites().get("folders", []),
        }

    def select_automation_local_image(self) -> str | None:
        return self._show_file_dialog(
            "open",
            filetypes=[("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.gif *.avif")],
        )

    @staticmethod
    def select_automation_directory() -> str | None:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        try:
            path = filedialog.askdirectory()
            return path if path else None
        finally:
            root.destroy()

    def set_api_token(self, token: str) -> None:
        """Inject the per-session token used to authorize preview URLs."""
        self._api_token = token

    def configure_dynamic_wallpaper_runtime(self, base_url: str, token: str, host_window: Any | None = None) -> None:
        self.dynamic_wallpaper_service.configure(base_url, token, host_window)

    def configure_dynamic_editor_runtime(self, editor_window: Any | None, editor_url: str) -> None:
        self._dynamic_editor_window = editor_window
        self._dynamic_editor_url = str(editor_url)
        self._dynamic_editor_allow_close = False
        if editor_window is not None:
            def hide_editor(*_args: Any) -> bool | None:
                if self._dynamic_editor_allow_close:
                    return None
                with contextlib.suppress(Exception):
                    editor_window.hide()
                return False
            editor_window.events.closing += hide_editor

    def _configure_desktop_notifications(
        self,
        notify: Callable[[str, str], None],
    ) -> None:
        self._desktop_notify = notify

    def start_automation_runtime(self) -> None:
        self.automation_service.start()

    def shutdown_dynamic_wallpaper(self) -> None:
        self.dynamic_wallpaper_service.shutdown()
        editor = self._dynamic_editor_window
        self._dynamic_editor_window = None
        self._dynamic_editor_allow_close = True
        if editor is not None:
            with contextlib.suppress(Exception):
                editor.destroy()

    def shutdown_automation(self) -> None:
        self.automation_service.shutdown()

    @staticmethod
    def _sanitize_plugin_result(result: dict[str, Any]) -> dict[str, Any]:
        sanitized = dict(result)
        plugins = sanitized.get("plugins")
        if isinstance(plugins, list):
            sanitized["plugins"] = [
                BackendAPI._sanitize_plugin_result(plugin) if isinstance(plugin, dict) else plugin for plugin in plugins
            ]
        source = sanitized.get("source")
        if isinstance(source, str) and source and source != "installed":
            sanitized["source"] = Path(source).name or "installed"
        return sanitized

    def list_plugins(self) -> dict[str, Any]:
        return self._sanitize_plugin_result(self.plugin_manager.list_plugins())

    def install_plugin_package(self, path: str | None = None, allow_downgrade: bool = False) -> dict[str, Any]:
        package_path = path or self._show_file_dialog(
            "open",
            filetypes=[("Little Tree Plugin", "*.ltp")],
        )
        if not package_path:
            return {
                "state": "cancelled",
                "status": "cancelled",
                "error": None,
                "manifest": None,
                "contributions": {},
                "package_hash": None,
                "source": None,
            }
        return self._sanitize_plugin_result(
            self.plugin_manager.install_package(package_path, allow_downgrade=allow_downgrade)
        )

    def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> dict[str, Any]:
        return self._sanitize_plugin_result(self.plugin_manager.set_enabled(plugin_id, enabled))

    def reload_plugin(self, plugin_id: str) -> dict[str, Any]:
        return self._sanitize_plugin_result(self.plugin_manager.reload(plugin_id))

    def remove_plugin(self, plugin_id: str) -> dict[str, Any]:
        return self._sanitize_plugin_result(self.plugin_manager.remove(plugin_id))

    def invoke_plugin_action(self, plugin_id: str, action: str, payload: Any = None) -> dict[str, Any]:
        return self._sanitize_plugin_result(self.plugin_manager.invoke(plugin_id, action, payload))

    @staticmethod
    def _plugin_contribution_assets(contributions: Any) -> set[str]:
        assets: set[str] = set()

        def visit(value: Any) -> None:
            if isinstance(value, dict):
                if value.get("type") == "image" and isinstance(value.get("src"), str):
                    assets.add(value["src"])
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(contributions)
        return assets

    @staticmethod
    def _resolve_plugin_asset(
        plugin_manager: PluginManager, plugin_id: str, asset_path: str
    ) -> tuple[bytes, str] | None:
        """Resolve a contribution image for an enabled, started plugin."""
        if (
            not isinstance(asset_path, str)
            or not asset_path
            or len(asset_path) > 240
            or "\\" in asset_path
            or "%" in asset_path
            or "\x00" in asset_path
            or ":" in asset_path
        ):
            return None
        parts = asset_path.split("/")
        if any(not part or part in {".", ".."} or part.endswith((" ", ".")) for part in parts):
            return None
        relative = PurePosixPath(asset_path)
        if relative.is_absolute() or relative.as_posix() != asset_path:
            return None
        suffix = Path(asset_path).suffix.lower()
        if suffix not in SAFE_IMAGE_SUFFIXES:
            return None

        listed = plugin_manager.list_plugins().get("plugins", [])
        plugin = next(
            (
                item
                for item in listed
                if isinstance(item, dict)
                and item.get("id") == plugin_id
                and item.get("state") == "enabled"
                and item.get("status") == "started"
                and item.get("error") is None
            ),
            None,
        )
        if plugin is None or asset_path not in BackendAPI._plugin_contribution_assets(plugin.get("contributions")):
            return None

        plugins_dir = Path(plugin_manager.plugins_dir)
        root = plugins_dir / plugin_id
        target = root.joinpath(*relative.parts)
        try:
            if plugins_dir.is_symlink() or root.is_symlink() or not root.is_dir():
                return None
            current = root
            for part in relative.parts:
                current /= part
                if current.is_symlink():
                    return None
            resolved_root = root.resolve(strict=True)
            resolved = target.resolve(strict=True)
            resolved.relative_to(resolved_root)
            if not resolved.is_file():
                return None
            with resolved.open("rb") as file:
                data = file.read()
        except (OSError, RuntimeError, ValueError):
            return None

        header = data[:12]
        signatures = {
            ".gif": (b"GIF87a", b"GIF89a"),
            ".jpeg": (b"\xff\xd8\xff",),
            ".jpg": (b"\xff\xd8\xff",),
            ".png": (b"\x89PNG\r\n\x1a\n",),
            ".webp": (b"RIFF",),
        }
        if not any(header.startswith(signature) for signature in signatures[suffix]):
            return None
        if suffix == ".webp" and header[8:12] != b"WEBP":
            return None
        content_types = {
            ".gif": "image/gif",
            ".jpeg": "image/jpeg",
            ".jpg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }
        return data, content_types[suffix]

    def resolve_plugin_asset(self, plugin_id: str, asset_path: str) -> tuple[bytes, str] | None:
        return self._resolve_plugin_asset(self.plugin_manager, plugin_id, asset_path)

    def _favorites_path(self) -> Path:
        raw = self.store.get("storage.favorites_directory")
        if isinstance(raw, str) and raw.strip():
            return Path(raw.strip()) / "favorites.json"
        return get_data_dir() / "favorites.json"

    def _history_path(self) -> Path:
        return get_data_dir() / "wallpaper_history.json"

    def _generated_images_path(self) -> Path:
        return get_data_dir() / "generated_images.json"

    def _generated_images_dir(self) -> Path:
        return self._downloads_dir() / "generated"

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

    def _protected_storage_paths(self) -> set[Path]:
        protected: set[Path] = set()
        protected.add(self._favorites_path())
        current = get_sys_wallpaper()
        if current:
            protected.add(Path(current))
        try:
            favorites = json.loads(self._favorites_path().read_text(encoding="utf-8"))
            history = json.loads(self._history_path().read_text(encoding="utf-8"))
        except Exception as exc:
            raise RuntimeError("收藏或历史记录无法读取，已停止可能删除文件的操作") from exc
        favorite_items = favorites.get("items") if isinstance(favorites, dict) else None
        if not isinstance(favorite_items, list) or not isinstance(history, list):
            raise RuntimeError("收藏或历史记录格式异常，已停止可能删除文件的操作")
        for item in favorite_items:
            if not isinstance(item, dict) or not isinstance(item.get("local_path"), (str, type(None))):
                raise RuntimeError("收藏记录格式异常，已停止可能删除文件的操作")
            local_path = item.get("local_path")
            if local_path:
                protected.add(Path(str(local_path)))
        for item in history:
            if not isinstance(item, dict) or not isinstance(item.get("path"), (str, type(None))):
                raise RuntimeError("历史记录格式异常，已停止可能删除文件的操作")
            path = item.get("path")
            if path:
                protected.add(Path(str(path)))
        # Generated-image records are protected best-effort: an unreadable
        # registry must never block storage maintenance.
        try:
            generated = json.loads(self._generated_images_path().read_text(encoding="utf-8"))
        except Exception:
            generated = []
        if isinstance(generated, list):
            for item in generated:
                if isinstance(item, dict) and item.get("path"):
                    protected.add(Path(str(item["path"])))
        for key in (
            "wallpaper.auto_change.interval.fixed_image",
            "startup.wallpaper_change.fixed_image",
        ):
            path = self.store.get(key)
            if path:
                protected.add(Path(str(path)))
        with self._pending_wallpaper_lock:
            pending = self._pending_static_wallpaper
            if pending and pending.get("path"):
                protected.add(Path(str(pending["path"])))
        return protected

    def _rebase_download_references(self, copied: list[tuple[Path, Path]]) -> tuple[dict[str, Any], set[Path]]:
        mapping = {os.path.normcase(os.path.abspath(str(source))): str(destination) for source, destination in copied}
        favorites_path = self._favorites_path()
        history_path = self._history_path()
        favorites = json.loads(favorites_path.read_text(encoding="utf-8"))
        history = json.loads(history_path.read_text(encoding="utf-8"))
        if not isinstance(favorites, dict) or not isinstance(favorites.get("items"), list):
            raise RuntimeError("收藏数据格式异常，无法安全迁移下载")
        if not isinstance(history, list):
            raise RuntimeError("历史记录格式异常，无法安全迁移下载")
        original_favorites = json.loads(json.dumps(favorites, ensure_ascii=False))
        original_history = json.loads(json.dumps(history, ensure_ascii=False))
        generated_path = self._generated_images_path()
        try:
            raw_generated = json.loads(generated_path.read_text(encoding="utf-8"))
            generated = raw_generated if isinstance(raw_generated, list) else []
        except Exception:
            generated = []
        original_generated = json.loads(json.dumps(generated, ensure_ascii=False))
        setting_keys = (
            "wallpaper.auto_change.interval.fixed_image",
            "startup.wallpaper_change.fixed_image",
        )
        original_settings = {key: self.store.get(key) for key in setting_keys}
        current_wallpaper = get_sys_wallpaper()

        for item in favorites["items"]:
            if not isinstance(item, dict):
                continue
            local_path = item.get("local_path")
            replacement = mapping.get(os.path.normcase(os.path.abspath(str(local_path)))) if local_path else None
            if replacement:
                item["local_path"] = replacement
        for item in history:
            if not isinstance(item, dict):
                continue
            path = item.get("path")
            replacement = mapping.get(os.path.normcase(os.path.abspath(str(path)))) if path else None
            if replacement:
                item["path"] = replacement
        for item in generated:
            if not isinstance(item, dict):
                continue
            path = item.get("path")
            replacement = mapping.get(os.path.normcase(os.path.abspath(str(path)))) if path else None
            if replacement:
                item["path"] = replacement

        try:
            self._write_json_atomic(favorites_path, favorites)
            self._write_json_atomic(history_path, history)
            self._write_json_atomic(generated_path, generated)
            changed_settings: dict[str, str] = {}
            for key, old_value in original_settings.items():
                replacement = mapping.get(os.path.normcase(os.path.abspath(str(old_value)))) if old_value else None
                if replacement:
                    changed_settings[key] = replacement
            if changed_settings:
                self.store.set_many(changed_settings)
        except Exception:
            self._write_json_atomic(favorites_path, original_favorites)
            self._write_json_atomic(history_path, original_history)
            self._write_json_atomic(generated_path, original_generated)
            self.store.set_many(original_settings)
            raise

        preserve_sources: set[Path] = set()
        if current_wallpaper:
            replacement = mapping.get(os.path.normcase(os.path.abspath(current_wallpaper)))
            if replacement:
                try:
                    set_sys_wallpaper(replacement)
                except Exception:
                    preserve_sources.add(Path(current_wallpaper))
        state = {
            "favorites": original_favorites,
            "history": original_history,
            "generated": original_generated,
            "settings": original_settings,
            "current_wallpaper": current_wallpaper,
        }
        return state, preserve_sources

    def _restore_download_references(self, state: dict[str, Any]) -> None:
        self._write_json_atomic(self._favorites_path(), state["favorites"])
        self._write_json_atomic(self._history_path(), state["history"])
        if "generated" in state:
            self._write_json_atomic(self._generated_images_path(), state["generated"])
        self.store.set_many(state["settings"])
        current_wallpaper = state.get("current_wallpaper")
        if current_wallpaper:
            with contextlib.suppress(Exception):
                set_sys_wallpaper(current_wallpaper)

    def _ensure_favorites(self) -> None:
        path = self._favorites_path()
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            default = {
                "folders": [{"id": "default", "name": "默认收藏夹", "description": "", "order": 0}],
                "items": [],
                "all_tags": [],
                "system_tags": [],
            }
            path.write_text(json.dumps(default, ensure_ascii=False, indent=2), encoding="utf-8")

    SOURCE_FAVORITE_TAGS = {
        "bing": "Bing",
        "builtin.bing_daily": "Bing",
        "builtin.bing_recent": "Bing",
        "spotlight": "Windows聚焦",
        "builtin.windows_spotlight": "Windows聚焦",
        "builtin.windows_spotlight_online": "Windows聚焦",
        "search": "百度图片",
        "builtin.cnu": "CNU",
        "builtin.pexels": "Pexels",
        "builtin.pixivel": "Pixiv",
        "builtin.timeline": "拾光壁纸",
    }

    @classmethod
    def _favorite_source_tag(cls, item: dict[str, Any]) -> str:
        source_type = str(item.get("source_type") or "")
        fixed = cls.SOURCE_FAVORITE_TAGS.get(source_type)
        if fixed:
            return fixed
        return str(item.get("source_name") or "").strip()

    @staticmethod
    def _normalize_favorite_description(value: Any) -> str:
        description = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
        return re.sub(r"<br\s*/?>", "\n", description, flags=re.IGNORECASE)

    def _migrate_favorite_tags(self, data: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Backfill source tags and rebuild the global tag collection."""
        changed = "all_tags" not in data or "system_tags" not in data
        tags: set[str] = set(data.get("all_tags", []))
        previous_system_tags = set(data.get("system_tags", []))
        actual_system_tags: set[str] = set()
        for item in data.get("items", []):
            description = str(item.get("description") or "")
            normalized_description = self._normalize_favorite_description(description)
            if normalized_description != description:
                item["description"] = normalized_description
                changed = True
            item_tags = list(item.get("tags", []))
            source_tag = self._favorite_source_tag(item)
            if source_tag and source_tag not in item_tags:
                item_tags.append(source_tag)
                item["tags"] = item_tags
                changed = True
            if source_tag:
                actual_system_tags.add(source_tag)
            for tag in item_tags:
                tags.add(tag)
        unused_system_tags = (previous_system_tags | set(self.SOURCE_FAVORITE_TAGS.values())) - actual_system_tags
        tags.difference_update(unused_system_tags)
        tags.update(actual_system_tags)
        sorted_tags = sorted(tags)
        if data.get("all_tags") != sorted_tags:
            data["all_tags"] = sorted_tags
            changed = True
        sorted_system_tags = sorted(actual_system_tags)
        if data.get("system_tags") != sorted_system_tags:
            data["system_tags"] = sorted_system_tags
            changed = True
        return data, changed

    def _ensure_history(self) -> None:
        path = self._history_path()
        if not path.exists():
            path.write_text("[]", encoding="utf-8")

    @_favorites_transaction
    def _load_favorites(self, strict: bool = True) -> dict[str, Any]:
        try:
            with self._favorites_lock:
                data = json.loads(self._favorites_path().read_text(encoding="utf-8"))
            # Migrate old default folder name from "全部" to "默认收藏夹"
            for folder in data.get("folders", []):
                if folder.get("id") == "default" and folder.get("name") == "全部":
                    folder["name"] = "默认收藏夹"
                    self._save_favorites(data)
                    break
            data, tags_changed = self._migrate_favorite_tags(data)
            normalized, urls_changed = self._normalize_favorite_urls(data)
            if tags_changed or urls_changed:
                self._save_favorites(normalized)
            return self._hydrate_favorite_urls(normalized)
        except Exception as exc:
            if strict:
                raise RuntimeError("收藏数据暂时无法读取，请检查收藏存储位置") from exc
            return {"folders": [], "items": [], "all_tags": [], "system_tags": []}

    def _save_favorites(self, data: dict[str, Any]) -> None:
        with self._favorites_lock:
            self._write_json_atomic(self._favorites_path(), data)

    @staticmethod
    def _write_json_atomic(path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + f".{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("w", encoding="utf-8") as file:
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
        finally:
            with contextlib.suppress(OSError):
                temporary.unlink()

    @staticmethod
    def _write_json_exclusive(path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as file:
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())
        except Exception:
            with contextlib.suppress(OSError):
                path.unlink()
            raise

    @staticmethod
    def _unwrap_session_url(url: str) -> str:
        """Return the stable resource represented by a session-bound API URL."""
        if not url:
            return url
        parsed = urlparse(url)
        if parsed.path in ("/api/cnu-image", "/api/pixiv-image", "/api/sniff-image"):
            values = parse_qs(parsed.query).get("url")
            return values[0] if values else url
        if parsed.path == "/api/preview":
            values = parse_qs(parsed.query).get("path")
            return values[0] if values else url
        return url

    def _normalize_favorite_urls(self, data: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Strip old ports/tokens before favorites are persisted."""
        changed = False
        for item in data.get("items", []):
            for field in ("preview_url", "source_url"):
                value = str(item.get(field) or "")
                normalized = self._unwrap_session_url(value)
                if normalized != value:
                    item[field] = normalized
                    changed = True
        return data, changed

    def _hydrate_favorite_urls(self, data: dict[str, Any]) -> dict[str, Any]:
        """Build current-session URLs in a response copy, leaving disk data stable."""
        hydrated = {**data, "items": []}
        for item in data.get("items", []):
            current = dict(item)
            for field in ("preview_url", "source_url"):
                value = str(current.get(field) or "")
                if self._is_cnu_cdn_url(value):
                    current[field] = self._build_cnu_proxy_url(value)
                elif self._is_pixivel_cdn_url(value):
                    current[field] = self._build_pixivel_proxy_url(value)
                elif current.get("source_type") == "sniff" and value:
                    page_url = str(current.get("source_page_url") or "")
                    current[field] = self._build_sniff_proxy_url(value, page_url)
                elif current.get("source_type") == "builtin.timeline" and value:
                    current[field] = self._build_sniff_proxy_url(value)
                elif value and Path(value).is_absolute():
                    current[field] = self._build_preview_url(value) or value
            hydrated["items"].append(current)
        return hydrated

    def _load_history(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self._history_path().read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save_history(self, data: list[dict[str, Any]]) -> None:
        self._write_json_atomic(self._history_path(), data)

    def _download_file_sync(
        self, url: str, save_dir: Path, filename: str | None = None, headers: dict[str, str] | None = None
    ) -> str | None:
        """Stream ``url`` into ``save_dir`` with full integrity checks.

        Accepts HTTP URLs, local absolute file paths, and session-scoped
        ``/api/preview`` URLs. Local files are copied directly when they reside
        in a safe root.

        Returns the saved path, or ``None`` on failure. The write is staged in
        a ``*.Part`` sibling and atomically renamed into place; remote downloads
        compare size against the advertised ``Content-Length`` and verify the
        bytes decode as an image.
        """
        import requests

        unwrapped = self._unwrap_session_url(url)

        # Direct local path (or path unwrapped from /api/preview): copy if safe.
        try:
            candidate = Path(unwrapped)
            if candidate.is_absolute() and candidate.is_file() and self.is_path_safe(str(candidate)):
                save_dir.mkdir(parents=True, exist_ok=True)
                name = filename or candidate.name or "download.jpg"
                dest = save_dir / _shared_sanitize_filename(name)
                with self.storage_service.download_operation():
                    shutil.copy2(candidate, dest)
                    return str(self.storage_service.optimize_new_download(dest))
        except Exception:
            pass

        # Fallback: extract the path from an /api/preview URL.
        try:
            preview_path = self._extract_preview_path(url)
            if preview_path is not None:
                path = Path(preview_path)
                if path.is_file() and self.is_path_safe(str(path)):
                    save_dir.mkdir(parents=True, exist_ok=True)
                    name = filename or path.name or "download.jpg"
                    dest = save_dir / _shared_sanitize_filename(name)
                    with self.storage_service.download_operation():
                        shutil.copy2(path, dest)
                        return str(self.storage_service.optimize_new_download(dest))
        except Exception:
            pass

        # Remote download path.
        try:
            url = unwrapped

            h = dict(headers or {})
            h.setdefault("User-Agent", self.store.get("sniff.user_agent", "Mozilla/5.0"))
            parsed_url = urlparse(url)
            host = (parsed_url.hostname or "").lower()
            pixiv_hosts = {"i.pximg.net", "i.pximg.org", "pximg.cocomi.eu.org", "i.yuki.sh"}
            if host in {"i.pximg.net", "pximg.cocomi.eu.org"}:
                url = parsed_url._replace(scheme="https", netloc="i.yuki.sh").geturl()
                host = "i.yuki.sh"
            if host in {"i.pximg.net", "i.pximg.org"}:
                h.setdefault("Referer", "https://www.pixiv.net/")
                h.setdefault("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            elif host in {"pximg.cocomi.eu.org", "i.yuki.sh"}:
                h.setdefault("Referer", "https://pxelk.cocomi.eu.org/")
                h.setdefault("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            resp = requests.get(
                url,
                headers=h,
                timeout=(10, 120),
                stream=True,
                allow_redirects=host not in pixiv_hosts,
            )
            if resp.is_redirect or resp.is_permanent_redirect:
                raise DownloadError("Pixiv 图片地址发生了不安全的重定向", code="unsafe_redirect")
            resp.raise_for_status()

            content_type = resp.headers.get("Content-Type", "")
            if content_type and not content_type.split(";", 1)[0].strip().lower().startswith("image/"):
                raise DownloadError(
                    f"服务器返回非图片内容 (Content-Type: {content_type})",
                    code="bad_content_type",
                )

            save_dir.mkdir(parents=True, exist_ok=True)
            if not filename:
                filename = self._filename_from_response(resp, url) or "download.jpg"
            dest = save_dir / _shared_sanitize_filename(filename)

            try:
                total_header = resp.headers.get("Content-Length")
                expected_size = int(total_header) if (total_header and total_header.isdigit()) else None
                with self.storage_service.download_operation(), resp.raw as source:
                    result: WriteResult = stream_to_file_atomic(
                        dest,
                        source,
                        expected_size=expected_size,
                        content_type=content_type,
                    )
                    optimized_path = self.storage_service.optimize_new_download(result.path)
            finally:
                resp.close()

            logger.info("Downloaded {} ({} bytes) -> {}", url, result.size, result.path)
            return str(optimized_path)
        except DownloadError as e:
            logger.warning("Download rejected: {} ({})", e, e.code)
            return None
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
        return paths[0]

    @staticmethod
    def _filename_from_response(resp: Any, url: str) -> str | None:
        """Recover a filename from Content-Disposition or the URL path.

        Supports the legacy ``filename="..."`` form and the RFC 5987
        ``filename*=UTF-8''...`` form so that non-ASCII names round-trip
        correctly. Returns ``None`` if neither yields a usable value.
        """
        cd = resp.headers.get("Content-Disposition", "")
        if cd:
            star = re.search(r"filename\*\s*=\s*([^']+)''([^;]+)", cd, re.IGNORECASE)
            if star:
                try:
                    from urllib.parse import unquote

                    return unquote(star.group(2))
                except Exception:
                    pass
            quoted = re.search(r'filename\s*=\s*"([^"]+)"', cd, re.IGNORECASE)
            if quoted:
                return quoted.group(1)
            bare = re.search(r"filename\s*=\s*([^;]+)", cd, re.IGNORECASE)
            if bare:
                return bare.group(1).strip().strip('"')
        path = url.split("?", 1)[0].rsplit("/", 1)[-1]
        return path or None

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
        # Windows Spotlight assets live in a system directory; allowing them
        # lets the local Spotlight proxy serve and copy those files.
        if os.name == "nt":
            spotlight_path = (
                Path.home()
                / "AppData/Local/Packages/Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy/LocalState/Assets"
            )
            with contextlib.suppress(Exception):
                roots.add(spotlight_path.resolve())
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

    def _build_cnu_proxy_url(self, url: str) -> str:
        """Wrap a CNU CDN image URL with the local same-origin proxy endpoint."""
        if not url:
            return url
        token = self._api_token or ""
        query = f"url={quote(url, safe='')}"
        if token:
            query += f"&token={token}"
        return f"/api/cnu-image?{query}"

    def _build_sniff_proxy_url(self, url: str, referer: str = "") -> str:
        """Wrap a sniffed remote image with the local Referer-aware proxy."""
        if not url:
            return url
        token = self._api_token or ""
        query = f"url={quote(url, safe='')}"
        if referer:
            query += f"&referer={quote(referer, safe='')}"
        if token:
            query += f"&token={token}"
        return f"/api/sniff-image?{query}"

    @staticmethod
    def _is_cnu_cdn_url(url: str) -> bool:
        return url.startswith(
            (
                "http://imgoss.cnu.cc",
                "https://imgoss.cnu.cc",
                "http://img.cnu.cc",
                "https://img.cnu.cc",
            )
        )

    def _proxy_cnu_items(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Rewrite CNU CDN image URLs to same-origin proxy URLs.

        Returns new dicts so cached originals remain untouched (prevents
        double-wrapping on cache hits).
        """
        result: list[dict[str, Any]] = []
        for item in items:
            new_item = dict(item)
            metadata = dict(new_item.get("metadata") or {})
            for field in ("image_url", "preview_url"):
                original = str(new_item.get(field) or "")
                if original and self._is_cnu_cdn_url(original):
                    metadata[f"original_{field}"] = original
                    new_item[field] = self._build_cnu_proxy_url(original)
            if metadata:
                new_item["metadata"] = metadata
            result.append(new_item)
        return result

    def _build_pixivel_proxy_url(self, url: str) -> str:
        """Wrap a Pixiv CDN image URL with the local same-origin proxy endpoint."""
        if not url:
            return url
        token = self._api_token or ""
        query = f"url={quote(url, safe='')}"
        if token:
            query += f"&token={token}"
        return f"/api/pixiv-image?{query}"

    @staticmethod
    def _is_pixivel_cdn_url(url: str) -> bool:
        parsed = urlparse(url)
        return parsed.scheme.lower() in {"http", "https"} and (parsed.hostname or "").lower() in {
            "i.pximg.net",
            "i.pximg.org",
            "pximg.cocomi.eu.org",
            "i.yuki.sh",
        }

    def _proxy_pixivel_items(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Rewrite Pixiv CDN image URLs to same-origin proxy URLs."""
        result: list[dict[str, Any]] = []
        for item in items:
            new_item = dict(item)
            metadata = dict(new_item.get("metadata") or {})
            for field in ("image_url", "preview_url"):
                original = str(new_item.get(field) or "")
                if original and self._is_pixivel_cdn_url(original):
                    metadata[f"original_{field}"] = original
                    new_item[field] = self._build_pixivel_proxy_url(original)
            if metadata:
                new_item["metadata"] = metadata
            result.append(new_item)
        return result

    def _proxy_timeline_items(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Wrap Timeline image URLs with the authenticated remote image proxy."""
        result: list[dict[str, Any]] = []
        for item in items:
            new_item = dict(item)
            metadata = dict(new_item.get("metadata") or {})
            for field in ("image_url", "preview_url"):
                original = str(new_item.get(field) or "")
                if original:
                    metadata[f"original_{field}"] = original
                    new_item[field] = self._build_sniff_proxy_url(original)
            new_item["metadata"] = metadata
            result.append(new_item)
        return result

    def _proxy_timeline_topics(self, topics: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # Topic covers are display-only. Timeline's own frontend loads them with
        # referrerPolicy=no-referrer, so keep them direct instead of occupying
        # the bounded image proxy pool with the full topic catalogue.
        return [dict(topic) for topic in topics]

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

    @_storage_references_transaction
    def set_wallpaper(self, path: str, confirm_stop_dynamic_wallpaper: bool = False) -> dict[str, Any]:
        try:
            real_path = self._unwrap_session_url(path)
            if self.dynamic_wallpaper_service.requires_static_wallpaper_confirmation():
                if not confirm_stop_dynamic_wallpaper:
                    return {
                        "success": False,
                        "requires_confirmation": True,
                        "code": "dynamic_wallpaper_running",
                        "error": "动态壁纸正在运行，设置静态壁纸将停止动态壁纸",
                    }
                if not self.dynamic_wallpaper_service.wait_until_idle():
                    raise TimeoutError("动态壁纸操作尚未完成，请稍后重试")
                self.dynamic_wallpaper_service.stop()
            set_sys_wallpaper(real_path)
            self.add_to_history(real_path, Path(real_path).name, "set")
            logger.info("Wallpaper set to {}", real_path)
            return {"success": True}
        except Exception as e:
            logger.error("Failed to set wallpaper {}: {}", path, e)
            return {"success": False, "error": str(e)}

    def _request_background_wallpaper(self, path: str) -> dict[str, Any]:
        """Apply immediately or queue a latest-wins confirmation for the UI."""
        real_path = self._unwrap_session_url(path)
        if not self.dynamic_wallpaper_service.requires_static_wallpaper_confirmation():
            return self.set_wallpaper(real_path)

        task = {
            "id": uuid.uuid4().hex,
            "path": real_path,
            "name": Path(real_path).name,
            "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
        with self._pending_wallpaper_lock:
            self._pending_static_wallpaper = task

        notify = self._desktop_notify
        if notify is not None:
            with contextlib.suppress(Exception):
                notify(
                    "静态壁纸等待确认",
                    "动态壁纸正在运行。点击通知打开小树壁纸并确认是否停止动态壁纸。",
                )
        logger.info("Queued background static wallpaper confirmation for {}", real_path)
        return {"success": True, "queued": True, "requires_confirmation": True, "task_id": task["id"]}

    def get_pending_static_wallpaper(self) -> dict[str, Any] | None:
        with self._pending_wallpaper_lock:
            return dict(self._pending_static_wallpaper) if self._pending_static_wallpaper else None

    def resolve_pending_static_wallpaper(self, task_id: str, confirmed: bool) -> dict[str, Any]:
        with self._pending_wallpaper_lock:
            task = self._pending_static_wallpaper
            if task is None or task.get("id") != task_id:
                return {"success": False, "code": "pending_task_not_found", "error": "待确认壁纸请求已失效"}
            self._pending_static_wallpaper = None
        if not confirmed:
            return {"success": True, "cancelled": True}
        result = self.set_wallpaper(str(task["path"]), True)
        if not result.get("success"):
            with self._pending_wallpaper_lock:
                if self._pending_static_wallpaper is None:
                    self._pending_static_wallpaper = task
        return result

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
                for item in (self._proxy_local_spotlight_item(i) for i in items)
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

    def get_clipboard_text(self) -> str:
        try:
            import pyperclip

            return pyperclip.paste()
        except Exception as e:
            logger.error(f"Clipboard read error: {e}")
            return ""

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

        output = io.BytesIO()
        image.convert("RGB").save(output, "BMP")
        # Strip the BITMAPFILEHEADER so the remaining bytes are CF_DIB.
        dib_data = output.getvalue()[14:]
        output.close()

        cf_dib = 8
        gmem_moveable = 0x0002

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        if not user32.OpenClipboard(0):
            err = ctypes.get_last_error()
            logger.error("OpenClipboard failed: error={}", err)
            return False
        try:
            user32.EmptyClipboard()
            h_mem = kernel32.GlobalAlloc(gmem_moveable, len(dib_data))
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
            if not user32.SetClipboardData(cf_dib, h_mem):
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
        return _shared_sanitize_filename(name)

    def _pick_save_path(self, suggested_name: str) -> str | None:
        """Open a native Save dialog and return the chosen path (or None)."""
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        try:
            is_project = suggested_name.lower().endswith(".ltwp")
            path = filedialog.asksaveasfilename(
                defaultextension=".ltwp" if is_project else ".jpg",
                initialfile=suggested_name,
                filetypes=(
                    [("小树壁纸项目", "*.ltwp"), ("所有文件", "*.*")]
                    if is_project
                    else [("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.gif"), ("All files", "*.*")]
                ),
            )
            return path or None
        finally:
            root.destroy()

    def save_blob_to_downloads(self, data: bytes, filename: str) -> str | None:
        """Persist raw ``data`` bytes into the downloads directory atomically.

        Returns the final path on success, ``None`` on failure. The write is
        staged in a ``*.part`` sibling and renamed into place so that an
        interrupted upload never leaves a half-written ``.jpg``.
        """
        try:
            save_dir = self._downloads_dir()
            save_dir.mkdir(parents=True, exist_ok=True)
            filepath = save_dir / self._sanitize_filename(filename)
            with self.storage_service.download_operation():
                result = write_blob_atomic(filepath, data)
                logger.info("Saved download to {} ({} bytes)", result.path, result.size)
                return str(self.storage_service.optimize_new_download(result.path))
        except Exception as e:
            logger.error(f"Save blob to downloads error: {e}")
            return None

    def save_blob_as(self, data: bytes, filename: str) -> str | None:
        """Prompt for a save location and persist raw ``data`` bytes there.

        Returns the chosen path, or ``None`` if the user cancels.
        """
        try:
            chosen = self._pick_save_path(self._sanitize_filename(filename))
            if not chosen:
                return None
            dest = Path(chosen)
            write_blob_atomic(dest, data)
            logger.info("Saved file as {} ({} bytes)", dest, dest.stat().st_size)
            return str(dest)
        except Exception as e:
            logger.error(f"Save blob as error: {e}")
            return None

    def save_blob_to_path(self, data: bytes, filepath: str) -> str | None:
        """Atomically overwrite a file previously selected by the user."""
        try:
            dest = Path(filepath).expanduser()
            if not dest.is_absolute():
                logger.warning("Rejected non-absolute save path: {}", filepath)
                return None
            write_blob_atomic(dest, data)
            logger.info("Saved file to {} ({} bytes)", dest, dest.stat().st_size)
            return str(dest)
        except Exception as e:
            logger.error(f"Save blob to path error: {e}")
            return None

    def sniff_images(self, url: str) -> list[dict[str, Any]]:
        try:
            ua = self.store.get("sniff.user_agent", "Mozilla/5.0")
            timeout = int(self.store.get("sniff.timeout_seconds", 15))
            configured_referer = str(self.store.get("sniff.referer", "") or "").strip()
            use_source_as_referer = bool(self.store.get("sniff.use_source_as_referer", True))
            items = self.sniff_service.sniff_images(
                url,
                user_agent=ua,
                timeout_seconds=timeout,
                referer=configured_referer,
                use_source_as_referer=use_source_as_referer,
            )
            max_results = max(20, min(2000, int(self.store.get("sniff.max_results", 300))))

            result: list[dict[str, Any]] = []
            for item in items[:max_results]:
                source_url = str(item.get("image_url") or "")
                metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
                page_url = str(metadata.get("page_url") or url)
                referer = str(metadata.get("referer") or "")
                proxy_url = self._build_sniff_proxy_url(source_url, referer)
                result.append(
                    {
                        "id": item.get("id", uuid.uuid4().hex),
                        "url": proxy_url,
                        "preview_url": proxy_url,
                        "source_url": source_url,
                        "source_page_url": page_url,
                        "referer": referer,
                        "filename": Path(urlparse(source_url).path).name or "image.jpg",
                        "content_type": "",
                    }
                )
            return result
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

    def search_pexels_images(self, text: str, page: int = 1, size: int = 24) -> list[dict[str, Any]]:
        """Search Pexels' web catalogue and return original/preview URL pairs."""
        user_agent = str(self.store.get("sniff.user_agent", "Mozilla/5.0"))
        try:
            items = self.pexels_service.search(text, page, size, user_agent)
            # images.pexels.com permits anonymous CORS reads, so direct CDN URLs
            # avoid saturating the bounded generic proxy while a gallery loads.
            return [dict(item) for item in items]
        except Exception as exc:
            logger.error("Pexels image search error: {}", exc)
            raise RuntimeError(str(exc)) from exc

    def search_pixiv_images(
        self,
        text: str,
        source: int = 1,
        exclude_ai: bool = False,
        r18: int = 0,
        size: int = 15,
        page: int = 1,
    ) -> list[dict[str, Any]]:
        """Search Pixiv through a configured public API adapter."""
        import requests

        if source not in (1, 2):
            raise ValueError("未知的 Pixiv 搜索 API")
        if not text.strip():
            return []
        configured_r18 = 2 if self.store.get("wallpaper.allow_NSFW", False) else 0
        count = max(1, min(int(size), 15))
        try:
            if source == 2:
                response = requests.get(
                    "https://hibiapi.cocomi.eu.org/api/pixiv/search",
                    params={"word": text.strip(), "page": max(1, int(page))},
                    headers={
                        "User-Agent": self.store.get("sniff.user_agent", "Mozilla/5.0"),
                        "Accept": "application/json, text/plain, */*",
                        "Referer": "https://pixiviz.cocomi.eu.org/",
                    },
                    timeout=30,
                )
                response.raise_for_status()
                payload = response.json()
                results: list[dict[str, Any]] = []
                for raw in payload.get("illusts", [])[:count]:
                    if not isinstance(raw, dict):
                        continue
                    pixiv_id = str(raw.get("id") or "")
                    if not pixiv_id:
                        continue
                    raw_meta_pages = raw.get("meta_pages") or []
                    raw_original = str(
                        (raw_meta_pages[0].get("image_urls") or {}).get("original")
                        if isinstance(raw_meta_pages, list) and raw_meta_pages and isinstance(raw_meta_pages[0], dict)
                        else (raw.get("meta_single_page") or {}).get("original_image_url") or ""
                    )
                    raw_tags = raw.get("tags") or []
                    detail = raw
                    if not raw_original or not raw_tags:
                        try:
                            detail = self.pixivel_service._fetch_illust(pixiv_id)
                        except Exception as detail_exc:
                            logger.warning("Pixiviz detail fallback for {}: {}", pixiv_id, detail_exc)
                    if not configured_r18 and int(detail.get("x_restrict") or 0) > 0:
                        continue
                    if exclude_ai and int(detail.get("illust_ai_type") or 0) > 1:
                        continue

                    title = str(detail.get("title") or raw.get("title") or f"Pixiv {pixiv_id}").strip()
                    user = detail.get("user") if isinstance(detail.get("user"), dict) else {}
                    tags = PixivelService._format_tags(detail.get("tags") or [])
                    meta_pages = detail.get("meta_pages") or []
                    if isinstance(meta_pages, list) and meta_pages:
                        image_url = str((meta_pages[0].get("image_urls") or {}).get("original") or "")
                    else:
                        image_url = str(
                            (detail.get("meta_single_page") or {}).get("original_image_url")
                            or (detail.get("image_urls") or {}).get("large")
                            or (detail.get("image_urls") or {}).get("medium")
                            or ""
                        )
                    if not image_url:
                        continue
                    extension = Path(urlparse(image_url).path).suffix.lstrip(".").lower() or "jpg"
                    results.append(
                        {
                            "id": f"pixiviz-search:{pixiv_id}:0",
                            "url": self._build_pixivel_proxy_url(image_url),
                            "filename": f"{title}.{extension}",
                            "content_type": f"image/{'jpeg' if extension in ('jpg', 'jpeg') else extension}",
                            "title": title,
                            "author": str(user.get("name") or ""),
                            "author_id": str(user.get("id") or ""),
                            "pixiv_id": pixiv_id,
                            "width": detail.get("width"),
                            "height": detail.get("height"),
                            "tags": tags,
                            "source_url": image_url,
                        }
                    )
                return results

            response = requests.get(
                "https://api.lolicon.app/setu/v2",
                params={
                    "tag": text.strip(),
                    "num": count,
                    "excludeAI": str(bool(exclude_ai)).lower(),
                    "r18": configured_r18,
                    "proxy": "pximg.cocomi.eu.org",
                },
                headers={"User-Agent": self.store.get("sniff.user_agent", "Mozilla/5.0")},
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("error"):
                raise RuntimeError(str(payload["error"]))

            results: list[dict[str, Any]] = []
            for raw in payload.get("data", []):
                image_url = str((raw.get("urls") or {}).get("original") or "")
                if not image_url:
                    continue
                proxied = self._build_pixivel_proxy_url(image_url)
                extension = str(raw.get("ext") or "jpg").strip().lower()
                title = str(raw.get("title") or f"Pixiv {raw.get('pid') or ''}").strip()
                results.append(
                    {
                        "id": f"pixiv-search:{raw.get('pid')}:{raw.get('p', 0)}",
                        "url": proxied,
                        "filename": f"{title}.{extension}",
                        "content_type": f"image/{'jpeg' if extension in ('jpg', 'jpeg') else extension}",
                        "title": title,
                        "author": str(raw.get("author") or ""),
                        "author_id": str(raw.get("uid") or ""),
                        "pixiv_id": str(raw.get("pid") or ""),
                        "width": raw.get("width"),
                        "height": raw.get("height"),
                        "tags": [str(tag) for tag in raw.get("tags", [])],
                        "source_url": image_url,
                    }
                )
            return results
        except Exception as exc:
            logger.error("Pixiv image search error: {}", exc)
            raise RuntimeError(f"Pixiv 搜索失败: {exc}") from exc

    def get_favorites(self) -> dict[str, Any]:
        return self._load_favorites()

    @_favorites_transaction
    def add_favorite(self, item: dict[str, Any]) -> dict[str, Any]:
        data = self._load_favorites()
        data, _ = self._normalize_favorite_urls(data)
        stable_item = dict(item)
        stable_item["description"] = self._normalize_favorite_description(stable_item.get("description"))
        for field in ("preview_url", "source_url"):
            stable_item[field] = self._unwrap_session_url(str(stable_item.get(field) or ""))
        stable_tags = list(stable_item.get("tags", []))
        source_tag = self._favorite_source_tag(stable_item)
        if source_tag == "Pixiv" and not self.store.get("wallpaper.pixiv.include_artwork_tags_in_favorites", True):
            stable_tags = ["Pixiv"]
        elif source_tag and source_tag not in stable_tags:
            stable_tags.append(source_tag)
        stable_item["tags"] = stable_tags
        new_item = {
            **stable_item,
            "id": uuid.uuid4().hex,
            "created_at": datetime.now().isoformat(),
        }
        data["items"].append(new_item)
        # 自动将新标签加入 all_tags
        all_tags = set(data.get("all_tags", []))
        for tag in new_item.get("tags", []):
            all_tags.add(tag)
        data["all_tags"] = sorted(all_tags)
        system_tags = set(data.get("system_tags", []))
        if source_tag:
            system_tags.add(source_tag)
        data["system_tags"] = sorted(system_tags)
        self._save_favorites(data)
        return self._hydrate_favorite_urls({"items": [new_item]})["items"][0]

    @_favorites_transaction
    def ensure_tag(self, name: str) -> None:
        data = self._load_favorites()
        all_tags = set(data.get("all_tags", []))
        all_tags.add(name)
        data["all_tags"] = sorted(all_tags)
        self._save_favorites(data)

    @_favorites_transaction
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

    @_favorites_transaction
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

    @_favorites_transaction
    def update_favorite(self, item: dict[str, Any]) -> None:
        data = self._load_favorites()
        data, _ = self._normalize_favorite_urls(data)
        stable_item = dict(item)
        stable_item["description"] = self._normalize_favorite_description(stable_item.get("description"))
        for field in ("preview_url", "source_url"):
            stable_item[field] = self._unwrap_session_url(str(stable_item.get(field) or ""))
        stable_tags = list(stable_item.get("tags", []))
        source_tag = self._favorite_source_tag(stable_item)
        if source_tag == "Pixiv" and not self.store.get("wallpaper.pixiv.include_artwork_tags_in_favorites", True):
            stable_tags = ["Pixiv"]
        elif source_tag and source_tag not in stable_tags:
            stable_tags.append(source_tag)
        stable_item["tags"] = stable_tags
        for i, it in enumerate(data["items"]):
            if it["id"] == item["id"]:
                data["items"][i] = stable_item
                break
        self._save_favorites(data)

    @_favorites_transaction
    def remove_favorite(self, id: str) -> None:
        data = self._load_favorites()
        data["items"] = [it for it in data["items"] if it["id"] != id]
        self._save_favorites(data)

    @_favorites_transaction
    def create_favorite_folder(self, name: str, description: str | None = "") -> dict[str, Any]:
        data = self._load_favorites()
        normalized_name = name.strip()
        normalized_description = (description or "").strip()
        if not normalized_name:
            raise ValueError("收藏夹名称不能为空")
        if any(str(folder.get("name", "")).strip() == normalized_name for folder in data.get("folders", [])):
            raise ValueError("已存在同名收藏夹")
        folder = {
            "id": uuid.uuid4().hex,
            "name": normalized_name,
            "description": normalized_description,
            "order": len(data["folders"]),
        }
        data["folders"].append(folder)
        self._save_favorites(data)
        return folder

    @_favorites_transaction
    def update_favorite_folder(self, folder_id: str, name: str, description: str | None = "") -> dict[str, Any]:
        data = self._load_favorites()
        normalized_name = name.strip()
        normalized_description = (description or "").strip()
        if not normalized_name:
            raise ValueError("收藏夹名称不能为空")

        target_index = -1
        for index, folder in enumerate(data.get("folders", [])):
            if folder.get("id") == folder_id:
                target_index = index
                break

        if target_index < 0:
            raise ValueError("收藏夹不存在")

        for folder in data.get("folders", []):
            if folder.get("id") != folder_id and str(folder.get("name", "")).strip() == normalized_name:
                raise ValueError("已存在同名收藏夹")

        updated_folder = {
            **data["folders"][target_index],
            "name": normalized_name,
            "description": normalized_description,
        }
        data["folders"][target_index] = updated_folder
        self._save_favorites(data)
        return updated_folder

    @_favorites_transaction
    def delete_favorite_folder(self, folder_id: str) -> None:
        if folder_id == "default":
            raise ValueError("默认收藏夹不能删除")

        data = self._load_favorites()
        folders = data.get("folders", [])
        target_folder = next((folder for folder in folders if folder.get("id") == folder_id), None)
        if target_folder is None:
            raise ValueError("收藏夹不存在")

        data["folders"] = [folder for folder in folders if folder.get("id") != folder_id]
        for index, folder in enumerate(data["folders"]):
            folder["order"] = index

        for item in data.get("items", []):
            if item.get("folder_id") == folder_id:
                item["folder_id"] = "default"

        self._save_favorites(data)

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

    def list_themes(self) -> list[dict[str, Any]]:
        return self.theme_service.list_themes()

    def get_theme(self, theme_id: str) -> dict[str, Any]:
        return self.theme_service.get_theme(theme_id)

    def list_system_fonts(self) -> list[str]:
        return self.theme_service.list_system_fonts()

    def get_active_theme(self) -> dict[str, Any]:
        mode = str(self.store.get("ui.theme", "system"))
        if mode not in {"system", "light", "dark"}:
            mode = "system"
        theme_id = str(self.store.get("ui.theme_profile", DEFAULT_THEME_ID))
        try:
            theme = self.theme_service.get_theme(theme_id)
        except ValueError:
            theme_id = DEFAULT_THEME_ID
            theme = self.theme_service.get_theme(theme_id)
            self.store.set("ui.theme_profile", theme_id)
        return {"mode": mode, "theme": theme}

    def save_theme(self, theme: dict[str, Any]) -> dict[str, Any]:
        return self.theme_service.save_theme(theme)

    def activate_theme(self, theme_id: str) -> dict[str, Any]:
        theme = self.theme_service.get_theme(theme_id)
        self.store.set("ui.theme_profile", theme["id"])
        return theme

    def duplicate_theme(self, theme_id: str, name: str | None = None) -> dict[str, Any]:
        return self.theme_service.duplicate_theme(theme_id, name)

    def delete_theme(self, theme_id: str) -> None:
        self.theme_service.delete_theme(theme_id)
        if self.store.get("ui.theme_profile", DEFAULT_THEME_ID) == theme_id:
            self.store.set("ui.theme_profile", DEFAULT_THEME_ID)

    def pick_theme_asset(self, theme_id: str, role: str, mode: str) -> dict[str, Any] | None:
        filters = {
            "image": ("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.gif *.avif"),
            "video": ("Videos", "*.mp4 *.webm *.mov *.m4v"),
            "font": ("Fonts", "*.woff2 *.woff *.ttf *.otf"),
        }
        normalized_role = str(role).strip().lower()
        if normalized_role not in filters:
            raise ValueError("资源类型无效")
        path = self._show_file_dialog("open", filetypes=[filters[normalized_role]])
        if not path:
            return None
        return self.theme_service.pick_asset(theme_id, normalized_role, mode, Path(path))

    def pick_and_import_theme(self) -> dict[str, Any] | None:
        path = self._show_file_dialog(
            "open",
            filetypes=[("Little Tree Theme", "*.lttheme"), ("Theme JSON", "*.json")],
        )
        if not path:
            return None
        return self.theme_service.import_theme(Path(path))

    def export_theme(self, theme_id: str) -> str | None:
        theme = self.theme_service.get_theme(theme_id)
        safe_name = re.sub(r'[\\/:*?"<>|]+', "-", theme["name"]).strip().strip(".") or "theme"
        path = self._show_file_dialog(
            "save",
            filetypes=[("Little Tree Theme", "*.lttheme")],
            defaultextension=".lttheme",
            initialfile=f"{safe_name}.lttheme",
        )
        if not path:
            return None
        return str(self.theme_service.export_theme(theme_id, Path(path)))

    @_storage_references_transaction
    def set_settings(self, settings: dict[str, Any]) -> None:
        current_storage = self.store.get("storage", {})
        incoming_storage = settings.get("storage", {})
        for key in ("download_directory", "favorites_directory"):
            if incoming_storage.get(key, "") != current_storage.get(key, ""):
                raise ValueError("存储位置必须通过专用迁移接口修改")
        self.store.replace(settings)

    def get_setting(self, key: str) -> Any:
        return self.store.get(key)

    @_storage_references_transaction
    def set_setting(self, key: str, value: Any) -> None:
        if key == "storage" or key in {"storage.download_directory", "storage.favorites_directory"}:
            raise ValueError("存储位置必须通过专用迁移接口修改")
        self.store.set(key, value)

    def get_history(self, max_preview_items: int | None = None) -> list[dict[str, Any]]:
        stored_history = self._load_history()
        configured_max = max(10, min(2000, int(self.store.get("wallpaper.history.max_items", 200))))
        history = stored_history[:configured_max]
        preview_limit = max_preview_items
        if preview_limit is None:
            preview_limit = int(self.store.get("wallpaper.history.preview_items", 20))
        preview_limit = max(0, min(configured_max, int(preview_limit)))
        for i, item in enumerate(history):
            # Preview URLs are built live (token-scoped) and never persisted, so
            # old base64 entries are replaced with fresh HTTP URLs each call.
            if i < preview_limit:
                item["preview_url"] = self._build_preview_url(item.get("path", ""), max_size=320)
            else:
                item.pop("preview_url", None)
        return history

    @_storage_references_transaction
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
        max_items = max(10, min(2000, int(self.store.get("wallpaper.history.max_items", 200))))
        history = history[:max_items]
        self._save_history(history)

    def _load_generated_images(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self._generated_images_path().read_text(encoding="utf-8"))
        except Exception:
            return []
        return data if isinstance(data, list) else []

    def _save_generated_images(self, data: list[dict[str, Any]]) -> None:
        self._write_json_atomic(self._generated_images_path(), data)

    def get_generated_images(self) -> list[dict[str, Any]]:
        """Return persisted generation records, pruning entries whose image
        file no longer exists on disk."""
        records = self._load_generated_images()
        max_items = max(10, min(500, int(self.store.get("generate.history_max_items", 100))))
        kept = [
            record
            for record in records
            if isinstance(record, dict) and record.get("path") and Path(str(record["path"])).is_file()
        ][:max_items]
        if len(kept) != len(records):
            self._save_generated_images(kept)
        for record in kept:
            record["preview_url"] = self._build_preview_url(str(record.get("path", "")), max_size=640)
        return kept

    def save_generated_image(
        self, data: bytes, filename: str, meta: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        """Persist a generated image into ``downloads/generated`` and register
        a record so the generation history survives restarts."""
        try:
            save_dir = self._generated_images_dir()
            save_dir.mkdir(parents=True, exist_ok=True)
            filepath = save_dir / self._sanitize_filename(filename)
            with self.storage_service.download_operation():
                result = write_blob_atomic(filepath, data)
            record = dict(meta or {})
            record.setdefault("id", uuid.uuid4().hex)
            record["path"] = str(result.path)
            records = [
                item
                for item in self._load_generated_images()
                if isinstance(item, dict) and item.get("id") != record["id"]
            ]
            records.insert(0, record)
            max_items = max(10, min(500, int(self.store.get("generate.history_max_items", 100))))
            self._save_generated_images(records[:max_items])
            logger.info("Saved generated image to {} ({} bytes)", result.path, result.size)
            return record
        except Exception as e:
            logger.error("Save generated image error: {}", e)
            return None

    def delete_generated_image(self, image_id: str) -> None:
        records = self._load_generated_images()
        remaining = []
        for record in records:
            if isinstance(record, dict) and str(record.get("id")) == str(image_id):
                path = record.get("path")
                if path:
                    try:
                        Path(str(path)).unlink(missing_ok=True)
                    except Exception as exc:
                        logger.warning("Failed to delete generated image file {}: {}", path, exc)
                continue
            remaining.append(record)
        self._save_generated_images(remaining)

    def clear_generated_images(self, delete_files: bool = True) -> None:
        if delete_files:
            for record in self._load_generated_images():
                path = record.get("path") if isinstance(record, dict) else None
                if path:
                    try:
                        Path(str(path)).unlink(missing_ok=True)
                    except Exception as exc:
                        logger.warning("Failed to delete generated image file {}: {}", path, exc)
        self._save_generated_images([])

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

    def select_dynamic_wallpaper_media(self) -> str | None:
        return self._show_file_dialog(
            "open",
            filetypes=[("Video", "*.mp4 *.webm *.mov *.m4v")],
        )

    def select_dynamic_wallpaper_image(self) -> str | None:
        return self._show_file_dialog(
            "open",
            filetypes=[("Image", "*.avif *.bmp *.gif *.jpeg *.jpg *.png *.webp")],
        )

    @staticmethod
    def _bounded_number(value: Any, default: float, minimum: float, maximum: float) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = default
        return max(minimum, min(maximum, number))

    def _normalize_dynamic_scene(self, value: Any) -> dict[str, Any]:
        raw = value if isinstance(value, dict) else {}
        try:
            revision = int(raw.get("revision") or 0)
        except (TypeError, ValueError, OverflowError):
            revision = 0
        revision = max(0, min(9_007_199_254_740_991, revision))
        background_raw = raw.get("background") if isinstance(raw.get("background"), dict) else {}
        background_type = str(background_raw.get("type") or "image")
        if background_type not in {"video", "image", "slideshow"}:
            background_type = "image"
        source = str(background_raw.get("source") or "folder")
        if source not in {"folder", "favorites"}:
            source = "folder"
        transition = str(background_raw.get("transition") or "fade")
        if transition not in {"fade", "slide-left", "slide-up", "zoom", "blur", "wipe", "flip", "ken-burns"}:
            transition = "fade"
        path = str(background_raw.get("path") or "").strip()
        items = background_raw.get("items") if isinstance(background_raw.get("items"), list) else []
        stable_items: list[str] = []
        for item in items[:500]:
            item_path = str(item or "").strip()
            suffix = Path(urlparse(item_path).path).suffix.lower()
            if item_path and suffix in SUPPORTED_IMAGE_SUFFIXES:
                stable_items.append(item_path)
        widgets_raw = raw.get("widgets") if isinstance(raw.get("widgets"), list) else []
        widgets: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for index, item in enumerate(widgets_raw[:64]):
            if not isinstance(item, dict):
                continue
            widget_type = str(item.get("type") or "").strip()[:160]
            if not widget_type:
                continue
            instance_id = re.sub(r"[^A-Za-z0-9._-]", "", str(item.get("id") or ""))[:160]
            if not instance_id or instance_id in seen_ids:
                instance_id = f"widget-{index}-{uuid.uuid4().hex[:8]}"
            seen_ids.add(instance_id)
            settings_raw = item.get("settings") if isinstance(item.get("settings"), dict) else {}
            def widget_text(key: str, default: str, limit: int) -> str:
                value = settings_raw.get(key, default)
                return str(default if value is None else value)[:limit]

            settings: dict[str, Any] = {}
            if widget_type == "builtin:clock":
                settings = {
                    "label": widget_text("label", "", 40),
                    "use24Hour": bool(settings_raw.get("use24Hour", True)),
                    "showDate": bool(settings_raw.get("showDate", True)),
                }
            elif widget_type == "builtin:date":
                settings = {
                    "title": widget_text("title", "", 40),
                    "showWeekday": bool(settings_raw.get("showWeekday", True)),
                }
            elif widget_type == "builtin:note":
                settings = {
                    "title": widget_text("title", "便笺", 40),
                    "content": widget_text("content", "今天也要记得看看喜欢的风景。", 500),
                }
            elif widget_type == "builtin:status":
                settings = {
                    "title": widget_text("title", "动态服务", 40),
                    "subtitle": widget_text("subtitle", "场景正在运行", 100),
                }
            elif widget_type == "builtin:greeting":
                settings = {
                    "title": widget_text("title", "", 40),
                    "subtitle": widget_text("subtitle", "愿今天也有好风景", 100),
                }
            elif widget_type == "builtin:countdown":
                target = widget_text("target", "", 40)
                try:
                    if target:
                        datetime.strptime(target, "%Y-%m-%d")
                except ValueError:
                    target = ""
                settings = {
                    "title": widget_text("title", "倒计时", 40),
                    "target": target,
                    "completeText": widget_text("completeText", "时间到了", 80),
                }
            elif widget_type == "builtin:quote":
                settings = {
                    "quote": widget_text("quote", "慢一点，也没关系。", 240),
                    "author": widget_text("author", "", 60),
                }
            elif widget_type == "builtin:progress":
                settings = {
                    "title": widget_text("title", "本周进度", 40),
                    "value": self._bounded_number(settings_raw.get("value"), 50, 0, 100),
                    "unit": widget_text("unit", "%", 12),
                }
            minimum_width, minimum_height = {
                "builtin:clock": (20, 14), "builtin:date": (16, 18),
                "builtin:note": (20, 18), "builtin:status": (20, 14),
                "builtin:greeting": (22, 14), "builtin:countdown": (18, 18),
                "builtin:quote": (22, 18), "builtin:progress": (22, 14),
            }.get(widget_type, (8, 8))
            widgets.append({
                "id": instance_id,
                "type": widget_type,
                "x": self._bounded_number(item.get("x"), 6, 0, 92),
                "y": self._bounded_number(item.get("y"), 6, 0, 92),
                "width": self._bounded_number(item.get("width"), 28, minimum_width, 100),
                "height": self._bounded_number(item.get("height"), 20, minimum_height, 100),
                "opacity": self._bounded_number(item.get("opacity"), 1, 0, 1),
                "background_opacity": self._bounded_number(item.get("background_opacity"), 1, 0, 1),
                "background_blur": bool(item.get("background_blur", True)),
                "settings": settings,
            })
        return {
            "background": {
                "type": background_type,
                "path": path,
                "source": source,
                "folder_id": str(background_raw.get("folder_id") or "")[:160],
                "items": stable_items,
                "interval_seconds": int(self._bounded_number(background_raw.get("interval_seconds"), 30, 3, 86400)),
                "transition": transition,
                "transition_duration": int(self._bounded_number(background_raw.get("transition_duration"), 900, 100, 5000)),
                "shuffle": bool(background_raw.get("shuffle", False)),
                "muted": bool(background_raw.get("muted", True)),
                "loop": bool(background_raw.get("loop", True)),
                "playback_rate": self._bounded_number(background_raw.get("playback_rate"), 1, 0.25, 4),
                "autoplay": bool(background_raw.get("autoplay", True)),
            },
            "widgets": widgets,
            "revision": revision,
        }

    def _dynamic_slideshow_items(self, background: dict[str, Any]) -> list[str]:
        if background["source"] == "favorites":
            items = self._favorite_rotation_items({"scope": "folder", "folder_id": background["folder_id"]})
            hydrated = self._hydrate_favorite_urls({"items": items}).get("items", [])
            result: list[str] = []
            for item in hydrated:
                candidate = str(item.get("local_path") or item.get("source_url") or item.get("preview_url") or "")
                if Path(urlparse(candidate).path).suffix.lower() in SUPPORTED_IMAGE_SUFFIXES:
                    result.append(candidate)
            return result
        folder = Path(str(background.get("path") or "")).expanduser()
        if not folder.is_dir():
            return []
        return [
            str(path.resolve())
            for path in sorted(folder.iterdir(), key=lambda item: item.name.casefold())
            if path.is_file() and not path.is_symlink() and path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
        ][:500]

    def get_dynamic_wallpaper_scene(self, resolve_items: bool = False) -> dict[str, Any]:
        scene = self._normalize_dynamic_scene(self.store.get("wallpaper.dynamic", {}))
        if resolve_items and scene["background"]["type"] == "slideshow":
            scene["background"]["items"] = self._dynamic_slideshow_items(scene["background"])
        return scene

    def get_dynamic_wallpaper_catalog(self) -> dict[str, Any]:
        return {"favorite_folders": self._load_favorites().get("folders", [])}

    def save_dynamic_wallpaper_scene(self, value: Any) -> dict[str, Any]:
        scene = self._normalize_dynamic_scene(value)
        background = scene["background"]
        if background["type"] == "video":
            path = Path(background["path"]).expanduser()
            if background["path"] and (not path.is_file() or path.suffix.lower() not in SUPPORTED_VIDEO_SUFFIXES):
                raise ValueError("请选择受支持的视频文件")
        elif background["type"] == "image":
            path = Path(background["path"]).expanduser()
            if background["path"] and (not path.is_file() or path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES):
                raise ValueError("请选择受支持的图片文件")
        elif background["source"] == "folder":
            folder = Path(background["path"]).expanduser()
            if background["path"] and not folder.is_dir():
                raise ValueError("轮播文件夹不存在")
        with self.store.transaction():
            persisted = self._normalize_dynamic_scene(self.store.get("wallpaper.dynamic", {}))
            scene["revision"] = max(
                persisted["revision"] + 1,
                scene["revision"] + 1,
                int(datetime.now().timestamp() * 1000),
            )
            self.store.set("wallpaper.dynamic", scene)
        return self.get_dynamic_wallpaper_scene()

    def start_dynamic_wallpaper_scene(self, value: Any | None = None) -> dict[str, Any]:
        scene = self.save_dynamic_wallpaper_scene(value) if value is not None else self.get_dynamic_wallpaper_scene()
        background = scene["background"]
        if background["type"] in {"image", "video"} and not background["path"]:
            raise ValueError("请先选择动态壁纸底图")
        return self.dynamic_wallpaper_service.start_scene(scene["revision"], background["type"])

    def apply_dynamic_wallpaper_scene(self, value: Any) -> dict[str, Any]:
        scene = self.save_dynamic_wallpaper_scene(value)
        background = scene["background"]
        if background["type"] in {"image", "video"} and not background["path"]:
            raise ValueError("请先选择动态壁纸底图")
        status = self.dynamic_wallpaper_service.start_scene(scene["revision"], background["type"])
        return {"scene": scene, "status": status}

    def automation_dynamic_wallpaper(self, config: dict[str, Any]) -> dict[str, Any]:
        action = str(config.get("action") or "get_type")
        if action == "get_type":
            return {"type": self.dynamic_wallpaper_service.current_type()}
        if action == "start":
            status = self.start_dynamic_wallpaper(
                str(config.get("path") or ""),
                bool(config.get("muted", True)),
                bool(config.get("loop", True)),
                float(config.get("playback_rate", 1.0)),
            )
            return {"type": "video", "status": status}
        if action == "stop":
            return {"type": "", "status": self.stop_dynamic_wallpaper()}
        if action == "video_control":
            video_action = str(config.get("video_action") or "auto")
            return {"type": "video", "status": self.control_dynamic_wallpaper(video_action)}
        if action in {"play", "pause", "reload"}:
            return {"type": "video", "status": self.control_dynamic_wallpaper(action)}
        if action == "slideshow_control":
            slideshow_action = str(config.get("slideshow_action") or "next")
            return {"type": "slideshow", "status": self.control_dynamic_wallpaper(slideshow_action)}

        scene = self.get_dynamic_wallpaper_scene()
        background = scene["background"]
        if action == "replace_video":
            background.update({
                "type": "video",
                "path": str(config.get("path") or ""),
                "muted": bool(config.get("muted", True)),
                "loop": bool(config.get("loop", True)),
                "playback_rate": float(config.get("playback_rate", 1.0)),
                "autoplay": str(config.get("video_action") or "auto") != "pause",
            })
        elif action == "slideshow_transition":
            background.update({
                "type": "slideshow",
                "transition": str(config.get("transition") or "fade"),
                "transition_duration": int(config.get("transition_duration", 900)),
            })
        elif action == "slideshow_source":
            background.update({
                "type": "slideshow",
                "source": str(config.get("source") or "folder"),
                "path": str(config.get("path") or ""),
                "folder_id": str(config.get("folder_id") or ""),
            })
        elif action == "slideshow_settings":
            background.update({
                "type": "slideshow",
                "interval_seconds": int(config.get("interval_seconds", 30)),
                "transition_duration": int(config.get("transition_duration", 900)),
                "shuffle": bool(config.get("shuffle", False)),
            })
        else:
            raise ValueError("不支持的动态壁纸自动化操作")

        saved = self.save_dynamic_wallpaper_scene(scene)
        status = self.start_dynamic_wallpaper_scene()
        background_type = str(saved.get("background", {}).get("type") or background.get("type") or "")
        return {"type": background_type, "scene": saved, "status": status}

    def open_dynamic_widget_editor(self) -> bool:
        window = self._dynamic_editor_window
        if window is None or not self._dynamic_editor_url:
            raise RuntimeError("小组件编辑窗口尚未就绪")
        window.load_url(self._dynamic_editor_url)
        window.show()
        return True

    def close_dynamic_widget_editor(self) -> bool:
        window = self._dynamic_editor_window
        if window is not None:
            window.hide()
        return True

    def get_dynamic_wallpaper_status(self) -> dict[str, Any]:
        return self.dynamic_wallpaper_service.diagnose()

    def start_dynamic_wallpaper(
        self,
        path: str,
        muted: bool = True,
        loop: bool = True,
        playback_rate: float = 1.0,
    ) -> dict[str, Any]:
        return self.dynamic_wallpaper_service.start(path, muted, loop, playback_rate)

    def stop_dynamic_wallpaper(self) -> dict[str, Any]:
        return self.dynamic_wallpaper_service.stop()

    def control_dynamic_wallpaper(self, action: str) -> dict[str, Any]:
        return self.dynamic_wallpaper_service.control(action)

    def update_dynamic_wallpaper_telemetry(self, payload: dict[str, Any]) -> None:
        self.dynamic_wallpaper_service.update_telemetry(payload)

    def resolve_dynamic_wallpaper_media(self, revision: int = 0) -> tuple[Path, str] | None:
        return self.dynamic_wallpaper_service.media_file(revision)

    def resolve_dynamic_scene_asset(self, path: str) -> tuple[Path, str] | None:
        scene = self.get_dynamic_wallpaper_scene(resolve_items=True)
        allowed = {scene["background"]["path"], *scene["background"]["items"]}
        candidate = str(Path(str(path)).expanduser().resolve(strict=False))
        if candidate not in {str(Path(item).expanduser().resolve(strict=False)) for item in allowed if item}:
            return None
        asset = Path(candidate)
        suffix = asset.suffix.lower()
        if not asset.is_file() or suffix not in SUPPORTED_IMAGE_SUFFIXES | SUPPORTED_VIDEO_SUFFIXES:
            return None
        return asset, mimetypes.guess_type(asset.name)[0] or "application/octet-stream"

    @staticmethod
    def _favorite_export_options(options: dict[str, Any] | str | None) -> dict[str, Any]:
        """Normalize the favorite archive options while keeping old callers working."""
        raw = {"scope": "folder", "folder_id": options} if isinstance(options, str) else options
        raw = raw if isinstance(raw, dict) else {}
        scope = str(raw.get("scope") or "all").strip().lower()
        if scope not in {"selected", "folder", "all"}:
            scope = "all"
        item_ids = raw.get("item_ids")
        if not isinstance(item_ids, list):
            item_ids = []
        try:
            compression_level = max(1, min(9, int(raw.get("compression_level", 6))))
        except (TypeError, ValueError):
            compression_level = 6
        return {
            "scope": scope,
            "folder_id": str(raw.get("folder_id") or ""),
            "item_ids": {str(item_id) for item_id in item_ids if str(item_id)},
            "include_local_data": bool(raw.get("include_local_data", False)),
            "compression": bool(raw.get("compression", True)),
            "compression_level": compression_level,
        }

    def _is_favorite_local_path_safe(self, image_path: str) -> bool:
        if self.is_path_safe(image_path):
            return True
        try:
            resolved = Path(image_path).resolve()
            favorites_root = self._favorites_path().parent.resolve()
            resolved.relative_to(favorites_root)
            return True
        except (OSError, ValueError):
            return False

    def _export_favorite_url(self, value: Any) -> str:
        normalized = self._unwrap_session_url(str(value or ""))
        return "" if normalized and Path(normalized).is_absolute() else normalized

    def export_favorites(self, options: dict[str, Any] | str | None = None) -> dict[str, Any]:
        import zipfile

        normalized = self._favorite_export_options(options)
        source = self._load_favorites()
        source_items = list(source.get("items", []))
        if normalized["scope"] == "selected":
            selected_ids = normalized["item_ids"]
            items = [item for item in source_items if str(item.get("id")) in selected_ids]
        elif normalized["scope"] == "folder" and normalized["folder_id"]:
            items = [item for item in source_items if item.get("folder_id") == normalized["folder_id"]]
        else:
            items = source_items

        item_folder_ids = {str(item.get("folder_id")) for item in items}
        if normalized["scope"] == "all":
            folders = list(source.get("folders", []))
        else:
            folders = [folder for folder in source.get("folders", []) if str(folder.get("id")) in item_folder_ids]
        tags = sorted({str(tag) for item in items for tag in item.get("tags", []) if str(tag)})
        tags = sorted({str(tag) for tag in source.get("all_tags", []) if str(tag)} | set(tags))
        data = {
            "archive_version": 2,
            "folders": folders,
            "items": [],
            "all_tags": tags,
            "system_tags": sorted({str(tag) for tag in source.get("system_tags", []) if str(tag) in tags}),
        }
        local_file_count = 0
        missing_local_count = 0
        archive_files: list[tuple[Path, str]] = []
        for original_item in items:
            item = dict(original_item)
            for field in ("preview_url", "source_url"):
                item[field] = self._export_favorite_url(item.get(field))
            local_path = str(item.get("local_path") or "")
            item.pop("local_path", None)
            item["local_path"] = None
            item.pop("local_archive_path", None)
            if normalized["include_local_data"] and local_path:
                candidate = Path(local_path)
                if candidate.is_file() and self._is_favorite_local_path_safe(local_path):
                    suffix = candidate.suffix.lower()[:16]
                    archive_path = f"assets/{uuid.uuid4().hex}{suffix}"
                    item["local_archive_path"] = archive_path
                    archive_files.append((candidate, archive_path))
                    local_file_count += 1
                else:
                    missing_local_count += 1
            data["items"].append(item)

        export_path = (
            get_data_dir() / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}_{uuid.uuid4().hex[:8]}.ltfav"
        )
        compression = zipfile.ZIP_DEFLATED if normalized["compression"] else zipfile.ZIP_STORED
        zip_kwargs: dict[str, Any] = {"compression": compression}
        if compression == zipfile.ZIP_DEFLATED:
            zip_kwargs["compresslevel"] = normalized["compression_level"]
        with zipfile.ZipFile(export_path, "w", **zip_kwargs) as zf:
            zf.writestr("manifest.json", json.dumps(data, ensure_ascii=False, indent=2))
            for local_path, archive_path in archive_files:
                zf.write(local_path, archive_path)
        return {
            "path": str(export_path),
            "item_count": len(data["items"]),
            "folder_count": len(data["folders"]),
            "local_file_count": local_file_count,
            "missing_local_count": missing_local_count,
            "compressed": normalized["compression"],
            "compression_level": normalized["compression_level"] if normalized["compression"] else None,
        }

    @staticmethod
    def _safe_favorite_archive_member(name: str) -> str | None:
        normalized = name.replace("\\", "/")
        path = Path(normalized)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            return None
        if not normalized.startswith("assets/") or len(normalized) > 240:
            return None
        return normalized

    @_favorites_transaction
    def import_favorites(self, path: str) -> dict[str, int]:
        import zipfile

        max_member_count = 4096
        max_manifest_size = 16 * 1024 * 1024
        max_member_size = 512 * 1024 * 1024
        max_total_size = 1024 * 1024 * 1024
        with zipfile.ZipFile(path, "r") as zf:
            infos = zf.infolist()
            if len(infos) > max_member_count:
                raise RuntimeError("收藏包包含过多文件")
            try:
                manifest_info = zf.getinfo("manifest.json")
                if manifest_info.file_size > max_manifest_size:
                    raise RuntimeError("收藏包清单过大")
                data = json.loads(zf.read(manifest_info))
            except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
                raise RuntimeError("收藏包缺少有效的 manifest.json") from exc
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("items"), list)
                or not isinstance(data.get("folders"), list)
            ):
                raise RuntimeError("收藏包格式无效")
            archive_version = data.get("archive_version", 1)
            if (
                isinstance(archive_version, bool)
                or not isinstance(archive_version, int)
                or archive_version not in {1, 2}
            ):
                raise RuntimeError("不支持的收藏包版本")
            members = {
                safe_name: info
                for info in infos
                if (safe_name := self._safe_favorite_archive_member(info.filename)) is not None
            }
            total_size = sum(info.file_size for info in members.values() if not info.is_dir())
            if any(info.file_size > max_member_size for info in members.values()):
                raise RuntimeError("收藏包中的本地文件过大")
            if total_size > max_total_size:
                raise RuntimeError("收藏包展开后过大")
            valid_folders = [
                dict(folder)
                for folder in data["folders"]
                if isinstance(folder, dict) and isinstance(folder.get("id"), str) and folder["id"].strip()
            ]
            current = self._load_favorites()
            existing_ids = {str(item.get("id")) for item in current["items"]}
            existing_folder_ids = {str(folder.get("id")) for folder in current["folders"]}
            restored_local_files = 0
            missing_local_files = 0
            imported_items = 0
            skipped_items = 0
            added_folders = 0
            assets_dir = self._favorites_path().parent / "favorite_assets"
            created_assets: list[Path] = []
            try:
                for raw_item in data["items"]:
                    if not isinstance(raw_item, dict):
                        continue
                    item_id = raw_item.get("id")
                    if not isinstance(item_id, str) or not item_id.strip():
                        continue
                    folder_id = raw_item.get("folder_id", "default")
                    if not isinstance(folder_id, str) or not folder_id.strip():
                        continue
                    raw_tags = raw_item.get("tags", [])
                    if not isinstance(raw_tags, list) or any(not isinstance(tag, str) for tag in raw_tags):
                        continue
                    archive_reference = raw_item.get("local_archive_path")
                    legacy_reference = raw_item.get("local_path")
                    if archive_reference is not None and not isinstance(archive_reference, str):
                        continue
                    if legacy_reference is not None and not isinstance(legacy_reference, str):
                        continue
                    if item_id in existing_ids:
                        skipped_items += 1
                        continue
                    item = dict(raw_item)
                    item["id"] = item_id
                    item["folder_id"] = folder_id
                    item["tags"] = list(raw_tags)
                    archive_member = self._safe_favorite_archive_member(archive_reference or "")
                    item.pop("local_archive_path", None)
                    item["local_path"] = None
                    if archive_reference:
                        info = members.get(archive_member) if archive_member else None
                        unix_file_type = ((info.external_attr >> 16) & 0o170000) if info else 0
                        if info and not info.is_dir() and unix_file_type != 0o120000:
                            suffix = Path(archive_member).suffix.lower()[:16]
                            destination = assets_dir / f"{uuid.uuid4().hex}{suffix}"
                            temporary = destination.with_name(destination.name + ".part")
                            assets_dir.mkdir(parents=True, exist_ok=True)
                            try:
                                with zf.open(info, "r") as source, temporary.open("wb") as output:
                                    shutil.copyfileobj(source, output, length=1024 * 1024)
                                os.replace(temporary, destination)
                            finally:
                                with contextlib.suppress(OSError):
                                    temporary.unlink()
                            created_assets.append(destination)
                            item["local_path"] = str(destination)
                            restored_local_files += 1
                        else:
                            missing_local_files += 1
                    elif legacy_reference:
                        if Path(legacy_reference).is_file() and self._is_favorite_local_path_safe(legacy_reference):
                            item["local_path"] = legacy_reference
                        else:
                            missing_local_files += 1
                    current["items"].append(item)
                    existing_ids.add(item_id)
                    imported_items += 1
                for folder in valid_folders:
                    folder_id = str(folder["id"])
                    if folder_id not in existing_folder_ids:
                        current["folders"].append(folder)
                        existing_folder_ids.add(folder_id)
                        added_folders += 1
                archive_tags = data.get("all_tags", [])
                if isinstance(archive_tags, list) and all(isinstance(tag, str) for tag in archive_tags):
                    current["all_tags"] = sorted(set(current.get("all_tags", [])) | set(archive_tags))
                archive_system_tags = data.get("system_tags", [])
                if isinstance(archive_system_tags, list) and all(isinstance(tag, str) for tag in archive_system_tags):
                    current["system_tags"] = sorted(set(current.get("system_tags", [])) | set(archive_system_tags))
                self._save_favorites(current)
            except Exception:
                for asset in created_assets:
                    with contextlib.suppress(OSError):
                        asset.unlink()
                raise
        return {
            "imported_items": imported_items,
            "skipped_items": skipped_items,
            "added_folders": added_folders,
            "restored_local_files": restored_local_files,
            "missing_local_files": missing_local_files,
        }

    def pick_and_import_favorites(self) -> dict[str, int] | None:
        path = self._show_file_dialog(
            "open",
            filetypes=[("Favorite Package", "*.ltfav"), ("All files", "*.*")],
        )
        return self.import_favorites(path) if path else None

    def get_local_image_url(self, image_path: str, max_size: int = 960) -> str | None:
        """Return a token-authenticated preview URL for a local image.

        Replaces the former base64 data-URL approach; the bytes are streamed by
        the ``/api/preview`` endpoint on demand.
        """
        return self._build_preview_url(image_path, max_size=max_size)

    def get_version(self) -> str:
        return VERSION

    def get_platform(self) -> str:
        return sys.platform

    @staticmethod
    def get_display_resolutions() -> list[dict[str, object]]:
        return get_display_resolutions()

    @staticmethod
    def get_build_info() -> dict[str, Any]:
        return get_build_info()

    @staticmethod
    def get_app_info() -> dict[str, str]:
        return get_app_info()

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
        source: str = "online",
        limit: int = 20,
        market: str = "zh-CN",
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        if source == "online":
            return self.spotlight_service.list_online_candidates(
                limit=limit, market=market, force_refresh=force_refresh
            )
        items = self.spotlight_service.list_local_candidates(limit=limit, force_refresh=force_refresh)
        return [self._proxy_local_spotlight_item(item) for item in items]

    def _proxy_local_spotlight_item(self, item: dict[str, Any]) -> dict[str, Any]:
        """Wrap raw local file paths into same-origin preview URLs.

        The webview blocks ``file://`` resources, so local Spotlight assets
        must be served through ``/api/preview``.  The original path is kept
        in ``metadata.original_image_url`` for operations that need the real
        filesystem location (set wallpaper, download, copy path).
        """
        original_path = str(item.get("image_url") or "")
        if not original_path or not Path(original_path).is_absolute():
            return item
        proxied = dict(item)
        metadata = dict(proxied.get("metadata") or {})
        metadata["original_image_url"] = original_path
        proxied["metadata"] = metadata
        preview_url = self._build_preview_url(original_path) or original_path
        proxied["preview_url"] = preview_url
        proxied["image_url"] = preview_url
        return proxied

    def query_cnu_selected(
        self,
        page: int = 1,
        limit: int = 20,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        works = self.cnu_service.query_selected_works(page=page, limit=limit, force_refresh=force_refresh)
        return self._proxy_cnu_items(works)

    def get_cnu_work(self, work_id: str) -> list[dict[str, Any]]:
        items = self.cnu_service.fetch_work(work_id)
        return self._proxy_cnu_items(items)

    def query_pixivel_ranking(
        self,
        mode: str = "day",
        page: int = 1,
        limit: int = 30,
        force_refresh: bool = False,
        ranking_date: str | None = None,
    ) -> list[dict[str, Any]]:
        works = self.pixivel_service.query_ranking(
            mode=mode,
            page=page,
            limit=limit,
            force_refresh=force_refresh,
            ranking_date=ranking_date,
        )
        # Ranking cards only display thumbnails. Loading them directly from the
        # Pxelk mirror avoids saturating the webview's limited connections to
        # the local API and blocking unrelated RPC calls during navigation.
        return works

    def get_pixivel_work(self, work_id: str) -> list[dict[str, Any]]:
        items = self.pixivel_service.fetch_work(work_id)
        return self._proxy_pixivel_items(items)

    def list_timeline_topics(self, force_refresh: bool = False) -> list[dict[str, Any]]:
        topics = self.timeline_service.list_topics(force_refresh=force_refresh)
        return self._proxy_timeline_topics(topics)

    def query_timeline_wallpapers(
        self,
        mode: str = "latest",
        cursor: int | None = None,
        topic: str = "",
        seed: int | None = None,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        page = self.timeline_service.query_wallpapers(
            mode=mode,
            cursor=cursor,
            topic=topic,
            seed=seed,
            force_refresh=force_refresh,
        )
        return {**page, "items": self._proxy_timeline_items(page["items"])}

    def query_cnu_works(
        self,
        section: str,
        order: str,
        category_id: str = "0",
        page: int = 1,
        limit: int = 50,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        works = self.cnu_service.query_works(
            section=section,
            order=order,
            category_id=category_id,
            page=page,
            limit=limit,
            force_refresh=force_refresh,
        )
        return self._proxy_cnu_items(works)

    def clear_source_cache(self, source: str | None = None) -> dict[str, Any]:
        """Drop cached source responses so the next call refetches."""
        cleared: list[str] = []
        if source in (None, "bing"):
            from backend.services.bing import BingService

            BingService._cache.clear()
            cleared.append("bing")
        if source in (None, "spotlight"):
            from backend.services.spotlight import SpotlightService

            SpotlightService._cache.clear()
            cleared.append("spotlight")
        if source in (None, "cnu"):
            CNUService._cache.clear()
            cleared.append("cnu")
        if source in (None, "pixivel"):
            PixivelService._cache.clear()
            cleared.append("pixivel")
        if source in (None, "timeline"):
            TimelineService._cache.clear()
            cleared.append("timeline")
        return {"cleared": cleared}

    def bootstrap(self) -> dict[str, Any]:
        logger.info("Bootstrapping application")
        home_bing = self.bing_service.query_daily(market="zh-CN", count=1)
        quote = self.get_sentence()
        plugins = self.list_plugins()["plugins"]
        try:
            sources = self.ltws_service.list_sources()
        except Exception as e:
            logger.error(f"bootstrap sources error: {e}")
            sources = []
        logger.info("Bootstrap complete: bing={} sources={}", len(home_bing), len(sources))
        return {
            "settings": self.store.as_dict(),
            "favorites": self._load_favorites(strict=False),
            "history": self._load_history(),
            "sources": sources,
            "plugins": plugins,
            "build_info": get_build_info(),
            "app": get_metadata(),
            "runtime": {
                "debug": {"enabled": False, "session_enabled": False, "open_devtools_on_start": True},
                "window": {
                    "hide_on_close": self.store.get("ui.hide_on_close", True),
                    "minimize_to_tray": self.store.get("ui.minimize_to_tray", True),
                },
                "plugins": {"count": len(plugins)},
            },
            "home": {
                "bing": home_bing[:1],
                "spotlight": [
                    self._proxy_local_spotlight_item(item)
                    for item in self.spotlight_service.list_local_candidates(limit=4)
                ],
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

    @_storage_references_transaction
    def record_current_wallpaper(self) -> dict[str, Any] | None:
        info = self.get_current_wallpaper()
        if info and info.get("path"):
            self.add_to_history(info["path"], info.get("filename", "当前壁纸"), "record")
        return info

    def runtime_snapshot(self) -> dict[str, Any]:
        plugins = self.list_plugins()["plugins"]
        automation = self.automation_service.snapshot()
        return {
            "auto_change": {
                "enabled": automation["enabled_count"] > 0,
                "mode": "automation",
                "running": automation["run"]["running"],
            },
            "automation": automation,
            "debug": {"enabled": False, "session_enabled": False, "open_devtools_on_start": True},
            "window": {
                "hide_on_close": self.store.get("ui.hide_on_close", True),
                "minimize_to_tray": self.store.get("ui.minimize_to_tray", True),
            },
            "plugins": {"count": len(plugins)},
        }

    def get_storage_overview(self) -> dict[str, Any]:
        return self.storage_service.get_overview()

    def get_storage_operation_status(self) -> dict[str, Any]:
        with self._storage_task_lock:
            return dict(self._storage_task_state)

    def _update_storage_operation(self, current: int, total: int, message: str) -> None:
        with self._storage_task_lock:
            if not self._storage_task_state["running"]:
                return
            self._storage_task_state.update(
                current=max(0, int(current)),
                total=max(1, int(total)),
                message=message,
            )

    def start_storage_directory_change(
        self,
        kind: str,
        directory: str | None,
        migrate: bool,
        allow_non_empty: bool,
    ) -> dict[str, Any]:
        if kind not in {"downloads", "favorites"}:
            raise ValueError("不支持的存储位置类型")
        with self._storage_task_lock:
            if self._storage_task_state["running"]:
                raise RuntimeError("已有存储任务正在进行")
            operation_id = uuid.uuid4().hex
            self._storage_task_state = {
                "id": operation_id,
                "running": True,
                "kind": kind,
                "title": (
                    ("迁移下载数据" if kind == "downloads" else "迁移收藏数据")
                    if migrate
                    else ("更改下载位置" if kind == "downloads" else "更改收藏位置")
                ),
                "message": "正在检查目标位置",
                "current": 0,
                "total": 1,
                "success": None,
                "error": "",
                "moved": 0,
                "undeleted": 0,
                "started_at": datetime.now().isoformat(),
                "finished_at": "",
            }

        def run() -> None:
            try:
                if kind == "downloads":
                    result = self.set_download_directory(directory, migrate, allow_non_empty)
                else:
                    result = self.set_favorites_directory(directory, migrate, allow_non_empty)
                with self._storage_task_lock:
                    self._storage_task_state.update(
                        running=False,
                        success=True,
                        message="迁移完成" if migrate else "存储位置已更改",
                        current=self._storage_task_state["total"],
                        moved=int(result.get("moved", 0)),
                        undeleted=int(result.get("undeleted", 0)),
                        finished_at=datetime.now().isoformat(),
                    )
            except Exception as exc:
                logger.exception("Storage directory operation failed")
                with self._storage_task_lock:
                    self._storage_task_state.update(
                        running=False,
                        success=False,
                        error=str(exc),
                        message="操作失败",
                        finished_at=datetime.now().isoformat(),
                    )

        threading.Thread(target=run, name=f"storage-{kind}-{operation_id[:8]}", daemon=True).start()
        return self.get_storage_operation_status()

    def clear_storage_category(self, category_id: str) -> dict[str, Any]:
        with self._storage_task_lock:
            if self._storage_task_state["running"]:
                raise RuntimeError("存储任务进行中，请稍后再试")
        return self.storage_service.clear_category(category_id)

    def compress_downloads(self, format_id: str, quality: int = 80) -> dict[str, Any]:
        with self._storage_task_lock:
            if self._storage_task_state["running"]:
                raise RuntimeError("存储任务进行中，请稍后再试")
        return self.storage_service.compress_downloads(format_id, quality)

    def pick_download_directory(self) -> dict[str, str] | None:
        return self._pick_directory("选择下载目录")

    def pick_favorites_directory(self) -> dict[str, str] | None:
        return self._pick_directory("选择收藏数据目录")

    @staticmethod
    def _pick_directory(title: str) -> dict[str, str] | None:
        try:
            import tkinter as tk
            from tkinter import filedialog

            root = tk.Tk()
            root.withdraw()
            path = filedialog.askdirectory(title=title)
            root.destroy()
            if path:
                return {"path": path}
        except Exception as e:
            logger.error(f"Pick directory error: {e}")
        return None

    def inspect_storage_directory(self, directory: str, kind: str) -> dict[str, Any]:
        target = Path(directory).expanduser()
        if kind == "downloads":
            self.storage_service.validate_download_directory(target)
            current = self._downloads_dir().resolve(strict=False)
        elif kind == "favorites":
            target = self.storage_service.validate_favorites_directory(target)
            current = self._favorites_path().parent.resolve(strict=False)
        else:
            raise ValueError("不支持的存储位置类型")
        entries: list[Path] = []
        if target.exists():
            if not target.is_dir():
                raise ValueError("选择的位置不是文件夹")
            entries = list(target.iterdir())
        return {
            "path": str(target.resolve(strict=False)),
            "is_empty": len(entries) == 0,
            "entry_count": len(entries),
            "same_as_current": target.resolve(strict=False) == current,
        }

    @_favorites_transaction
    @_storage_references_transaction
    def set_download_directory(
        self,
        directory: str | None = None,
        migrate: bool = False,
        allow_non_empty: bool = False,
    ) -> dict[str, Any]:
        target = Path(directory).expanduser() if directory else get_data_dir() / "downloads"
        self.storage_service.validate_download_directory(target)
        info = self.inspect_storage_directory(str(target), "downloads")
        if info["same_as_current"]:
            return {"settings": self.store.as_dict(), "storage": self.get_storage_overview(), "moved": 0}
        if not info["is_empty"] and not allow_non_empty:
            raise RuntimeError("目标下载目录不为空，需要确认后才能继续")
        target.mkdir(parents=True, exist_ok=True)
        self.storage_service.validate_download_directory(target)
        with self.storage_service.download_operation():
            source_root = self._downloads_dir().resolve(strict=False)
            previous_setting = self.store.get("storage.download_directory", "")
            copied: list[tuple[Path, Path]] = []
            if migrate:
                copied = self.storage_service.prepare_download_migration(target, self._update_storage_operation)
            else:
                self._update_storage_operation(0, 2, "正在切换下载位置")
            file_steps = max(1, len(copied))
            total_steps = file_steps + 3 if migrate else 2
            next_setting = "" if not directory else str(target.resolve())
            try:
                self.store.set("storage.download_directory", next_setting)
                self._update_storage_operation(
                    file_steps + 1 if migrate else 1,
                    total_steps,
                    "正在提交下载位置配置",
                )
            except Exception as exc:
                self.storage_service.discard_prepared_downloads(copied)
                raise RuntimeError("下载位置配置保存失败，未更改下载目录") from exc

            undeleted = 0
            reference_state: dict[str, Any] | None = None
            try:
                if migrate and copied:
                    self._update_storage_operation(file_steps + 2, total_steps, "正在更新壁纸引用")
                    reference_state, preserve_sources = self._rebase_download_references(copied)
                    self._update_storage_operation(file_steps + 3, total_steps, "正在删除原位置文件")
                    undeleted = self.storage_service.commit_download_migration(
                        copied, target, source_root, preserve_sources
                    )
                else:
                    self.storage_service.remember_current_download_root()
                    self._update_storage_operation(total_steps, total_steps, "下载位置已更新")
            except Exception as exc:
                rollback_persisted = True
                try:
                    self.store.set("storage.download_directory", previous_setting)
                except Exception:
                    rollback_persisted = False
                if rollback_persisted:
                    restored_references = False
                    if reference_state is not None:
                        try:
                            self._restore_download_references(reference_state)
                            restored_references = True
                        except Exception:
                            logger.exception("Failed to restore download references after migration error")
                    if restored_references:
                        self.storage_service.discard_prepared_downloads(copied)
                    self.storage_service.remember_current_download_root()
                raise RuntimeError("下载迁移提交失败，原文件仍保留") from exc
        return {
            "settings": self.store.as_dict(),
            "storage": self.get_storage_overview(),
            "moved": len(copied),
            "undeleted": undeleted,
        }

    @_favorites_transaction
    def set_favorites_directory(
        self,
        directory: str | None = None,
        migrate: bool = False,
        allow_non_empty: bool = False,
    ) -> dict[str, Any]:
        self._update_storage_operation(0, 4, "正在检查收藏数据")
        source = self._favorites_path()
        target_dir = self.storage_service.validate_favorites_directory(Path(directory) if directory else get_data_dir())
        info = self.inspect_storage_directory(str(target_dir), "favorites")
        if not info["is_empty"] and not info["same_as_current"] and not allow_non_empty:
            raise RuntimeError("目标收藏目录不为空，需要确认后才能继续")
        target_dir.mkdir(parents=True, exist_ok=True)
        target_dir = self.storage_service.validate_favorites_directory(target_dir)
        target = target_dir / "favorites.json"
        self._update_storage_operation(1, 4, "正在准备目标收藏文件")
        if source.resolve(strict=False) == target.resolve(strict=False):
            return {"settings": self.store.as_dict(), "storage": self.get_storage_overview(), "moved": 0}

        backup: Path | None = None
        target_created = False
        if migrate:
            try:
                data = json.loads(source.read_text(encoding="utf-8"))
            except Exception as exc:
                raise RuntimeError("当前收藏数据无法读取，未更改存储位置") from exc
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise RuntimeError("当前收藏数据格式异常，未更改存储位置")
            if target.exists():
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = self.storage_service.available_destination(
                    target.with_name(f"favorites.backup_{timestamp}.json")
                )
                os.replace(target, backup)
            try:
                self._write_json_exclusive(target, data)
            except Exception:
                if backup is not None and backup.exists():
                    with contextlib.suppress(OSError):
                        os.replace(backup, target)
                raise
            target_created = True
        elif target.exists():
            try:
                target_data = json.loads(target.read_text(encoding="utf-8"))
            except Exception as exc:
                raise RuntimeError("目标目录中的 favorites.json 无法读取") from exc
            if not isinstance(target_data, dict) or not isinstance(target_data.get("items"), list):
                raise RuntimeError("目标目录中的 favorites.json 格式异常")
        else:
            self._write_json_exclusive(
                target,
                {
                    "folders": [{"id": "default", "name": "默认收藏夹", "description": "", "order": 0}],
                    "items": [],
                    "all_tags": [],
                    "system_tags": [],
                },
            )
            target_created = True

        self._update_storage_operation(2, 4, "正在提交收藏位置配置")

        previous_setting = self.store.get("storage.favorites_directory", "")
        next_setting = "" if not directory else str(target_dir)
        try:
            self.store.set("storage.favorites_directory", next_setting)
        except Exception as exc:
            rollback_persisted = True
            try:
                self.store.set("storage.favorites_directory", previous_setting)
            except Exception:
                rollback_persisted = False
            if rollback_persisted:
                if target_created:
                    with contextlib.suppress(OSError):
                        target.unlink()
                if backup is not None and backup.exists():
                    with contextlib.suppress(OSError):
                        os.replace(backup, target)
            raise RuntimeError("收藏位置配置保存失败，未更改收藏目录") from exc

        undeleted = 0
        if migrate:
            self._update_storage_operation(3, 4, "正在删除原收藏文件")
            try:
                source.unlink()
            except OSError as exc:
                undeleted = 1
                logger.warning("Favorites moved but old file could not be deleted: {}", exc)
        self._update_storage_operation(4, 4, "收藏位置已更新")
        return {
            "settings": self.store.as_dict(),
            "storage": self.get_storage_overview(),
            "moved": 1 if migrate else 0,
            "undeleted": undeleted,
            "backup": str(backup) if backup else "",
        }

    @_storage_references_transaction
    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        for key in updates:
            if key == "storage" or key in {"storage.download_directory", "storage.favorites_directory"}:
                raise ValueError("存储位置必须通过专用迁移接口修改")
        self.store.set_many(updates)
        return self.store.as_dict()

    def trigger_auto_change_now(self, plan_id: str | None = None) -> dict[str, Any]:
        if not plan_id:
            items = self.automation_service.list()
            enabled = next((item for item in items if item["enabled"]), None)
            if enabled is None:
                raise ValueError("没有已启用的自动化")
            plan_id = enabled["id"]
        return self.automation_service.run(plan_id)

    def list_automations(self) -> list[dict[str, Any]]:
        return self.automation_service.list()

    def get_automation(self, automation_id: str) -> dict[str, Any]:
        return self.automation_service.get(automation_id)

    def pick_and_import_automation(self) -> dict[str, Any] | None:
        path = self._show_file_dialog(
            "open",
            filetypes=[("小树自动化", "*.ltauto"), ("JSON", "*.json"), ("所有文件", "*.*")],
        )
        if not path:
            return None
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        document = payload.get("document") if isinstance(payload, dict) and payload.get("format") == "little-tree-automation" else payload
        if not isinstance(document, dict):
            raise ValueError("自动化文件格式无效")
        imported = copy.deepcopy(document)
        imported["id"] = uuid.uuid4().hex
        imported["enabled"] = False
        imported.pop("created_at", None)
        imported.pop("updated_at", None)
        validation = self.automation_service.validate(imported)
        if not validation["valid"]:
            raise ValueError("；".join(validation["errors"]))
        return imported

    def export_automation(self, automation_id: str, export_format: str = "ltauto") -> str | None:
        document = self.automation_service.get(automation_id)
        normalized_format = str(export_format or "ltauto").strip().lower()
        if normalized_format not in {"ltauto", "json"}:
            raise ValueError("自动化导出格式仅支持 ltauto 或 json")
        suffix = f".{normalized_format}"
        safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", str(document.get("name") or "automation")).strip(" .") or "automation"
        path = self._show_file_dialog(
            "save",
            filetypes=[("小树自动化", "*.ltauto"), ("JSON", "*.json")],
            defaultextension=suffix,
            initialfile=f"{safe_name}{suffix}",
        )
        if not path:
            return None
        output = {"format": "little-tree-automation", "version": 1, "document": document} if normalized_format == "ltauto" else document
        Path(path).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def save_automation(self, document: dict[str, Any]) -> dict[str, Any]:
        return self.automation_service.save(document)

    def delete_automation(self, automation_id: str) -> None:
        self.automation_service.delete(automation_id)

    def set_automation_enabled(self, automation_id: str, enabled: bool) -> dict[str, Any]:
        return self.automation_service.set_enabled(automation_id, enabled)

    def validate_automation(self, document: dict[str, Any]) -> dict[str, Any]:
        return self.automation_service.validate(document)

    def run_automation(self, automation_id: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.automation_service.run(automation_id, variables)

    def cancel_automation(self) -> dict[str, Any]:
        return self.automation_service.cancel()

    def get_automation_runtime(self) -> dict[str, Any]:
        return self.automation_service.snapshot()

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
