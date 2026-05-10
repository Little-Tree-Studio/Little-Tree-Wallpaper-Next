from __future__ import annotations

import base64
import mimetypes
import os
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from loguru import logger
import orjson

from little_tree_wallpaper.display import get_primary_display_resolution
from little_tree_wallpaper.paths import AppPaths
from little_tree_wallpaper.services.bing import BingService
from little_tree_wallpaper.services.auto_change import AutoChangeService
from little_tree_wallpaper.services.favorites import FavoriteManager
from little_tree_wallpaper.services.intelligent_market import IntelligentMarketService
from little_tree_wallpaper.services.ltws import LTWSService
from little_tree_wallpaper.services.plugins import PluginManager
from little_tree_wallpaper.services.sniff import SniffService
from little_tree_wallpaper.services.spotlight import SpotlightService
from little_tree_wallpaper.services.storage import StorageService
from little_tree_wallpaper.services.store import DEFAULT_STORE_URL, StoreService
from little_tree_wallpaper.services.wallpaper import WallpaperService
from little_tree_wallpaper.settings import (
    SettingsStore,
    resolve_bing_market,
    resolve_download_behavior,
)


class AppBridge:
    def __init__(
        self,
        paths: AppPaths,
        settings: SettingsStore,
        bing_service: BingService,
        spotlight_service: SpotlightService,
        wallpaper_service: WallpaperService,
        favorite_manager: FavoriteManager,
        ltws_service: LTWSService,
        intelligent_market_service: IntelligentMarketService,
        storage_service: StorageService,
        store_service: StoreService,
        sniff_service: SniffService,
        plugin_manager: PluginManager,
        auto_change_service: AutoChangeService,
        debug_session_enabled: bool,
        on_debug_settings_changed: Callable[[], None] | None = None,
    ):
        self._paths = paths
        self._settings = settings
        self._bing_service = bing_service
        self._spotlight_service = spotlight_service
        self._wallpaper_service = wallpaper_service
        self._favorite_manager = favorite_manager
        self._ltws_service = ltws_service
        self._intelligent_market_service = intelligent_market_service
        self._storage_service = storage_service
        self._store_service = store_service
        self._sniff_service = sniff_service
        self._plugin_manager = plugin_manager
        self._auto_change_service = auto_change_service
        self._debug_session_enabled = debug_session_enabled
        self._on_debug_settings_changed = on_debug_settings_changed
        self._window = None

    def _attach_window(self, window: Any) -> None:
        self._window = window

    def bootstrap(self) -> dict[str, Any]:
        logger.info("bootstrap frontend state")
        home_bing = self._bing_service.query_daily(
            market=self._resolved_bing_market(),
            count=1,
        )
        runtime = self.runtime_snapshot()
        return {
            "settings": self._settings.snapshot(),
            "favorites": self._favorite_manager.list_items(),
            "history": self._wallpaper_service.list_history(),
            "sources": self._ltws_service.list_sources(),
            "plugins": self._plugin_manager.discover(),
            "runtime": runtime,
            "home": {
                "bing": home_bing[:1],
                "spotlight": self._spotlight_service.list_local_candidates(limit=4),
                "quote": self._resolve_home_quote(),
                "current_wallpaper": self.get_current_wallpaper(),
            },
        }

    def query_bing(
        self,
        category: str = "daily",
        market: str | None = None,
        count: int = 8,
        quality: str = "highDef",
    ) -> list[dict[str, Any]]:
        resolved_market = market or self._resolved_bing_market()
        if category == "recent":
            return self._bing_service.query_recent(
                market=resolved_market, count=count, quality=quality
            )
        return self._bing_service.query_daily(
            market=resolved_market, count=count, quality=quality
        )

    def query_spotlight(
        self, source: str = "local", limit: int = 20, market: str = "zh-CN"
    ) -> list[dict[str, Any]]:
        if source == "online":
            return self._spotlight_service.list_online_candidates(
                limit=limit, market=market
            )
        return self._spotlight_service.list_local_candidates(limit=limit)

    def list_wallpaper_sources(self) -> list[dict[str, Any]]:
        return self._ltws_service.list_sources()

    def set_wallpaper_source_enabled(
        self,
        source_id: str,
        enabled: bool,
    ) -> dict[str, Any]:
        source = self._ltws_service.set_source_enabled(source_id, enabled)
        self._auto_change_service.reconfigure()
        return source

    def delete_wallpaper_source(self, source_id: str) -> dict[str, Any]:
        result = self._ltws_service.delete_source(source_id)
        self._auto_change_service.reconfigure()
        return result

    def execute_wallpaper_source(
        self, source_id: str, api_name: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        return self._ltws_service.execute_api(
            source_id=source_id, api_name=api_name, parameters=parameters
        )

    def list_intelligent_market_sources(
        self, force: bool = False
    ) -> list[dict[str, Any]]:
        return self._intelligent_market_service.list_sources(force=force)

    def check_intelligent_market_sources_health(
        self,
        source_ids: list[str] | None = None,
        force: bool = False,
    ) -> list[dict[str, Any]]:
        return self._intelligent_market_service.check_sources_health(
            source_ids=source_ids,
            force=force,
        )

    def execute_intelligent_market_source(
        self, source_id: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        return self._intelligent_market_service.execute_source(
            source_id=source_id,
            parameters=parameters,
        )

    def toggle_favorite(
        self, wallpaper: dict[str, Any], folder_id: str | None = "default"
    ) -> dict[str, Any]:
        return self._favorite_manager.toggle(wallpaper=wallpaper, folder_id=folder_id)

    def list_favorites(self) -> dict[str, Any]:
        return self._favorite_manager.list_items()

    def create_favorite_folder(
        self, name: str, description: str | None = None
    ) -> dict[str, Any]:
        folder = self._favorite_manager.create_folder(
            name=name, description=description or ""
        )
        favorites = self._favorite_manager.list_items()
        created = next(
            (
                item
                for item in favorites.get("folders", [])
                if item.get("id") == folder.id
            ),
            None,
        )
        return {"folder": created, "favorites": favorites}

    def rename_favorite_folder(
        self,
        folder_id: str,
        name: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        success = self._favorite_manager.rename_folder(
            folder_id,
            name=name,
            description=description,
        )
        return {"success": success, "favorites": self._favorite_manager.list_items()}

    def delete_favorite_folder(
        self,
        folder_id: str,
        move_items_to: str | None = "default",
    ) -> dict[str, Any]:
        success = self._favorite_manager.delete_folder(
            folder_id, move_items_to=move_items_to
        )
        return {"success": success, "favorites": self._favorite_manager.list_items()}

    def move_favorite_item(self, item_id: str, folder_id: str) -> dict[str, Any]:
        success = self._favorite_manager.move_item(item_id, folder_id)
        return {"success": success, "favorites": self._favorite_manager.list_items()}

    def localize_favorite_item(self, item_id: str) -> dict[str, Any]:
        item = self._favorite_manager.get_item(item_id)
        if item is None:
            raise ValueError("收藏不存在")

        self._favorite_manager.update_localization(item_id, status="pending")

        try:
            source_path = item.local_path or item.source.local_path
            if source_path and Path(source_path).exists():
                localized_path = self._favorite_manager.localize_item_from_file(
                    item_id, source_path
                )
            else:
                image_url = item.source.url or item.preview_url
                if not image_url:
                    raise RuntimeError("未找到可用于本地化的资源地址")
                metadata = dict(item.extra.get("wallpaper_metadata") or {})
                downloaded_path = self._wallpaper_service.download(
                    image_url,
                    suggested_name=item.title,
                    metadata=metadata,
                )
                localized_path = self._favorite_manager.localize_item_from_file(
                    item_id, str(downloaded_path)
                )

            if localized_path is None:
                raise RuntimeError("本地化收藏失败")

            return {
                "local_path": str(localized_path),
                "favorites": self._favorite_manager.list_items(),
            }
        except Exception as exc:
            self._favorite_manager.update_localization(
                item_id,
                status="failed",
                message=str(exc),
            )
            raise

    def reset_favorite_localization(self, item_id: str) -> dict[str, Any]:
        success = self._favorite_manager.reset_localization(item_id)
        return {"success": success, "favorites": self._favorite_manager.list_items()}

    def import_favorites(self) -> dict[str, Any] | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=("Favorites Package (*.ltwfav;*.zip;*.json)",),
        )
        source_path = self._dialog_result_path(selected)
        if not source_path:
            return None
        created_folders, imported_items = self._favorite_manager.import_folders(
            Path(source_path)
        )
        return {
            "created_folders": created_folders,
            "imported_items": imported_items,
            "favorites": self._favorite_manager.list_items(),
        }

    def export_favorites(
        self,
        folder_ids: list[str] | None = None,
        item_ids: list[str] | None = None,
        include_assets: bool = True,
    ) -> dict[str, Any] | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename="favorites.ltwfav",
            file_types=("Favorites Package (*.ltwfav)",),
        )
        target_path = self._dialog_result_path(selected)
        if not target_path:
            return None
        result = self._favorite_manager.export_selection(
            Path(target_path),
            folder_ids=folder_ids,
            item_ids=item_ids,
            include_assets=include_assets,
        )
        result["favorites"] = self._favorite_manager.list_items()
        return result

    def import_theme(self) -> dict[str, Any] | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=("Little Tree Theme (*.ltwtheme;*.json)",),
        )
        source_path = self._dialog_result_path(selected)
        if not source_path:
            return None
        payload = orjson.loads(Path(source_path).read_bytes())
        if not isinstance(payload, dict):
            raise ValueError("主题文件格式无效")
        return payload

    def export_theme(
        self,
        theme_document: dict[str, Any],
        suggested_name: str | None = None,
    ) -> dict[str, Any] | None:
        if self._window is None:
            return None
        metadata = theme_document.get("metadata")
        metadata_name = ""
        if isinstance(metadata, dict):
            metadata_name = str(metadata.get("name") or "")
        save_filename = self._sanitize_export_filename(
            suggested_name or metadata_name or "theme"
        )
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=save_filename,
            file_types=("Little Tree Theme (*.ltwtheme)",),
        )
        target_path = self._dialog_result_path(selected)
        if not target_path:
            return None
        target = Path(target_path)
        if target.suffix.lower() != ".ltwtheme":
            target = target.with_suffix(".ltwtheme")
        target.write_bytes(orjson.dumps(theme_document, option=orjson.OPT_INDENT_2))
        return {"saved_path": str(target)}

    def pick_theme_asset(self, asset_kind: str = "image") -> dict[str, Any] | None:
        if self._window is None:
            return None

        normalized_kind = (asset_kind or "image").strip().lower()
        if normalized_kind == "video":
            file_types = ("Theme Video (*.mp4;*.webm;*.mov;*.m4v;*.avi)",)
        elif normalized_kind == "poster":
            file_types = ("Theme Poster (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif)",)
        else:
            file_types = ("Theme Image (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif)",)

        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=file_types,
        )
        selected_path = self._dialog_result_path(selected)
        if not selected_path:
            return None
        return {"path": selected_path}

    def read_theme_asset(self, asset_ref: str) -> dict[str, Any] | None:
        asset_path = self._resolve_local_theme_asset_path(asset_ref)
        if asset_path is None or not asset_path.exists() or not asset_path.is_file():
            return None

        mime_type, _ = mimetypes.guess_type(str(asset_path))
        payload = base64.b64encode(asset_path.read_bytes()).decode("ascii")
        return {
            "path": str(asset_path),
            "name": asset_path.name,
            "mime_type": mime_type or "application/octet-stream",
            "data_base64": payload,
        }

    def add_local_images_to_favorites(
        self,
        folder_id: str | None = "default",
    ) -> dict[str, Any] | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=("Local Images (*.png;*.jpg;*.jpeg;*.bmp;*.webp;*.gif)",),
        )
        if not selected:
            return None
        added_count, favorites = self._favorite_manager.add_local_images(
            [str(path) for path in selected],
            folder_id=folder_id or "default",
        )
        return {
            "added_count": added_count,
            "favorites": favorites,
        }

    def get_storage_overview(self) -> dict[str, Any]:
        return self._storage_service.get_overview()

    def pick_download_directory(self) -> dict[str, Any] | None:
        if self._window is None:
            return None
        current_directory = str(
            self._settings.get(
                "storage.download_directory",
                str(self._storage_service.default_download_directory()),
            )
        )
        selected = self._window.create_file_dialog(
            webview.FileDialog.FOLDER,
            directory=current_directory,
            allow_multiple=False,
        )
        selected_path = self._dialog_result_path(selected)
        if not selected_path:
            return None
        return {"path": selected_path}

    def pick_auto_change_local_folder(self) -> dict[str, Any] | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.FOLDER,
            allow_multiple=False,
        )
        selected_path = self._dialog_result_path(selected)
        if not selected_path:
            return None
        return {"path": selected_path}

    def set_download_directory(self, directory: str | None = None) -> dict[str, Any]:
        resolved_directory = self._storage_service.resolve_download_directory(
            directory,
            fallback_to_default=True,
        )
        self._wallpaper_service.set_download_dir(resolved_directory)
        snapshot = self._settings.update_many(
            {"storage.download_directory": str(resolved_directory)}
        )
        return {
            "settings": snapshot,
            "storage": self._storage_service.get_overview(),
        }

    def open_storage_target(self, target_id: str) -> dict[str, Any]:
        target = self._storage_service.target_directory(target_id)
        target.mkdir(parents=True, exist_ok=True)
        self._open_path(target)
        return {"opened_path": str(target)}

    def clear_storage_targets(
        self, target_ids: list[str] | None = None
    ) -> dict[str, Any]:
        return self._storage_service.clear_targets(target_ids or [])

    def optimize_storage_targets(
        self,
        target_ids: list[str] | None = None,
        quality: int = 78,
    ) -> dict[str, Any]:
        return self._storage_service.optimize_targets(target_ids or [], quality)

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        normalized_updates = dict(updates)
        if "storage.download_directory" in normalized_updates:
            resolved_directory = self._storage_service.resolve_download_directory(
                normalized_updates.get("storage.download_directory"),
                fallback_to_default=True,
            )
            self._wallpaper_service.set_download_dir(resolved_directory)
            normalized_updates["storage.download_directory"] = str(resolved_directory)
        if "storage.download_behavior" in normalized_updates:
            normalized_updates["storage.download_behavior"] = resolve_download_behavior(
                normalized_updates.get("storage.download_behavior")
            )

        snapshot = self._settings.update_many(normalized_updates)
        if any(path.startswith("wallpaper.auto_change") for path in updates) or any(
            path.startswith("startup.") for path in updates
        ):
            self._auto_change_service.reconfigure()
        if (
            any(path.startswith("debug.") for path in updates)
            and self._on_debug_settings_changed
        ):
            self._on_debug_settings_changed()
        return snapshot

    def set_wallpaper(self, wallpaper: dict[str, Any]) -> dict[str, Any]:
        return self._wallpaper_service.set_wallpaper(
            image_url=wallpaper["image_url"],
            title=wallpaper["title"],
            source_id=wallpaper["source_id"],
            source_name=wallpaper["source_name"],
            metadata=wallpaper.get("metadata"),
        )

    def download_wallpaper(self, wallpaper: dict[str, Any]) -> dict[str, Any] | None:
        image_url = wallpaper["image_url"]
        title = wallpaper["title"]
        metadata = wallpaper.get("metadata")
        should_prompt = self._wallpaper_service.is_local_resource(
            image_url
        ) or self._resolved_download_behavior() == "prompt"

        if should_prompt:
            target_path = self._pick_wallpaper_save_path(wallpaper)
            if not target_path:
                return None
            local_path = self._wallpaper_service.save_as(
                image_url,
                Path(target_path),
                title,
                metadata=metadata,
            )
        else:
            local_path = self._wallpaper_service.download(
                image_url,
                title,
                metadata=metadata,
            )
        return {"local_path": str(local_path)}

    def get_current_wallpaper(self) -> dict[str, Any] | None:
        return self._wallpaper_service.get_current_wallpaper()

    def record_current_wallpaper(self) -> dict[str, Any] | None:
        return self._wallpaper_service.record_current_wallpaper()

    def load_store(self, base_url: str | None = DEFAULT_STORE_URL) -> dict[str, Any]:
        return self._store_service.list_resources(base_url=base_url)

    def list_store_resources(
        self,
        resource_type: str = "theme",
        base_url: str | None = DEFAULT_STORE_URL,
    ) -> list[dict[str, Any]]:
        return self._store_service.list_store_resources(
            resource_type=resource_type,
            base_url=base_url,
        )

    def get_store_resource(
        self,
        resource_type: str = "theme",
        filename: str = "",
        base_url: str | None = DEFAULT_STORE_URL,
    ) -> dict[str, Any] | None:
        return self._store_service.get_store_resource(
            resource_type=resource_type,
            filename=filename,
            base_url=base_url,
        )

    def sniff_images(self, url: str) -> list[dict[str, Any]]:
        return self._sniff_service.sniff_images(
            url=url,
            user_agent=self._settings.get(
                "sniff.user_agent", "LittleTreeWallpaperNext/0.1.0"
            ),
            timeout_seconds=int(self._settings.get("sniff.timeout_seconds", 15)),
        )

    def list_plugins(self) -> list[dict[str, Any]]:
        return self._plugin_manager.discover()

    def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> list[dict[str, Any]]:
        return self._plugin_manager.set_enabled(plugin_id, enabled)

    def pick_and_import_source(self) -> dict[str, Any] | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=("Wallpaper Source (*.ltws;*.json;*.toml;*.yaml;*.yml)",),
        )
        source_path = self._dialog_result_path(selected)
        if not source_path:
            return None
        return self._ltws_service.import_source(source_path)

    def import_wallpaper_source_as_draft(self) -> dict[str, Any] | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=("APICORE / OpenAPI (*.json;*.toml;*.yaml;*.yml)",),
        )
        source_path = self._dialog_result_path(selected)
        if not source_path:
            return None
        return self._ltws_service.import_source_as_payload(source_path)

    def create_wallpaper_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._ltws_service.create_source(payload)

    def export_wallpaper_source(
        self,
        source_id: str,
        suggested_name: str | None = None,
    ) -> dict[str, Any] | None:
        if self._window is None:
            return None
        base_name = re.sub(r'[\\/:*?"<>|]+', '-', suggested_name or source_id).strip().strip('.')
        if not base_name:
            base_name = 'wallpaper-source'
        if not base_name.lower().endswith('.ltws'):
            base_name = f'{base_name}.ltws'
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=base_name,
            file_types=("Wallpaper Source Package (*.ltws)",),
        )
        target_path = self._dialog_result_path(selected)
        if not target_path:
            return None
        return self._ltws_service.export_source(source_id, target_path)

    def export_wallpaper_source_payload(
        self,
        payload: dict[str, Any],
        export_format: str,
        suggested_name: str | None = None,
        export_options: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if self._window is None:
            return None
        normalized_format = str(export_format or "").strip().lower()
        if normalized_format == "apicore_v1":
            default_name = self._sanitize_named_export_filename(suggested_name or "wallpaper-source", ".json")
            file_types = ("APICORE v1 (*.json)",)
        elif normalized_format == "apicore_v2":
            default_name = self._sanitize_named_export_filename(suggested_name or "wallpaper-source", ".json")
            file_types = ("APICORE v2 (*.json;*.yaml;*.yml;*.toml)",)
        elif normalized_format == "openapi_3_2":
            default_name = self._sanitize_named_export_filename(suggested_name or "wallpaper-source", ".yaml")
            file_types = ("OpenAPI 3.2 (*.yaml;*.yml;*.json)",)
        else:
            raise ValueError("不支持的导出格式")
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=default_name,
            file_types=file_types,
        )
        target_path = self._dialog_result_path(selected)
        if not target_path:
            return None
        return self._ltws_service.export_payload(payload, normalized_format, target_path, export_options)

    def _dialog_result_path(self, selected: Any) -> str | None:
        if not selected:
            return None
        if isinstance(selected, (list, tuple)):
            if not selected:
                return None
            return str(selected[0])
        return str(selected)

    def _sanitize_export_filename(self, value: str) -> str:
        base_name = re.sub(r'[\\/:*?"<>|]+', "-", value).strip().strip(".")
        if not base_name:
            base_name = "theme"
        if not base_name.lower().endswith(".ltwtheme"):
            base_name = f"{base_name}.ltwtheme"
        return base_name

    def _sanitize_named_export_filename(self, value: str, suffix: str) -> str:
        base_name = re.sub(r'[\\/:*?"<>|]+', "-", value).strip().strip(".")
        if not base_name:
            base_name = "wallpaper-source"
        if not base_name.lower().endswith(suffix.lower()):
            base_name = f"{base_name}{suffix}"
        return base_name

    def _pick_wallpaper_save_path(self, wallpaper: dict[str, Any]) -> str | None:
        if self._window is None:
            return None
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=self._suggest_wallpaper_save_filename(wallpaper),
            file_types=(
                "Image Files (*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.gif;*.avif;*.tif;*.tiff)",
            ),
        )
        return self._dialog_result_path(selected)

    def _suggest_wallpaper_save_filename(self, wallpaper: dict[str, Any]) -> str:
        raw_title = str(wallpaper.get("title") or "").strip() or "wallpaper"
        suffix = self._infer_wallpaper_filename_suffix(
            str(wallpaper.get("image_url") or ""),
            str(wallpaper.get("preview_url") or ""),
        )
        base_name = re.sub(r'[\\/:*?"<>|]+', "-", raw_title).strip().strip(".")
        if not base_name:
            base_name = "wallpaper"
        if suffix and not base_name.lower().endswith(suffix.lower()):
            return f"{base_name}{suffix}"
        return base_name

    def _infer_wallpaper_filename_suffix(self, *candidates: str) -> str:
        for candidate in candidates:
            raw = str(candidate or "").strip()
            if not raw:
                continue
            if raw.startswith("data:"):
                mime_part = raw[5:].split(",", 1)[0]
                mime_type, *_ = mime_part.split(";")
                guessed = mimetypes.guess_extension(mime_type or "image/png")
                if guessed == ".jpe":
                    return ".jpg"
                if guessed:
                    return guessed
                continue
            if re.match(r"^[A-Za-z]:[\\/]", raw) or raw.startswith("\\\\"):
                suffix = Path(raw).suffix.lower()
                if suffix:
                    return ".jpg" if suffix == ".jpe" else suffix
                continue
            parsed = urlparse(raw)
            if parsed.scheme == "file":
                suffix = Path(unquote(parsed.path or "")).suffix.lower()
                if suffix:
                    return ".jpg" if suffix == ".jpe" else suffix
                continue
            suffix = Path(unquote(parsed.path or "")).suffix.lower()
            if suffix:
                return ".jpg" if suffix == ".jpe" else suffix
        return ".jpg"

    def _resolve_local_theme_asset_path(self, asset_ref: str | None) -> Path | None:
        raw = str(asset_ref or "").strip()
        if not raw:
            return None
        if re.match(r"^(https?:|data:|blob:)", raw, flags=re.IGNORECASE):
            return None
        if raw.lower().startswith("file:"):
            parsed = urlparse(raw)
            if parsed.scheme.lower() != "file":
                return None
            decoded_path = unquote(parsed.path or "")
            if re.match(r"^/[A-Za-z]:", decoded_path):
                decoded_path = decoded_path[1:]
            if parsed.netloc and not re.match(r"^[A-Za-z]:", decoded_path):
                decoded_path = f"//{parsed.netloc}{decoded_path}"
            return Path(decoded_path)
        if raw.startswith("\\") or re.match(r"^[A-Za-z]:[\\/]", raw):
            return Path(raw)
        return None

    def _resolved_bing_market(self) -> str:
        return resolve_bing_market(
            str(self._settings.get("ui.language", "zh-CN")),
            self._settings.get("wallpaper.bing.market", "auto"),
        )

    def _resolved_download_behavior(self) -> str:
        return resolve_download_behavior(
            self._settings.get("storage.download_behavior", "directory")
        )

    def list_history(self) -> list[dict[str, Any]]:
        return self._wallpaper_service.list_history()

    def read_debug_log(self, lines: int = 240) -> dict[str, Any]:
        log_path = self._paths.log_dir / "app.log"
        requested_lines = max(20, min(int(lines), 2000))
        if not log_path.exists():
            return {
                "path": str(log_path),
                "content": "",
                "truncated": False,
                "lines": 0,
            }
        all_lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        visible_lines = all_lines[-requested_lines:]
        return {
            "path": str(log_path),
            "content": "\n".join(visible_lines),
            "truncated": len(all_lines) > len(visible_lines),
            "lines": len(visible_lines),
        }

    def open_debug_log_directory(self) -> dict[str, Any]:
        self._open_path(self._paths.log_dir)
        return {"opened_path": str(self._paths.log_dir)}

    def open_debug_log_file(self) -> dict[str, Any]:
        log_path = self._paths.log_dir / "app.log"
        log_path.touch(exist_ok=True)
        self._open_path(log_path)
        return {"opened_path": str(log_path)}

    def runtime_snapshot(self) -> dict[str, Any]:
        return {
            "auto_change": self._auto_change_service.get_state(),
            "debug": {
                "enabled": bool(self._settings.get("debug.enabled", False)),
                "session_enabled": self._debug_session_enabled,
                "open_devtools_on_start": bool(
                    self._settings.get("debug.open_devtools_on_start", True)
                ),
                "log_file": str(self._paths.log_dir / "app.log"),
                "log_directory": str(self._paths.log_dir),
            },
            "window": {
                "hide_on_close": bool(self._settings.get("ui.hide_on_close", True)),
                "minimize_to_tray": bool(
                    self._settings.get("ui.minimize_to_tray", True)
                ),
            },
            "display": get_primary_display_resolution(),
        }

    def trigger_auto_change_now(self, plan_id: str | None = None) -> dict[str, Any]:
        return self._auto_change_service.trigger_once(plan_id)

    def _open_path(self, target: Path) -> None:
        logger.info("open debug path: {}", target)
        if sys.platform.startswith("win"):
            os.startfile(str(target))  # type: ignore[attr-defined]
            return
        if sys.platform == "darwin":
            subprocess.run(["open", str(target)], check=True)
            return
        subprocess.run(["xdg-open", str(target)], check=True)

    def _resolve_home_quote(self) -> dict[str, str]:
        custom_quote = self._settings.get(
            "home_page.custom.text", "今天也给桌面换一张像样的壁纸。"
        )
        custom_author = self._settings.get("home_page.custom.author", "Little Tree")
        return {
            "text": custom_quote,
            "author": custom_author,
            "source": self._settings.get("home_page.source", "custom"),
        }


import webview  # noqa: E402
