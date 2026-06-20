"""Centralized loguru file-sink management.

Owns the full and error log sinks so that the *file* log level can be changed at
runtime (the console sink is never touched), and so log files can be counted and
cleared. The chosen file level is persisted in settings and reapplied on start.
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

from backend.paths import get_cache_dir

if TYPE_CHECKING:
    from backend.settings_manager import SettingsStore

LOG_DIR: Path = get_cache_dir() / "logs"

# Valid loguru levels for the file sink, from most to least verbose.
VALID_LEVELS: tuple[str, ...] = (
    "TRACE",
    "DEBUG",
    "INFO",
    "SUCCESS",
    "WARNING",
    "ERROR",
    "CRITICAL",
)
DEFAULT_FILE_LEVEL = "DEBUG"
SETTINGS_KEY = "logging.file_level"

# Handler ids returned by ``logger.add()``; ``None`` until configured.
_full_handler: int | None = None
_error_handler: int | None = None
_current_level: str = DEFAULT_FILE_LEVEL


def _store() -> SettingsStore:
    from backend.settings_manager import get_settings_store

    return get_settings_store()


def _normalize_level(level: str | None) -> str:
    normalized = str(level or "").upper()
    return normalized if normalized in VALID_LEVELS else DEFAULT_FILE_LEVEL


def _close_handlers() -> None:
    """Remove the file sinks (closing their file handles) if active."""
    global _full_handler, _error_handler
    for handler in (_full_handler, _error_handler):
        if handler is not None:
            with contextlib.suppress(ValueError):
                logger.remove(handler)
    _full_handler = None
    _error_handler = None


def configure(settings_store: SettingsStore | None = None, level: str | None = None) -> None:
    """(Re)configure the full + error file sinks from the stored level setting.

    Only the file sinks are affected; the default console sink is left alone, so
    changing the level only influences what is *saved to disk*. Pass ``level`` to
    apply an explicit level without re-reading settings (used by
    :func:`set_file_level` so the sinks switch before the persisted setting is
    written).
    """
    global _current_level
    store = settings_store or _store()
    resolved = _normalize_level(level) if level else _normalize_level(store.get(SETTINGS_KEY, DEFAULT_FILE_LEVEL))

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    _close_handlers()

    # Full log: keeps every emitted record at or above the chosen level.
    _full_handler = logger.add(
        LOG_DIR / "app_{time}.log",
        rotation="00:00",
        retention=10,
        level=resolved,
        encoding="utf-8",
    )
    # Dedicated error log: ERROR/CRITICAL only, kept longer for triage.
    _error_handler = logger.add(
        LOG_DIR / "error_{time}.log",
        rotation="00:00",
        retention=30,
        level="ERROR",
        encoding="utf-8",
    )
    _current_level = resolved
    logger.info("File logging configured at level {}", resolved)


def get_file_level() -> str:
    return _current_level


def set_file_level(level: str) -> str:
    """Persist and immediately apply a new file log level (console unaffected)."""
    normalized = _normalize_level(level)
    # Reconfigure the sinks first so any log emitted while persisting the
    # setting (e.g. "Setting changed") is written at the new level.
    configure(level=normalized)
    _store().set(SETTINGS_KEY, normalized)
    return normalized


def _iter_log_files(pattern: str = "*.log") -> list[Path]:
    if not LOG_DIR.exists():
        return []
    files = [f for f in LOG_DIR.glob(pattern) if f.is_file()]
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return files


def _count_lines(files: list[Path]) -> int:
    total = 0
    for f in files:
        try:
            with f.open("r", encoding="utf-8", errors="replace") as fh:
                total += sum(1 for _ in fh)
        except OSError:
            pass
    return total


def _total_size(files: list[Path]) -> int:
    total = 0
    for f in files:
        with contextlib.suppress(OSError):
            total += f.stat().st_size
    return total


def get_log_stats() -> dict[str, object]:
    """Return counts/size of log files plus the active file level and options."""
    full_files = _iter_log_files("app_*.log")
    error_files = _iter_log_files("error_*.log")
    all_files = _iter_log_files("*.log")
    return {
        "directory": str(LOG_DIR),
        "file_count": len(all_files),
        "entry_count": _count_lines(full_files),
        "error_count": _count_lines(error_files),
        "size_bytes": _total_size(all_files),
        "level": _current_level,
        "levels": list(VALID_LEVELS),
    }


def clear_logs() -> dict[str, object]:
    """Delete every log file, then reopen fresh sinks at the current level.

    The sinks are closed first so that the active (open) log file can be deleted
    even on Windows, where open file handles block deletion.
    """
    files = _iter_log_files("*.log")
    _close_handlers()
    removed = 0
    for f in files:
        try:
            f.unlink()
            removed += 1
        except OSError as exc:
            logger.debug("Could not remove log file {}: {}", f, exc)
    configure()
    logger.info("Cleared {} log file(s)", removed)
    return {"removed": removed, **get_log_stats()}
