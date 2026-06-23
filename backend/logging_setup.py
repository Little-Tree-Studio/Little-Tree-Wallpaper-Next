"""Centralized loguru file-sink management.

Owns the full and error log sinks so that the *file* log level can be changed at
runtime (the console sink is never touched), and so log files can be counted and
cleared. The chosen file level is persisted in settings and reapplied on start.
"""

from __future__ import annotations

import contextlib
import datetime
import sys
import time
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

# How many files to keep per kind (newest first). Retention is enforced manually
# because loguru's built-in retention does not cross-clean session files when the
# sink path is a concrete (non-templated) filename.
FULL_RETENTION = 5
ERROR_RETENTION = 10

# Handler ids returned by ``logger.add()``; ``None`` until configured.
_full_handler: int | None = None
_error_handler: int | None = None
_current_level: str = DEFAULT_FILE_LEVEL
# Concrete paths of the active log files (known up-front so raw/direct writes
# such as the startup header always target the same file loguru writes to).
_full_path: Path | None = None
_error_path: Path | None = None
# Timestamp of the first configure() call in this process. Log files created
# after this moment belong to the current run and are never removed by retention.
_run_start: datetime.datetime | None = None


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


def _session_paths() -> tuple[Path, Path]:
    """Return fresh, concrete log file paths for this configure() call."""
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")
    return LOG_DIR / f"app_{stamp}.log", LOG_DIR / f"error_{stamp}.log"


def _enforce_retention() -> None:
    """Keep only the newest N historical files per kind, deleting older ones.

    Files that belong to the current application run (the active full/error
    sinks) are never deleted or truncated by retention.
    """
    active = {_full_path, _error_path}
    for pattern, keep in (("app_*.log", FULL_RETENTION), ("error_*.log", ERROR_RETENTION)):
        for f in _iter_log_files(pattern)[keep:]:
            if f in active or _is_current_run_file(f):
                continue
            with contextlib.suppress(OSError):
                f.unlink()


def configure(settings_store: SettingsStore | None = None, level: str | None = None) -> None:
    """(Re)configure the full + error file sinks from the stored level setting.

    Only the file sinks are affected; the default console sink is left alone, so
    changing the level only influences what is *saved to disk*. Pass ``level`` to
    apply an explicit level without re-reading settings (used by
    :func:`set_file_level` so the sinks switch before the persisted setting is
    written).

    Concrete (timestamped) file paths are used so that the active file path is
    known ahead of time and raw writes (e.g. the startup header) always land in
    the same file loguru writes to.
    """
    global _current_level, _full_path, _error_path, _run_start
    store = settings_store or _store()
    if _run_start is None:
        _run_start = datetime.datetime.now()
    resolved = _normalize_level(level) if level else _normalize_level(store.get(SETTINGS_KEY, DEFAULT_FILE_LEVEL))

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    _close_handlers()

    full_path, error_path = _session_paths()
    _full_path = full_path
    _error_path = error_path

    # Full log: keeps every emitted record at or above the chosen level.
    _full_handler = logger.add(
        full_path,
        rotation="00:00",
        level=resolved,
        encoding="utf-8",
    )
    # Dedicated error log: ERROR/CRITICAL only.
    _error_handler = logger.add(
        error_path,
        rotation="00:00",
        level="ERROR",
        encoding="utf-8",
    )
    _current_level = resolved
    _enforce_retention()


def write_raw(text: str) -> None:
    """Write ``text`` directly to the terminal and the full log file.

    This bypasses level filtering (no loguru routing), so content such as the
    startup header always appears on screen and on disk regardless of the
    configured file level. Each call writes a single (possibly multi-line) block.
    """
    block = text if text.endswith("\n") else text + "\n"
    # Terminal: best-effort direct output (console sink is untouched elsewhere).
    with contextlib.suppress(Exception):
        print(block, end="", file=sys.stdout, flush=True)
    # File: append to the same file loguru uses.
    target = _full_path
    if target is not None:
        with contextlib.suppress(OSError), target.open("a", encoding="utf-8") as fh:
            fh.write(block)


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


def _is_current_run_file(path: Path) -> bool:
    """Return True if ``path`` belongs to the current application run."""
    if _run_start is None or _full_path is None or _error_path is None:
        return False
    try:
        return path.samefile(_full_path) or path.samefile(_error_path)
    except OSError:
        return False


def _is_historical_file(path: Path) -> bool:
    """Return True if ``path`` is from a previous application run."""
    if _run_start is None:
        return False
    try:
        mtime = datetime.datetime.fromtimestamp(path.stat().st_mtime)
    except OSError:
        return False
    return mtime < _run_start


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
    """Truncate the current run's log files and delete all historical log files.

    The active sinks are kept open so the current session keeps logging to the
    same files. This avoids creating two new log files every time the user
    clicks "clear". Historical files from previous runs are removed as usual.
    """
    current_files = {p for p in (_full_path, _error_path) if p is not None}

    files = _iter_log_files("*.log")
    removed = 0
    failed: list[Path] = []

    for f in files:
        if _is_current_run_file(f):
            for attempt in range(10):
                try:
                    f.write_text("", encoding="utf-8")
                    break
                except OSError:
                    if attempt == 9:
                        failed.append(f)
                    else:
                        time.sleep(0.05)
            continue

        for attempt in range(10):
            try:
                f.unlink()
                removed += 1
                break
            except OSError:
                if attempt == 9:
                    failed.append(f)
                else:
                    time.sleep(0.05)

    return {"removed": removed, "failed": len(failed), "truncated": len(current_files), **get_log_stats()}
