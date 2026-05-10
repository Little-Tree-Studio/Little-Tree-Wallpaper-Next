from __future__ import annotations

import hashlib
import random
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Iterable

from loguru import logger

from little_tree_wallpaper.services.bing import BingService
from little_tree_wallpaper.services.favorites import FavoriteManager
from little_tree_wallpaper.services.ltws import LTWSService
from little_tree_wallpaper.services.spotlight import SpotlightService
from little_tree_wallpaper.services.wallpaper import WallpaperService
from little_tree_wallpaper.settings import SettingsStore, resolve_bing_market


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
BUILTIN_SOURCES = {"favorites", "bing", "spotlight"}


def _stable_id(prefix: str, raw: str) -> str:
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


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
        self._lock = threading.Lock()
        self._last_run_at: str | None = None
        self._last_item_title: str | None = None
        self._last_error: str | None = None
        self._next_run_at: str | None = None
        self._next_plan_id: str | None = None
        self._next_plan_name: str | None = None
        self._last_plan_id: str | None = None
        self._last_plan_name: str | None = None
        self._sequence_cursors: dict[str, int] = {}
        self._remaining_ids: dict[str, dict[str, Any]] = {}
        self._last_pick_ids: dict[str, str] = {}

    def start(self) -> None:
        self._persist_normalized_config()
        config = self._normalized_config()
        if not self._enabled_plans(config):
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="auto-change", daemon=True)
        self._thread.start()
        logger.info("auto change service started")

    def stop(self) -> None:
        self._stop_event.set()
        self._next_run_at = None
        self._next_plan_id = None
        self._next_plan_name = None
        logger.info("auto change service stopping")

    def reconfigure(self) -> dict[str, Any]:
        self._persist_normalized_config()
        self.stop()
        self.start()
        return self.get_state()

    def shutdown(self) -> None:
        self.stop()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)

    def trigger_once(self, plan_id: str | None = None) -> dict[str, Any]:
        config = self._normalized_config()
        plan = self._resolve_plan_for_trigger(config, plan_id)
        if plan is None:
            self._last_error = "自动换壁纸没有可用的计划"
            return self.get_state()
        with self._lock:
            item = self._pick_wallpaper(plan, config)
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
            self._last_plan_id = str(plan.get("id") or "") or None
            self._last_plan_name = str(plan.get("name") or "") or None
            self._last_error = None
            self._refresh_next_run(config)
            return {**self.get_state(), "last_result": result}

    def get_state(self) -> dict[str, Any]:
        config = self._normalized_config()
        enabled_plans = self._enabled_plans(config)
        primary_plan = enabled_plans[0] if enabled_plans else (config.get("plans", [{}]) or [{}])[0]
        trigger = primary_plan.get("trigger", {}) if isinstance(primary_plan, dict) else {}
        selection = primary_plan.get("selection", {}) if isinstance(primary_plan, dict) else {}
        next_run_at, next_plan = self._compute_next_due_state(config)
        local_sources = [self._serialize_local_source(source) for source in config.get("local_sources", [])]
        return {
            "enabled": bool(enabled_plans),
            "mode": trigger.get("kind", "off") if enabled_plans else "off",
            "interval": int(trigger.get("interval_seconds", 3600)),
            "schedule": trigger.get("time_of_day", "09:00"),
            "strategy": selection.get("mode", "random"),
            "sources": list(primary_plan.get("sources", [])) if isinstance(primary_plan, dict) else [],
            "plans": config.get("plans", []),
            "local_sources": local_sources,
            "running": bool(self._thread and self._thread.is_alive() and not self._stop_event.is_set()),
            "last_run_at": self._last_run_at,
            "last_item_title": self._last_item_title,
            "last_error": self._last_error,
            "last_plan_id": self._last_plan_id,
            "last_plan_name": self._last_plan_name,
            "next_run_at": self._next_run_at or next_run_at,
            "next_plan_id": self._next_plan_id or (str(next_plan.get("id") or "") or None) if next_plan else None,
            "next_plan_name": self._next_plan_name or (str(next_plan.get("name") or "") or None) if next_plan else None,
        }

    def _config(self) -> dict[str, Any]:
        return self.settings.get("wallpaper.auto_change", {}) or {}

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            config = self._normalized_config()
            next_run_at, plan = self._compute_next_due_state(config)
            if plan is None or next_run_at is None:
                self._next_run_at = None
                self._next_plan_id = None
                self._next_plan_name = None
                if self._stop_event.wait(1):
                    break
                continue

            wait_seconds = max(1, self._seconds_until_iso(next_run_at))
            self._next_run_at = next_run_at
            self._next_plan_id = str(plan.get("id") or "") or None
            self._next_plan_name = str(plan.get("name") or "") or None
            if self._stop_event.wait(wait_seconds):
                break

            try:
                self.trigger_once(str(plan.get("id") or "") or None)
            except Exception as exc:
                logger.exception("auto change trigger failed")
                self._last_error = str(exc)

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

    def _seconds_until_iso(self, value: str) -> int:
        try:
            target = datetime.fromisoformat(value.replace("Z", "+00:00"))
            now = datetime.utcnow().astimezone(target.tzinfo)
            return max(1, int((target - now).total_seconds()))
        except Exception:
            return 1

    def _pick_wallpaper(self, plan: dict[str, Any], config: dict[str, Any]) -> dict[str, Any] | None:
        source_refs = self._sanitize_sources(plan.get("sources", []), config) or ["favorites", "bing"]
        source_candidates: list[dict[str, Any]] = []
        for source_ref in source_refs:
            candidate = self._resolve_source_candidate(source_ref, plan, config)
            if candidate is None:
                continue
            candidate["__source_ref"] = source_ref
            source_candidates.append(candidate)

        if not source_candidates:
            return None

        selection = plan.get("selection", {}) if isinstance(plan.get("selection"), dict) else {}
        mode = str(selection.get("mode") or "random")
        source_weights = selection.get("source_weights", {}) if isinstance(selection.get("source_weights"), dict) else {}
        selected = self._choose_item(
            state_key=f"plan-selection:{plan.get('id')}",
            items=source_candidates,
            item_id_getter=lambda item: str(item.get("__source_ref") or item.get("id") or ""),
            strategy=mode,
            weight_getter=lambda item: float(source_weights.get(str(item.get("__source_ref") or ""), 100) or 0),
            avoid_repeats=bool(selection.get("avoid_repeats")),
        )
        if selected is None:
            return None
        selected.pop("__source_ref", None)
        return selected

    def _resolve_source_candidate(
        self,
        source_ref: str,
        plan: dict[str, Any],
        config: dict[str, Any],
    ) -> dict[str, Any] | None:
        pool: list[dict[str, Any]] = []
        if source_ref == "favorites":
            pool = list(self.favorite_manager.list_items().get("items", []))
            return self._choose_builtin_source_item(source_ref, pool)
        if source_ref == "bing":
            pool = self.bing_service.query_daily(
                market=resolve_bing_market(
                    str(self.settings.get("ui.language", "zh-CN")),
                    self.settings.get("wallpaper.bing.market", "auto"),
                ),
                count=8,
            )
            return self._choose_builtin_source_item(source_ref, pool)
        if source_ref == "spotlight":
            pool = self.spotlight_service.list_candidates(limit=8)
            return self._choose_builtin_source_item(source_ref, pool)
        if source_ref.startswith("ltws:"):
            _, source_id, api_name = source_ref.split(":", 2)
            pool = self.ltws_service.execute_api(source_id=source_id, api_name=api_name, parameters={})
            return self._choose_builtin_source_item(source_ref, pool)
        if source_ref.startswith("local:"):
            source_id = source_ref.split(":", 1)[1]
            local_source = self._find_local_source(config, source_id)
            if local_source is None:
                return None
            items = self._list_local_source_items(local_source)
            selection = local_source.get("selection", {}) if isinstance(local_source.get("selection"), dict) else {}
            choice = self._choose_item(
                state_key=f"local-source:{source_id}",
                items=items,
                item_id_getter=lambda item: str(item.get("id") or ""),
                strategy=str(selection.get("mode") or "random"),
                weight_getter=lambda item: float(item.get("metadata", {}).get("auto_change_weight", 100) or 0),
                avoid_repeats=bool(selection.get("avoid_repeats")),
            )
            if choice is None:
                return None
            choice.setdefault("metadata", {})["auto_change_local_source_id"] = source_id
            return choice
        return None

    def _choose_builtin_source_item(
        self,
        source_ref: str,
        pool: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        items = [item for item in pool if item.get("image_url")]
        if not items:
            return None
        return self._choose_item(
            state_key=f"source-candidate:{source_ref}",
            items=items,
            item_id_getter=lambda item: str(item.get("id") or item.get("image_url") or ""),
            strategy="random",
            weight_getter=None,
            avoid_repeats=False,
        )

    def _sanitize_ltws_sources(self, raw_sources: Any) -> list[str]:
        sources = raw_sources if isinstance(raw_sources, list) else []
        valid_source_ids = {
            str(item.get("identifier") or "")
            for item in self.ltws_service.list_sources()
            if not item.get("invalid") and item.get("enabled", True) is not False
        }
        sanitized: list[str] = []
        for item in sources:
            if not isinstance(item, str):
                continue
            if not item.startswith("ltws:"):
                continue
            parts = item.split(":", 2)
            if len(parts) != 3:
                continue
            _, source_id, api_name = parts
            if source_id and api_name and source_id in valid_source_ids:
                sanitized.append(item)
        return sanitized

    def _sanitize_sources(self, raw_sources: Any, config: dict[str, Any]) -> list[str]:
        sources = raw_sources if isinstance(raw_sources, list) else []
        valid_local_source_ids = {
            str(item.get("id") or "")
            for item in config.get("local_sources", [])
            if item.get("enabled", True) is not False and item.get("path")
        }
        sanitized: list[str] = []
        for item in self._sanitize_ltws_sources(sources):
            sanitized.append(item)
        for item in sources:
            if not isinstance(item, str):
                continue
            if item in BUILTIN_SOURCES and item not in sanitized:
                sanitized.append(item)
                continue
            if item.startswith("local:"):
                local_source_id = item.split(":", 1)[1]
                if local_source_id in valid_local_source_ids and item not in sanitized:
                    sanitized.append(item)
        return sanitized

    def _persist_normalized_config(self) -> None:
        raw_config = self._config()
        normalized_config = self._normalized_config(raw_config)
        if raw_config == normalized_config:
            return
        self.settings.set("wallpaper.auto_change", normalized_config)

    def _enabled_plans(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            plan
            for plan in config.get("plans", [])
            if isinstance(plan, dict) and plan.get("enabled") and self._sanitize_sources(plan.get("sources", []), config)
        ]

    def _resolve_plan_for_trigger(
        self,
        config: dict[str, Any],
        plan_id: str | None,
    ) -> dict[str, Any] | None:
        enabled_plans = self._enabled_plans(config)
        if plan_id:
            for plan in enabled_plans:
                if str(plan.get("id") or "") == plan_id:
                    return plan
            return None
        if self._next_plan_id:
            for plan in enabled_plans:
                if str(plan.get("id") or "") == self._next_plan_id:
                    return plan
        return enabled_plans[0] if enabled_plans else None

    def _compute_next_due_state(
        self,
        config: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any] | None]:
        candidates: list[tuple[str, dict[str, Any]]] = []
        for plan in self._enabled_plans(config):
            due_at = self._plan_next_run_at(plan)
            if due_at is None:
                continue
            candidates.append((due_at, plan))
        if not candidates:
            return None, None
        due_at, plan = min(candidates, key=lambda item: item[0])
        return due_at, plan

    def _refresh_next_run(self, config: dict[str, Any]) -> None:
        next_run_at, plan = self._compute_next_due_state(config)
        self._next_run_at = next_run_at
        self._next_plan_id = str(plan.get("id") or "") or None if plan else None
        self._next_plan_name = str(plan.get("name") or "") or None if plan else None

    def _plan_next_run_at(self, plan: dict[str, Any]) -> str | None:
        trigger = plan.get("trigger", {}) if isinstance(plan.get("trigger"), dict) else {}
        kind = str(trigger.get("kind") or "interval")
        if kind == "interval":
            wait_seconds = max(30, int(trigger.get("interval_seconds", 3600) or 3600))
            return (datetime.utcnow() + timedelta(seconds=wait_seconds)).isoformat(timespec="seconds") + "Z"
        if kind == "schedule":
            wait_seconds = self._seconds_until_schedule(str(trigger.get("time_of_day") or "09:00"))
            return (datetime.utcnow() + timedelta(seconds=wait_seconds)).isoformat(timespec="seconds") + "Z"
        return None

    def _normalized_config(self, raw_config: dict[str, Any] | None = None) -> dict[str, Any]:
        config = raw_config if isinstance(raw_config, dict) else self._config()
        raw_local_sources = config.get("local_sources", []) if isinstance(config.get("local_sources", []), list) else []
        normalized_local_sources = [
            item
            for item in (self._normalize_local_source(source) for source in raw_local_sources)
            if item is not None
        ]
        plans = config.get("plans", []) if isinstance(config.get("plans", []), list) else []
        normalized_plans = [
            item
            for item in (self._normalize_plan(plan, normalized_local_sources) for plan in plans)
            if item is not None
        ]
        if not normalized_plans:
            legacy_plan = self._normalize_legacy_plan(config, normalized_local_sources)
            if legacy_plan is not None:
                normalized_plans = [legacy_plan]
        if not normalized_plans:
            normalized_plans = [self._build_default_plan(normalized_local_sources)]
        return {
            "enabled": bool(any(plan.get("enabled") for plan in normalized_plans)),
            "plans": normalized_plans,
            "local_sources": normalized_local_sources,
        }

    def _normalize_legacy_plan(
        self,
        config: dict[str, Any],
        local_sources: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        mode = str(config.get("mode") or "off")
        slideshow = config.get("slideshow", {}) if isinstance(config.get("slideshow"), dict) else {}
        sources = self._sanitize_sources(slideshow.get("sources", []), {"local_sources": local_sources})
        if mode == "off" and not config.get("enabled") and not sources:
            return None
        return {
            "id": _stable_id("plan", "legacy-default"),
            "name": "默认计划",
            "enabled": bool(config.get("enabled")) and mode in {"interval", "schedule"},
            "trigger": {
                "kind": "schedule" if mode == "schedule" else "interval",
                "interval_seconds": max(30, int(config.get("interval", 3600) or 3600)),
                "time_of_day": str(config.get("schedule") or "09:00"),
            },
            "sources": sources or ["favorites", "bing"],
            "selection": {
                "mode": str(slideshow.get("strategy") or "random"),
                "avoid_repeats": False,
                "source_weights": {},
            },
        }

    def _build_default_plan(self, local_sources: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "id": _stable_id("plan", "default"),
            "name": "默认计划",
            "enabled": False,
            "trigger": {
                "kind": "interval",
                "interval_seconds": 3600,
                "time_of_day": "09:00",
            },
            "sources": self._sanitize_sources(["favorites", "bing"], {"local_sources": local_sources}),
            "selection": {
                "mode": "random",
                "avoid_repeats": False,
                "source_weights": {},
            },
        }

    def _normalize_plan(
        self,
        raw_plan: Any,
        local_sources: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        if not isinstance(raw_plan, dict):
            return None
        plan_id = str(raw_plan.get("id") or "").strip() or _stable_id("plan", str(raw_plan.get("name") or random.random()))
        trigger = raw_plan.get("trigger", {}) if isinstance(raw_plan.get("trigger"), dict) else {}
        selection = raw_plan.get("selection", {}) if isinstance(raw_plan.get("selection"), dict) else {}
        normalized = {
            "id": plan_id,
            "name": str(raw_plan.get("name") or "未命名计划").strip() or "未命名计划",
            "enabled": bool(raw_plan.get("enabled", False)),
            "trigger": {
                "kind": "schedule" if str(trigger.get("kind") or "interval") == "schedule" else "interval",
                "interval_seconds": max(30, int(trigger.get("interval_seconds", 3600) or 3600)),
                "time_of_day": self._normalize_time_of_day(str(trigger.get("time_of_day") or "09:00")),
            },
            "sources": self._sanitize_sources(raw_plan.get("sources", []), {"local_sources": local_sources}),
            "selection": {
                "mode": self._normalize_strategy(str(selection.get("mode") or "random")),
                "avoid_repeats": bool(selection.get("avoid_repeats", False)),
                "source_weights": self._normalize_weight_map(selection.get("source_weights", {})),
            },
        }
        return normalized

    def _normalize_local_source(self, raw_source: Any) -> dict[str, Any] | None:
        if not isinstance(raw_source, dict):
            return None
        path = str(raw_source.get("path") or "").strip()
        if not path:
            return None
        source_id = str(raw_source.get("id") or "").strip() or _stable_id("local", path.lower())
        selection = raw_source.get("selection", {}) if isinstance(raw_source.get("selection"), dict) else {}
        return {
            "id": source_id,
            "name": str(raw_source.get("name") or Path(path).name or "本地图片文件夹").strip() or "本地图片文件夹",
            "path": path,
            "enabled": bool(raw_source.get("enabled", True)),
            "selection": {
                "mode": self._normalize_strategy(str(selection.get("mode") or "random")),
                "avoid_repeats": bool(selection.get("avoid_repeats", False)),
                "weights": self._normalize_weight_map(selection.get("weights", {})),
            },
        }

    def _normalize_strategy(self, value: str) -> str:
        if value in {"random", "sequential", "non_repeat_random", "weighted_random"}:
            return value
        return "random"

    def _normalize_time_of_day(self, value: str) -> str:
        try:
            hour_text, minute_text = value.split(":", 1)
            hour = min(23, max(0, int(hour_text)))
            minute = min(59, max(0, int(minute_text)))
            return f"{hour:02d}:{minute:02d}"
        except Exception:
            return "09:00"

    def _normalize_weight_map(self, raw_weights: Any) -> dict[str, float]:
        if not isinstance(raw_weights, dict):
            return {}
        normalized: dict[str, float] = {}
        for key, value in raw_weights.items():
            try:
                normalized[str(key)] = max(0.0, float(value))
            except Exception:
                continue
        return normalized

    def _find_local_source(
        self,
        config: dict[str, Any],
        source_id: str,
    ) -> dict[str, Any] | None:
        for source in config.get("local_sources", []):
            if str(source.get("id") or "") == source_id:
                return source
        return None

    def _serialize_local_source(self, source: dict[str, Any]) -> dict[str, Any]:
        items = self._list_local_source_items(source)
        serialized_items = []
        for item in items:
            serialized_items.append(
                {
                    "id": item.get("id"),
                    "name": item.get("title"),
                    "path": item.get("image_url"),
                    "weight": item.get("metadata", {}).get("auto_change_weight", 100),
                }
            )
        return {
            "id": source.get("id"),
            "name": source.get("name"),
            "path": source.get("path"),
            "enabled": source.get("enabled", True),
            "selection": source.get("selection", {}),
            "item_count": len(serialized_items),
            "items": serialized_items,
        }

    def _list_local_source_items(self, source: dict[str, Any]) -> list[dict[str, Any]]:
        base_path = Path(str(source.get("path") or ""))
        if not base_path.exists() or not base_path.is_dir():
            return []
        selection = source.get("selection", {}) if isinstance(source.get("selection"), dict) else {}
        weight_map = selection.get("weights", {}) if isinstance(selection.get("weights"), dict) else {}
        items: list[dict[str, Any]] = []
        for child in sorted(base_path.iterdir(), key=lambda item: item.name.lower()):
            if not child.is_file() or child.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            file_id = _stable_id("local-file", str(child.resolve()).lower())
            items.append(
                {
                    "id": file_id,
                    "source_id": f"local-folder:{source.get('id')}",
                    "source_name": str(source.get("name") or base_path.name or "本地图片文件夹"),
                    "title": child.stem,
                    "image_url": str(child),
                    "preview_url": str(child),
                    "metadata": {
                        "auto_change_weight": float(weight_map.get(file_id, 100) or 0),
                    },
                }
            )
        return items

    def _choose_item(
        self,
        state_key: str,
        items: list[dict[str, Any]],
        item_id_getter: Callable[[dict[str, Any]], str],
        strategy: str,
        weight_getter: Callable[[dict[str, Any]], float] | None,
        avoid_repeats: bool,
    ) -> dict[str, Any] | None:
        if not items:
            return None
        if len(items) == 1:
            only_item = items[0]
            self._last_pick_ids[state_key] = item_id_getter(only_item)
            return only_item
        if strategy == "sequential":
            cursor = self._sequence_cursors.get(state_key, 0)
            item = items[cursor % len(items)]
            self._sequence_cursors[state_key] = cursor + 1
            self._last_pick_ids[state_key] = item_id_getter(item)
            return item
        if strategy == "non_repeat_random":
            item = self._choose_non_repeat_item(state_key, items, item_id_getter, None)
            if item is not None:
                self._last_pick_ids[state_key] = item_id_getter(item)
            return item
        if strategy == "weighted_random":
            item = self._choose_weighted_item(state_key, items, item_id_getter, weight_getter, avoid_repeats)
            if item is not None:
                self._last_pick_ids[state_key] = item_id_getter(item)
            return item
        item = random.choice(items)
        self._last_pick_ids[state_key] = item_id_getter(item)
        return item

    def _choose_non_repeat_item(
        self,
        state_key: str,
        items: list[dict[str, Any]],
        item_id_getter: Callable[[dict[str, Any]], str],
        weight_getter: Callable[[dict[str, Any]], float] | None,
    ) -> dict[str, Any] | None:
        signature = tuple(sorted(item_id_getter(item) for item in items))
        state = self._remaining_ids.get(state_key)
        if state is None or tuple(state.get("signature", ())) != signature or not state.get("remaining"):
            remaining = [item_id_getter(item) for item in items]
            last_pick_id = self._last_pick_ids.get(state_key)
            if last_pick_id in remaining and len(remaining) > 1:
                remaining.remove(last_pick_id)
                remaining.append(last_pick_id)
            self._remaining_ids[state_key] = {"signature": signature, "remaining": remaining}
            state = self._remaining_ids[state_key]
        remaining_ids = set(state.get("remaining", []))
        available = [item for item in items if item_id_getter(item) in remaining_ids]
        if not available:
            self._remaining_ids.pop(state_key, None)
            return self._choose_non_repeat_item(state_key, items, item_id_getter, weight_getter)
        item = self._weighted_choice(available, weight_getter) if weight_getter else random.choice(available)
        chosen_id = item_id_getter(item)
        state["remaining"] = [value for value in state.get("remaining", []) if value != chosen_id]
        return item

    def _choose_weighted_item(
        self,
        state_key: str,
        items: list[dict[str, Any]],
        item_id_getter: Callable[[dict[str, Any]], str],
        weight_getter: Callable[[dict[str, Any]], float] | None,
        avoid_repeats: bool,
    ) -> dict[str, Any] | None:
        if avoid_repeats:
            return self._choose_non_repeat_item(state_key, items, item_id_getter, weight_getter)
        return self._weighted_choice(items, weight_getter)

    def _weighted_choice(
        self,
        items: list[dict[str, Any]],
        weight_getter: Callable[[dict[str, Any]], float] | None,
    ) -> dict[str, Any]:
        if weight_getter is None:
            return random.choice(items)
        weights = [max(0.0, float(weight_getter(item))) for item in items]
        if sum(weights) <= 0:
            return random.choice(items)
        return random.choices(items, weights=weights, k=1)[0]
