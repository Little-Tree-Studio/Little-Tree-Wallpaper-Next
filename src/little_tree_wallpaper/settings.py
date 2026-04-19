from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
from typing import Any

import orjson

from little_tree_wallpaper import __version__


DEFAULT_BING_MARKET = "auto"
DEFAULT_BING_MARKET_BY_LANGUAGE: dict[str, str] = {
    "zh-CN": "zh-CN",
    "en-US": "en-US",
}
RFC5646_TAG_PATTERN = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")


DEFAULT_SETTINGS: dict[str, Any] = {
    "metadata": {"version": __version__},
    "debug": {
        "enabled": False,
        "open_devtools_on_start": True,
    },
    "ui": {
        "language": "zh-CN",
        "theme": "system",
        "theme_profile": "aurora-paper",
        "custom_themes": [],
        "hide_on_close": True,
        "minimize_to_tray": True,
    },
    "updates": {"auto_check": True, "channel": "stable", "proxy": ""},
    "storage": {
        "cache_directory": "",
        "log_directory": "",
        "download_directory": "",
    },
    "wallpaper": {
        "bing": {
            "market": DEFAULT_BING_MARKET,
        },
        "auto_change": {
            "enabled": False,
            "mode": "off",
            "interval": 3600,
            "schedule": "09:00",
            "slideshow": {"strategy": "random", "sources": []},
        },
        "allow_NSFW": False,
        "history_save_copy": True,
        "sources": {"merge_display": True},
    },
    "download": {"segment_size_kb": 512, "proxy": ""},
    "sniff": {
        "user_agent": "LittleTreeWallpaperNext/0.1.0",
        "referer": "",
        "use_source_as_referer": True,
        "timeout_seconds": 15,
    },
    "startup": {
        "auto_start": False,
        "hide_on_launch": False,
        "wallpaper_change": False,
        "wallpaper_change_delay_seconds": 10,
    },
    "home_page": {
        "source": "hitokoto",
        "show_author": True,
        "show_source": True,
        "hitokoto": {"enabled": True},
        "zhaoyu": {"enabled": False},
        "custom": {"text": "今天也给桌面换一张像样的壁纸。", "author": "Little Tree"},
    },
    "im": {"mirror_preference": "auto"},
}


def resolve_bing_market(language: str | None, market: str | None) -> str:
    normalized_language = (language or "").strip()
    normalized_market = (market or "").strip()
    if not normalized_market or normalized_market.lower() == DEFAULT_BING_MARKET:
        return DEFAULT_BING_MARKET_BY_LANGUAGE.get(normalized_language, "en-US")
    if RFC5646_TAG_PATTERN.fullmatch(normalized_market):
        return normalized_market
    return DEFAULT_BING_MARKET_BY_LANGUAGE.get(normalized_language, "en-US")


class SettingsStore:
    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._settings = deepcopy(DEFAULT_SETTINGS)
        self.load()

    def load(self) -> dict[str, Any]:
        if self.file_path.exists():
            data = orjson.loads(self.file_path.read_bytes())
            self._settings = self._deep_merge(deepcopy(DEFAULT_SETTINGS), data)
        else:
            self.save()
        return self._settings

    def save(self) -> None:
        self.file_path.write_bytes(
            orjson.dumps(self._settings, option=orjson.OPT_INDENT_2)
        )

    def snapshot(self) -> dict[str, Any]:
        return deepcopy(self._settings)

    def get(self, path: str, default: Any = None) -> Any:
        current: Any = self._settings
        for segment in path.split("."):
            if not isinstance(current, dict) or segment not in current:
                return default
            current = current[segment]
        return current

    def set(self, path: str, value: Any) -> dict[str, Any]:
        current: dict[str, Any] = self._settings
        parts = path.split(".")
        for segment in parts[:-1]:
            next_value = current.get(segment)
            if not isinstance(next_value, dict):
                next_value = {}
                current[segment] = next_value
            current = next_value
        current[parts[-1]] = value
        self.save()
        return self.snapshot()

    def update_many(self, updates: dict[str, Any]) -> dict[str, Any]:
        for path, value in updates.items():
            self.set(path, value)
        return self.snapshot()

    def _deep_merge(
        self, base: dict[str, Any], override: dict[str, Any]
    ) -> dict[str, Any]:
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(base.get(key), dict):
                base[key] = self._deep_merge(base[key], value)
            else:
                base[key] = value
        return base
