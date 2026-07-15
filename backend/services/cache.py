from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any

from loguru import logger

from backend.paths import get_cache_dir


class ResponseCache:
    """File-backed JSON cache with TTL, plus a tiny in-memory warm cache.

    A single shared in-memory dict speeds up repeated reads inside one process
    so navigating back and forth in the UI does not even touch the disk. The
    on-disk cache survives across app restarts so opening the window is fast
    on subsequent launches.
    """

    _memory: dict[str, tuple[float, Any]] = {}
    _memory_lock = Lock()

    def __init__(self, namespace: str, default_ttl: float = 3600.0) -> None:
        self.namespace = namespace
        self.default_ttl = default_ttl
        self.dir = get_cache_dir() / "response_cache" / namespace
        self.dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _safe(key: str) -> str:
        return "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in key)

    def _path(self, key: str) -> Path:
        return self.dir / f"{self._safe(key)}.json"

    def _mem_key(self, key: str) -> str:
        return f"{self.namespace}:{key}"

    def get(self, key: str, ttl: float | None = None) -> Any | None:
        """Return cached data if fresh within ttl, otherwise None.

        Pass ttl=-1 to bypass the freshness check (still returns whatever is
        cached, useful as a stale fallback when upstream fails).
        """
        effective_ttl = self.default_ttl if ttl is None else ttl
        mem_key = self._mem_key(key)

        with self._memory_lock:
            entry = self._memory.get(mem_key)
        if entry is not None:
            cached_at, data = entry
            if effective_ttl < 0 or (time.time() - cached_at) <= effective_ttl:
                return data

        path = self._path(key)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning("Cache read failed for {}: {}", self._mem_key(key), exc)
            return None
        cached_at = float(payload.get("cached_at", 0))
        if effective_ttl >= 0 and (time.time() - cached_at) > effective_ttl:
            return None
        data = payload.get("data")
        with self._memory_lock:
            self._memory[mem_key] = (cached_at, data)
        return data

    def get_stale(self, key: str, max_age: float | None = None) -> Any | None:
        """Return stale data, optionally bounded by a maximum age in seconds."""
        return self.get(key, ttl=-1 if max_age is None else max(0.0, max_age))

    def get_same_day(self, key: str, ttl: float | None = None) -> Any | None:
        """Like :meth:`get`, but also requires the cache to have been written
        on the **same calendar day** (local time) as today.

        Useful for sources that rotate once per day (e.g. Bing 每日壁纸):
        after local midnight the cached entry is treated as stale even if
        its age in seconds is still within TTL, forcing a fresh fetch.
        """
        effective_ttl = self.default_ttl if ttl is None else ttl
        mem_key = self._mem_key(key)
        today = datetime.now().date()

        with self._memory_lock:
            entry = self._memory.get(mem_key)
        if entry is not None:
            cached_at, data = entry
            if datetime.fromtimestamp(cached_at).date() < today:
                return None
            if effective_ttl < 0 or (time.time() - cached_at) <= effective_ttl:
                return data

        path = self._path(key)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning("Cache read failed for {}: {}", self._mem_key(key), exc)
            return None
        cached_at = float(payload.get("cached_at", 0))
        if datetime.fromtimestamp(cached_at).date() < today:
            return None
        if effective_ttl >= 0 and (time.time() - cached_at) > effective_ttl:
            return None
        data = payload.get("data")
        with self._memory_lock:
            self._memory[mem_key] = (cached_at, data)
        return data

    def set(self, key: str, data: Any) -> None:
        now = time.time()
        path = self._path(key)
        try:
            path.write_text(
                json.dumps(
                    {"cached_at": now, "data": data},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.warning("Cache write failed for {}: {}", self._mem_key(key), exc)
        mem_key = self._mem_key(key)
        with self._memory_lock:
            self._memory[mem_key] = (now, data)

    def clear(self) -> None:
        logger.info("Clearing response cache for namespace {}", self.namespace)
        cleared_count = 0
        with self._memory_lock:
            for k in list(self._memory):
                if k.startswith(f"{self.namespace}:"):
                    self._memory.pop(k, None)
        for f in self.dir.glob("*.json"):
            try:
                f.unlink()
                cleared_count += 1
            except OSError as exc:
                logger.warning("Cache delete failed for {}: {}", f, exc)
        logger.info("Cleared {} file(s) from response cache namespace {}", cleared_count, self.namespace)
