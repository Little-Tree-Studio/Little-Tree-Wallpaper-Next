"""Detection of competing wallpaper applications.

Wallpaper Engine renders onto the same desktop worker layer this app uses for
dynamic wallpapers. When both run at the same time they fight over that layer,
which typically shows up as a flickering wallpaper or one of the two apps
silently not rendering at all. The frontend surfaces this conflict on startup
and offers to close the other application.
"""

from __future__ import annotations

from typing import Any

try:
    import psutil
except ImportError:  # pragma: no cover - psutil is a required dependency
    psutil = None  # type: ignore[assignment]

# Wallpaper Engine's 32-bit and 64-bit renderer executables.
CONFLICTING_PROCESS_NAMES = frozenset({"wallpaper32.exe", "wallpaper64.exe"})

CONFLICT_APP_LABEL = "壁纸引擎（Wallpaper Engine）"
CONFLICT_DESCRIPTION = (
    "同时运行多款动态壁纸软件会争夺桌面壁纸层，可能导致壁纸冲突、闪烁或显示异常，"
    "建议关闭壁纸引擎后再使用小树壁纸的壁纸功能。"
)

TERMINATE_TIMEOUT_SECONDS = 5.0


def _iter_processes() -> list[Any]:
    """Return a process snapshot, or an empty list when psutil is unavailable."""
    if psutil is None:  # pragma: no cover - defensive
        return []
    return list(psutil.process_iter(["name"]))


def detect_conflicting_processes() -> list[dict[str, Any]]:
    """Return the running processes that conflict with this app.

    Each entry contains the lowercase executable name and the PID, so the
    frontend can show exactly what would be closed.
    """
    conflicts: list[dict[str, Any]] = []
    seen: set[int] = set()
    for process in _iter_processes():
        name = str(process.info.get("name") or "").lower()
        if name not in CONFLICTING_PROCESS_NAMES:
            continue
        try:
            pid = process.pid
        except psutil.NoSuchProcess:  # type: ignore[union-attr]
            continue
        if pid in seen:
            continue
        seen.add(pid)
        conflicts.append({"name": name, "pid": pid})
    conflicts.sort(key=lambda item: item["pid"])
    return conflicts


def _terminate_one(process: Any) -> bool:
    """Terminate a single process; escalate to kill when terminate stalls."""
    try:
        process.terminate()
        process.wait(timeout=TERMINATE_TIMEOUT_SECONDS)
        return True
    except psutil.NoSuchProcess:  # type: ignore[union-attr]
        return True
    except Exception:  # noqa: BLE001 - escalate before giving up
        try:
            process.kill()
            process.wait(timeout=TERMINATE_TIMEOUT_SECONDS)
            return True
        except psutil.NoSuchProcess:  # type: ignore[union-attr]
            return True
        except Exception:  # noqa: BLE001 - report the failure to the caller
            return False


def terminate_conflicting_processes() -> dict[str, Any]:
    """Close every conflicting process and report the outcome.

    Matching is redone at call time (rather than reusing PIDs from an earlier
    detection) so a stale PID can never terminate an unrelated process.
    """
    terminated: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for process in _iter_processes():
        name = str(process.info.get("name") or "").lower()
        if name not in CONFLICTING_PROCESS_NAMES:
            continue
        try:
            pid = process.pid
        except psutil.NoSuchProcess:  # type: ignore[union-attr]
            continue
        entry = {"name": name, "pid": pid}
        if _terminate_one(process):
            terminated.append(entry)
        else:
            failed.append(entry)
    return {
        "terminated": terminated,
        "failed": failed,
        "remaining": detect_conflicting_processes(),
    }
