import json
from pathlib import Path
from typing import Any
from .paths import get_config_dir

DEFAULT_SETTINGS: dict[str, Any] = {
    "metadata": {"version": "2.0.0"},
    "ui": {
        "language": "zh-CN",
        "theme": "system",
        "theme_profile": "default",
        "window_background": "",
        "window_icon": "./assets/icons/icon.ico",
        "hide_on_close": False,
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
        "sources": {"merge_display": False},
    },
    "download": {
        "segment_size_kb": 200,
        "proxy": {"enabled": False, "type": "http", "server": ""},
    },
    "sniff": {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 LittleTreeWallpaper/2.0",
        "referer": "",
        "use_source_as_referer": True,
        "timeout_seconds": 40,
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
        "hitokoto": {
            "region": "domestic",
            "categories": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "k", "l"],
        },
        "zhaoyu": {"catalog": "all", "theme": "all", "author": "all"},
        "custom": {"items": []},
    },
    "im": {"mirror_preference": "mirror_first"},
    "store": {"use_custom_source": False, "custom_source_url": ""},
    "generate": {
        "providers": [],
        "active_provider_id": "",
        "default_size": "1024x1024",
        "default_n": 1,
        "default_response_format": "url",
    },
}

class SettingsStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or get_config_dir() / "config.json"
        self._data: dict[str, Any] = {}
        self.load()

    def load(self) -> None:
        if self.path.exists():
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except Exception:
                self._data = {}
        self._migrate()

    def _migrate(self) -> None:
        def set_defaults(src: dict[str, Any], defaults: dict[str, Any]) -> None:
            for key, value in defaults.items():
                if key not in src:
                    src[key] = value
                elif isinstance(value, dict):
                    if not isinstance(src.get(key), dict):
                        src[key] = value
                    else:
                        set_defaults(src[key], value)
        set_defaults(self._data, DEFAULT_SETTINGS)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)

    def get(self, key: str, default: Any = None) -> Any:
        parts = key.split(".")
        current: Any = self._data
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return default
        return current

    def set(self, key: str, value: Any) -> None:
        parts = key.split(".")
        current = self._data
        for part in parts[:-1]:
            if part not in current:
                current[part] = {}
            current = current[part]
        current[parts[-1]] = value
        self.save()

    def as_dict(self) -> dict[str, Any]:
        return dict(self._data)

    def reset(self) -> None:
        self._data = json.loads(json.dumps(DEFAULT_SETTINGS))
        self.save()

_settings: SettingsStore | None = None

def get_settings_store() -> SettingsStore:
    global _settings
    if _settings is None:
        _settings = SettingsStore()
    return _settings
