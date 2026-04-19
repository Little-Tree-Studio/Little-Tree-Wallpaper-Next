from __future__ import annotations

import random
import threading
import time
from datetime import datetime, timedelta
from typing import Any

from loguru import logger

from little_tree_wallpaper.services.bing import BingService
from little_tree_wallpaper.services.favorites import FavoriteManager
from little_tree_wallpaper.services.ltws import LTWSService
from little_tree_wallpaper.services.spotlight import SpotlightService
from little_tree_wallpaper.services.wallpaper import WallpaperService
from little_tree_wallpaper.settings import SettingsStore, resolve_bing_market


class AutoChangeService:
    def __init__(
        self,
        settings: SettingsStore,
        wallpaper_service: WallpaperService,
        favorite_manager: FavoriteManager,
        bing_service: BingService,
        spotlight_service: SpotlightService,
        ltws_service: LTWSService,
    ) -> None:
        self.settings = settings
        self.wallpaper_service = wallpaper_service
        self.favorite_manager = favorite_manager
        self.bing_service = bing_service
        self.spotlight_service = spotlight_service
        self.ltws_service = ltws_service
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._cursor = 0
        self._lock = threading.Lock()
        self._last_run_at: str | None = None
        self._last_item_title: str | None = None
        self._last_error: str | None = None
        self._next_run_at: str | None = None

    def start(self) -> None:
        config = self._config()
        if not config.get("enabled") or config.get("mode") == "off":
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="auto-change", daemon=True)
        self._thread.start()
        logger.info("auto change service started")

    def stop(self) -> None:
        self._stop_event.set()
        logger.info("auto change service stopping")

    def reconfigure(self) -> dict[str, Any]:
        self.stop()
        self.start()
        return self.get_state()

    def shutdown(self) -> None:
        self.stop()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)

    def trigger_once(self) -> dict[str, Any]:
        with self._lock:
            item = self._pick_wallpaper()
            if not item:
                self._last_error = "自动换壁纸没有可用的数据源"
                return self.get_state()
            result = self.wallpaper_service.set_wallpaper(
                image_url=item["image_url"],
                title=item["title"],
                source_id=item["source_id"],
                source_name=item["source_name"],
            )
            self._last_run_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
            self._last_item_title = item["title"]
            self._last_error = None
            self._next_run_at = self._compute_next_run_at()
            return {**self.get_state(), "last_result": result}

    def get_state(self) -> dict[str, Any]:
        config = self._config()
        return {
            "enabled": bool(config.get("enabled")),
            "mode": config.get("mode", "off"),
            "interval": int(config.get("interval", 3600)),
            "strategy": config.get("slideshow", {}).get("strategy", "random"),
            "sources": config.get("slideshow", {}).get("sources", []),
            "running": bool(self._thread and self._thread.is_alive() and not self._stop_event.is_set()),
            "last_run_at": self._last_run_at,
            "last_item_title": self._last_item_title,
            "last_error": self._last_error,
            "next_run_at": self._next_run_at,
        }

    def _config(self) -> dict[str, Any]:
        return self.settings.get("wallpaper.auto_change", {}) or {}

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            config = self._config()
            mode = config.get("mode", "off")
            if not config.get("enabled") or mode == "off":
                self._next_run_at = None
                if self._stop_event.wait(1):
                    break
                continue

            if mode == "interval":
                wait_seconds = max(30, int(config.get("interval", 3600)))
                self._next_run_at = (datetime.utcnow() + timedelta(seconds=wait_seconds)).isoformat(timespec="seconds") + "Z"
                if self._stop_event.wait(wait_seconds):
                    break
                try:
                    self.trigger_once()
                except Exception as exc:
                    logger.exception("auto change trigger failed")
                    self._last_error = str(exc)
                continue

            if mode == "schedule":
                wait_seconds = self._seconds_until_schedule(str(config.get("schedule", "09:00")))
                self._next_run_at = (datetime.utcnow() + timedelta(seconds=wait_seconds)).isoformat(timespec="seconds") + "Z"
                if self._stop_event.wait(wait_seconds):
                    break
                try:
                    self.trigger_once()
                except Exception as exc:
                    logger.exception("scheduled auto change failed")
                    self._last_error = str(exc)
                continue

            if self._stop_event.wait(1):
                break

    def _seconds_until_schedule(self, schedule: str) -> int:
        now = datetime.now()
        hour, minute = 9, 0
        try:
            parts = schedule.split(":", 1)
            hour = int(parts[0])
            minute = int(parts[1])
        except Exception:
            pass
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target = target + timedelta(days=1)
        return max(1, int((target - now).total_seconds()))

    def _compute_next_run_at(self) -> str | None:
        config = self._config()
        if not config.get("enabled"):
            return None
        if config.get("mode") == "interval":
            return (datetime.utcnow() + timedelta(seconds=max(30, int(config.get("interval", 3600))))).isoformat(timespec="seconds") + "Z"
        if config.get("mode") == "schedule":
            return (datetime.utcnow() + timedelta(seconds=self._seconds_until_schedule(str(config.get("schedule", "09:00"))))).isoformat(timespec="seconds") + "Z"
        return None

    def _pick_wallpaper(self) -> dict[str, Any] | None:
        config = self._config()
        sources = config.get("slideshow", {}).get("sources", []) or ["favorites", "bing"]
        strategy = config.get("slideshow", {}).get("strategy", "random")
        pool: list[dict[str, Any]] = []

        for source in sources:
            if source == "favorites":
                pool.extend(self.favorite_manager.list_items().get("items", []))
            elif source == "bing":
                pool.extend(
                    self.bing_service.query_daily(
                        market=resolve_bing_market(
                            str(self.settings.get("ui.language", "zh-CN")),
                            self.settings.get("wallpaper.bing.market", "auto"),
                        ),
                        count=8,
                    )
                )
            elif source == "spotlight":
                pool.extend(self.spotlight_service.list_candidates(limit=8))
            elif isinstance(source, str) and source.startswith("ltws:"):
                _, source_id, api_name = source.split(":", 2)
                pool.extend(self.ltws_service.execute_api(source_id=source_id, api_name=api_name, parameters={}))

        deduped: dict[str, dict[str, Any]] = {item["id"]: item for item in pool if item.get("image_url")}
        items = list(deduped.values())
        if not items:
            return None

        if strategy == "sequential":
            item = items[self._cursor % len(items)]
            self._cursor += 1
            return item
        if strategy == "non_repeat_random" and len(items) > 1:
            self._cursor = (self._cursor + random.randint(1, len(items) - 1)) % len(items)
            return items[self._cursor]
        return random.choice(items)
