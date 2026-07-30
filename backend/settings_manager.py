import contextlib
import copy
import json
import os
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from loguru import logger

from .app_meta import VERSION
from .paths import get_config_dir

POLLINATIONS_PROVIDER_ID = "pollinations"
POLLINATIONS_PROVIDER: dict[str, Any] = {
    "id": POLLINATIONS_PROVIDER_ID,
    "name": "Pollinations AI",
    "format": "pollinations",
    "endpoint": "https://image.pollinations.ai/prompt",
    "apiKey": "",
    "model": "flux",
    "modelName": "Flux",
}

DEFAULT_SETTINGS: dict[str, Any] = {
    "metadata": {"version": VERSION},
    "ui": {
        "language": "zh-CN",
        "theme": "system",
        "theme_profile": "default",
        "window_background": "",
        "window_icon": "./assets/icons/icon.ico",
        "hide_on_close": True,
        "minimize_to_tray": True,
        "release_webview_on_close": False,
    },
    "updates": {
        "auto_check": True,
        "channel": "stable",
        "proxy": {
            "enabled": False,
            "selected_index": 0,
            "mirrors": [
                "https://www.ghproxy.cn/",
                "https://gh.llkk.cc/",
                "https://gh-proxy.com/",
                "https://github.moeyy.xyz/",
            ],
        },
    },
    "storage": {
        "cache_directory": "",
        "log_directory": "",
        "download_directory": "",
        "favorites_directory": "",
        "clear_cache_after_360_source": True,
        "auto_clear_cache": {"enabled": False, "max_mb": 512},
        "auto_clear_logs": {"enabled": True, "max_files": 20},
        "auto_compress": {"enabled": False, "format": "avif", "quality": 80},
    },
    "wallpaper": {
        "auto_change": {
            "enabled": False,
            "mode": "off",
            "interval": {"value": 30, "unit": "minutes", "list_ids": [], "fixed_image": None},
            "schedule": {"entries": []},
            "slideshow": {"value": 5, "unit": "minutes", "items": []},
        },
        "allow_NSFW": False,
        "history_save_copy": False,
        "history": {"max_items": 200, "preview_items": 20},
        "sources": {"merge_display": True},
        "pixiv": {"include_artwork_tags_in_favorites": True},
    },
    "download": {
        "segment_size_kb": 200,
        "timeout_seconds": 120,
        "concurrent_tasks": 3,
        "proxy": {"enabled": False, "type": "http", "server": ""},
    },
    "sniff": {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 LittleTreeWallpaper/2.0",
        "referer": "",
        "use_source_as_referer": True,
        "timeout_seconds": 40,
        "max_results": 300,
    },
    "startup": {
        "auto_start": False,
        "script": {"enabled": False, "path": ""},
        "hide_on_launch": True,
        "wallpaper_change": {
            "enabled": False,
            "list_ids": [],
            "fixed_image": None,
            "order": "random",
            "delay_seconds": 0,
            "source": "bing",
            "auto_rotation": False,
        },
    },
    "home_page": {
        "source": "hitokoto",
        "show_author": True,
        "show_source": True,
        "wallpaper_refresh_seconds": 30,
        "hitokoto": {
            "region": "domestic",
            "categories": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "k", "l"],
        },
        "zhaoyu": {"catalog": "all", "theme": "all", "author": "all"},
        "custom": {"items": []},
    },
    "create": {
        "show_grid": False,
        "snap_to_guides": True,
        "export_format": "png",
        "jpeg_quality": 92,
    },
    "im": {
        "mirror_preference": "auto",
        "show_disclaimer": True,
        "auto_health_check": True,
    },
    "store": {"use_custom_source": False, "custom_source_url": ""},
    "generate": {
        "providers": [copy.deepcopy(POLLINATIONS_PROVIDER)],
        "active_provider_id": POLLINATIONS_PROVIDER_ID,
        "default_size": "1024x1024",
        "default_n": 1,
        "default_response_format": "url",
        "default_quality": "auto",
        "remember_prompts": True,
        "prompt_history_limit": 12,
        "history_max_items": 100,
    },
}

class SettingsStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or get_config_dir() / "config.json"
        self._data: dict[str, Any] = {}
        self._lock = threading.RLock()
        self._process_lock_state = threading.local()
        self.load()

    def load(self) -> None:
        if self.path.exists():
            try:
                with open(self.path, encoding="utf-8") as f:
                    self._data = json.load(f)
                logger.debug("Settings loaded from {}", self.path)
            except Exception as exc:
                logger.error("Failed to load settings from {}: {}", self.path, exc)
                self._data = {}
        else:
            logger.info("Settings file not found, using defaults: {}", self.path)
        self._migrate()

    def _migrate(self) -> None:
        self._apply_defaults(self._data)

    @staticmethod
    def _apply_defaults(data: dict[str, Any]) -> None:
        def set_defaults(src: dict[str, Any], defaults: dict[str, Any]) -> None:
            for key, value in defaults.items():
                if key not in src:
                    src[key] = copy.deepcopy(value)
                elif isinstance(value, dict):
                    if not isinstance(src.get(key), dict):
                        src[key] = value
                    else:
                        set_defaults(src[key], value)
        set_defaults(data, DEFAULT_SETTINGS)

        if data["im"].get("mirror_preference") not in {"auto", "github", "jsdelivr", "ghproxy"}:
            data["im"]["mirror_preference"] = "auto"

        generate = data["generate"]
        configured = generate.get("providers")
        custom_providers = [
            provider
            for provider in configured if isinstance(provider, dict) and provider.get("id") != POLLINATIONS_PROVIDER_ID
        ] if isinstance(configured, list) else []
        generate["providers"] = [copy.deepcopy(POLLINATIONS_PROVIDER), *custom_providers]
        provider_ids = {provider.get("id") for provider in generate["providers"]}
        if generate.get("active_provider_id") not in provider_ids:
            generate["active_provider_id"] = POLLINATIONS_PROVIDER_ID

    @contextmanager
    def _interprocess_lock(self) -> Iterator[None]:
        depth = getattr(self._process_lock_state, "depth", 0)
        if depth > 0:
            self._process_lock_state.depth = depth + 1
            try:
                yield
            finally:
                self._process_lock_state.depth -= 1
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.path.with_name(self.path.name + ".lock")
        with lock_path.open("a+b") as lock_file:
            if os.name == "nt":
                import msvcrt

                if lock_file.tell() == 0:
                    lock_file.write(b"\0")
                    lock_file.flush()
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
                self._process_lock_state.depth = 1
                try:
                    yield
                finally:
                    self._process_lock_state.depth = 0
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                self._process_lock_state.depth = 1
                try:
                    yield
                finally:
                    self._process_lock_state.depth = 0
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _write_unlocked(self) -> None:
        temporary = self.path.with_name(
            f"{self.path.name}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with temporary.open("w", encoding="utf-8") as file:
                json.dump(self._data, file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())
            for attempt in range(8):
                try:
                    os.replace(temporary, self.path)
                    break
                except PermissionError:
                    if attempt == 7:
                        raise
                    time.sleep(0.02 * (attempt + 1))
        finally:
            with contextlib.suppress(OSError):
                temporary.unlink()

    def _reload_from_disk_unlocked(self) -> None:
        if not self.path.exists():
            return
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Settings root must be an object")
        self._apply_defaults(data)
        self._data = data

    def save(self) -> None:
        try:
            with self._lock, self._interprocess_lock():
                self._write_unlocked()
            logger.debug("Settings saved to {}", self.path)
        except Exception as exc:
            logger.error("Failed to save settings to {}: {}", self.path, exc)
            raise

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self._lock, self._interprocess_lock():
            if getattr(self._process_lock_state, "depth", 0) == 1:
                self._reload_from_disk_unlocked()
            yield

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            parts = key.split(".")
            current: Any = self._data
            for part in parts:
                if isinstance(current, dict) and part in current:
                    current = current[part]
                else:
                    return default
            return copy.deepcopy(current)

    def set(self, key: str, value: Any) -> None:
        self.set_many({key: value})
        logger.info("Setting changed: {}={}", key, value if not isinstance(value, (dict, list)) else "(...)")

    def set_many(self, updates: dict[str, Any]) -> None:
        with self._lock:
            previous = copy.deepcopy(self._data)
            try:
                with self._interprocess_lock():
                    self._reload_from_disk_unlocked()
                    for key, value in updates.items():
                        parts = key.split(".")
                        current = self._data
                        for part in parts[:-1]:
                            if part not in current or not isinstance(current[part], dict):
                                current[part] = {}
                            current = current[part]
                        current[parts[-1]] = value
                    self._apply_defaults(self._data)
                    self._write_unlocked()
            except Exception:
                self._data = previous
                raise

    def replace(self, data: dict[str, Any]) -> None:
        with self._lock:
            previous = copy.deepcopy(self._data)
            try:
                with self._interprocess_lock():
                    replacement = copy.deepcopy(data)
                    self._apply_defaults(replacement)
                    self._data = replacement
                    self._write_unlocked()
            except Exception:
                self._data = previous
                raise

    def as_dict(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._data)

    def reset(self) -> None:
        with self._lock:
            self._data = copy.deepcopy(DEFAULT_SETTINGS)
            with self._interprocess_lock():
                self._write_unlocked()
        logger.info("Settings reset to defaults")

_settings: SettingsStore | None = None

def get_settings_store() -> SettingsStore:
    global _settings
    if _settings is None:
        _settings = SettingsStore()
    return _settings
