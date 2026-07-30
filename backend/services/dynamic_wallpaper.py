from __future__ import annotations

import contextlib
import mimetypes
import os
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from loguru import logger

SUPPORTED_VIDEO_SUFFIXES = frozenset({".m4v", ".mov", ".mp4", ".webm"})
SUPPORTED_IMAGE_SUFFIXES = frozenset({".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp"})
MODERN_DESKTOP_BUILD = (26100, 1742)


class WindowsDynamicWallpaperService:
    """Experimental pywebview video host attached to Explorer's WorkerW."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._operation_lock = threading.Lock()
        self._diagnostic_lock = threading.Lock()
        self._host_ready = threading.Event()
        self._stop_requested = threading.Event()
        self._pending_scene: tuple[int, str] | None = None
        self._scene_runtime_loaded = False
        self._base_url = ""
        self._api_token = ""
        self._window: Any | None = None
        self._window_handle = 0
        self._workerw_handle = 0
        self._desktop_host_kind = ""
        self._runtime_type = ""
        self._runtime_mode = ""
        self._media_path = ""
        self._media_revision = 0
        self._media_paths: dict[int, str] = {}
        self._started_at = ""
        self._last_error = ""
        self._last_operation = ""
        self._operation_phase = "idle"
        self._operation_started_at = ""
        self._prepared_window_handle = 0
        self._attached = False
        self._telemetry: dict[str, Any] = self._empty_telemetry()
        self._events: deque[dict[str, str]] = deque(maxlen=80)
        self._diagnostic_probe: dict[str, Any] = {
            "windows_version": {
                "major": 0,
                "minor": 0,
                "build": 0,
                "revision": 0,
                "display_version": "",
                "text": os.name,
                "modern_expected": False,
            },
            "topology": {
                "progman": 0,
                "def_view": 0,
                "host": 0,
                "structure": "not_initialized" if os.name == "nt" else "unsupported",
                "label": "桌面宿主尚未探测" if os.name == "nt" else "不支持",
                "reason": "等待首次状态探测" if os.name == "nt" else "当前系统不是 Windows",
            },
            "prepared_window_handle": 0,
            "host_window_valid": False,
            "window_handle": 0,
            "workerw_handle": 0,
            "window": self._empty_window_diagnostics(),
            "media_path": "",
            "media_exists": False,
            "media_size": 0,
            "media_modified_at": "",
        }

    def configure(self, base_url: str, api_token: str, host_window: Any | None = None) -> None:
        with self._lock:
            self._base_url = base_url.rstrip("/")
            self._api_token = api_token
            self._window = host_window
            if host_window is not None:
                host_window.events.before_show += self._on_host_before_show
                host_window.events.closed += self._on_host_closed
            self._record("info", "动态壁纸运行时已就绪")

    def _on_host_before_show(self, *_args: Any) -> None:
        window = self._window
        handle = self._native_handle(window) if window is not None else 0
        with self._lock:
            self._prepared_window_handle = handle
            if handle:
                self._host_ready.set()
                self._record("info", f"预创建播放器宿主已就绪：0x{handle:08X}")

    def _on_host_closed(self, *_args: Any) -> None:
        with self._lock:
            self._host_ready.clear()
            self._prepared_window_handle = 0
            self._window_handle = 0
            self._workerw_handle = 0
            self._attached = False

    def _wait_for_host_handle(self, window: Any, timeout: float = 2.0) -> int:
        deadline = time.monotonic() + max(0.0, timeout)
        while time.monotonic() < deadline:
            self._raise_if_stop_requested()
            with self._lock:
                handle = self._prepared_window_handle
            if not handle:
                handle = self._native_handle(window)
            if handle:
                with self._lock:
                    self._prepared_window_handle = handle
                    self._host_ready.set()
                return handle
            time.sleep(0.02)
        raise RuntimeError("播放器宿主仍在初始化，请稍后重试")

    def _record(self, level: str, message: str) -> None:
        entry = {
            "time": datetime.now().astimezone().isoformat(timespec="seconds"),
            "level": level,
            "message": message,
        }
        self._events.appendleft(entry)
        getattr(logger, level if level in {"debug", "info", "warning", "error"} else "info")(
            "Dynamic wallpaper: {}", message
        )

    @staticmethod
    def _empty_telemetry() -> dict[str, Any]:
        return {
            "received": False,
            "event": "idle",
            "updated_at": "",
            "player_loaded_at": "",
            "media_revision": 0,
            "current_time": 0.0,
            "duration": 0.0,
            "progress": 0.0,
            "paused": True,
            "ended": False,
            "seeking": False,
            "ready_state": 0,
            "network_state": 0,
            "video_width": 0,
            "video_height": 0,
            "buffered_start": 0.0,
            "buffered_end": 0.0,
            "buffered_ranges": 0,
            "muted": True,
            "volume": 1.0,
            "loop": True,
            "playback_rate": 1.0,
            "fps": 0.0,
            "fps_source": "",
            "dropped_frames": 0,
            "total_frames": 0,
            "error_code": 0,
            "error_message": "",
            "visibility": "",
        }

    def _player_url(self, muted: bool, loop: bool, playback_rate: float) -> str:
        query = urlencode(
            {
                "token": self._api_token,
                "muted": "1" if muted else "0",
                "loop": "1" if loop else "0",
                "rate": str(playback_rate),
                "revision": str(self._media_revision),
            }
        )
        return f"{self._base_url}/api/dynamic-wallpaper/player?{query}"

    def scene_url(self, revision: int) -> str:
        route_query = urlencode({"revision": max(0, int(revision))})
        return f"{self._base_url}/?token={self._api_token}#/dynamic/runtime?{route_query}"

    @staticmethod
    def _native_handle(window: Any) -> int:
        native = getattr(window, "native", None)
        handle = getattr(native, "Handle", 0)
        if hasattr(handle, "ToInt64"):
            return int(handle.ToInt64())
        try:
            return int(handle)
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _get_windows_version() -> dict[str, Any]:
        if os.name != "nt":
            return {
                "major": 0,
                "minor": 0,
                "build": 0,
                "revision": 0,
                "display_version": "",
                "text": os.name,
                "modern_expected": False,
            }

        import ctypes
        import winreg

        class RtlOsVersionInfo(ctypes.Structure):
            _fields_ = [
                ("dwOSVersionInfoSize", ctypes.c_ulong),
                ("dwMajorVersion", ctypes.c_ulong),
                ("dwMinorVersion", ctypes.c_ulong),
                ("dwBuildNumber", ctypes.c_ulong),
                ("dwPlatformId", ctypes.c_ulong),
                ("szCSDVersion", ctypes.c_wchar * 128),
            ]

        version = RtlOsVersionInfo()
        version.dwOSVersionInfoSize = ctypes.sizeof(version)
        status = ctypes.windll.ntdll.RtlGetVersion(ctypes.byref(version))
        if status != 0:
            raise OSError(f"RtlGetVersion failed with status {status}")

        revision = 0
        display_version = ""
        try:
            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
            ) as key:
                revision = int(winreg.QueryValueEx(key, "UBR")[0])
                try:
                    display_version = str(winreg.QueryValueEx(key, "DisplayVersion")[0])
                except OSError:
                    display_version = ""
        except OSError as exc:
            logger.debug("Reading Windows build revision failed: {}", exc)

        build = int(version.dwBuildNumber)
        family = "Windows 11" if build >= 22000 else "Windows"
        release = f" {display_version}" if display_version else ""
        return {
            "major": int(version.dwMajorVersion),
            "minor": int(version.dwMinorVersion),
            "build": build,
            "revision": revision,
            "display_version": display_version,
            "text": f"{family}{release} ({build}.{revision})",
            "modern_expected": (build, revision) >= MODERN_DESKTOP_BUILD,
        }

    @staticmethod
    def _inspect_desktop_structure() -> dict[str, Any]:
        if os.name != "nt":
            return {
                "progman": 0,
                "def_view": 0,
                "host": 0,
                "structure": "unsupported",
                "label": "不支持",
                "reason": "当前系统不是 Windows",
            }
        import win32gui

        progman = int(win32gui.FindWindow("Progman", None) or 0)
        modern_def_view = int(win32gui.FindWindowEx(progman, 0, "SHELLDLL_DefView", None) or 0) if progman else 0
        modern_worker = int(win32gui.FindWindowEx(progman, 0, "WorkerW", None) or 0) if progman else 0
        if modern_def_view and modern_worker:
            return {
                "progman": progman,
                "def_view": modern_def_view,
                "host": modern_worker,
                "structure": "modern_child",
                "label": "24H2 子窗口结构",
                "reason": "WorkerW 与 SHELLDLL_DefView 均为 Progman 子窗口",
            }

        legacy_def_view = 0
        legacy_host = 0

        def visit(top_window: int, _lparam: int) -> bool:
            nonlocal legacy_def_view, legacy_host
            shell_view = win32gui.FindWindowEx(top_window, 0, "SHELLDLL_DefView", None)
            if shell_view:
                worker = win32gui.FindWindowEx(0, top_window, "WorkerW", None)
                if worker:
                    legacy_def_view = int(shell_view)
                    legacy_host = int(worker)
                    return False
            return True

        win32gui.EnumWindows(visit, 0)
        if legacy_def_view and legacy_host:
            return {
                "progman": progman,
                "def_view": legacy_def_view,
                "host": legacy_host,
                "structure": "legacy_top_level",
                "label": "传统顶层 WorkerW 结构",
                "reason": "目标 WorkerW 位于 SHELLDLL_DefView 所在顶层窗口之后",
            }
        return {
            "progman": progman,
            "def_view": modern_def_view,
            "host": 0,
            "structure": "not_initialized",
            "label": "桌面宿主尚未生成",
            "reason": "已找到 Progman，但尚未发现可用 WorkerW",
        }

    @classmethod
    def _find_desktop_host(cls, spawn: bool) -> dict[str, Any]:
        if os.name != "nt":
            return cls._inspect_desktop_structure()
        import win32con
        import win32gui

        topology = cls._inspect_desktop_structure()
        progman = int(topology["progman"])
        if topology["host"] or not spawn or not progman:
            return topology

        # Windows 8 through current Windows 11 accept the undocumented 0x052C
        # message. Newer builds create WorkerW inside Progman, while older builds
        # create a top-level WorkerW pair. Probe the resulting topology instead
        # of trusting the version hint alone because 23H2 shipped the new layout
        # behind feature flags on some machines.
        message_variants = ((0, 0), (0x0000000D, 0), (0x0000000D, 1))
        for wparam, lparam in message_variants:
            win32gui.SendMessageTimeout(
                progman,
                0x052C,
                wparam,
                lparam,
                win32con.SMTO_NORMAL,
                1000,
            )
            for _ in range(20):
                topology = cls._inspect_desktop_structure()
                if topology["host"]:
                    return topology
                time.sleep(0.05)
        return topology

    @staticmethod
    def _redraw_desktop_icons(def_view_handle: int) -> None:
        if os.name != "nt" or not def_view_handle:
            return
        import win32con
        import win32gui

        # 24H2 keeps a transition snapshot over SHELLDLL_DefView. Toggling the
        # layer forces every icon to repaint and reveals the child WorkerW below.
        win32gui.ShowWindow(def_view_handle, win32con.SW_HIDE)
        time.sleep(0)
        win32gui.ShowWindow(def_view_handle, win32con.SW_SHOWNORMAL)

    @staticmethod
    def _attach_to_workerw(window_handle: int, workerw_handle: int) -> tuple[int, int]:
        import win32con
        import win32gui

        style = int(win32gui.GetWindowLong(window_handle, win32con.GWL_STYLE))
        style &= ~(
            win32con.WS_POPUP
            | win32con.WS_CAPTION
            | win32con.WS_THICKFRAME
            | win32con.WS_MINIMIZEBOX
            | win32con.WS_MAXIMIZEBOX
            | win32con.WS_SYSMENU
        )
        style |= win32con.WS_CHILD | win32con.WS_VISIBLE
        win32gui.SetWindowLong(window_handle, win32con.GWL_STYLE, style)

        exstyle = int(win32gui.GetWindowLong(window_handle, win32con.GWL_EXSTYLE))
        exstyle &= ~win32con.WS_EX_APPWINDOW
        exstyle |= win32con.WS_EX_TOOLWINDOW | win32con.WS_EX_NOACTIVATE
        win32gui.SetWindowLong(window_handle, win32con.GWL_EXSTYLE, exstyle)
        win32gui.SetParent(window_handle, workerw_handle)

        left, top, right, bottom = win32gui.GetClientRect(workerw_handle)
        width = max(1, int(right - left))
        height = max(1, int(bottom - top))
        win32gui.SetWindowPos(
            window_handle,
            win32con.HWND_BOTTOM,
            0,
            0,
            width,
            height,
            win32con.SWP_FRAMECHANGED | win32con.SWP_NOACTIVATE | win32con.SWP_SHOWWINDOW,
        )
        return width, height

    @staticmethod
    def _empty_window_diagnostics() -> dict[str, Any]:
        return {
            "valid": False,
            "visible": False,
            "parent_matches": False,
            "parent_handle": "",
            "class_name": "",
            "title": "",
            "window_rect": {"left": 0, "top": 0, "width": 0, "height": 0},
            "host_rect": {"left": 0, "top": 0, "width": 0, "height": 0},
        }

    @classmethod
    def _window_diagnostics(
        cls,
        window_handle: int,
        workerw_handle: int,
        running: bool,
    ) -> dict[str, Any]:
        result = cls._empty_window_diagnostics()
        if os.name != "nt" or not running or not window_handle:
            return result
        import win32gui

        try:
            parent = int(win32gui.GetParent(window_handle) or 0)
            left, top, right, bottom = win32gui.GetWindowRect(window_handle)
            host_left, host_top, host_right, host_bottom = win32gui.GetWindowRect(workerw_handle)
            result.update(
                {
                    "valid": True,
                    "visible": bool(win32gui.IsWindowVisible(window_handle)),
                    "parent_matches": parent == workerw_handle,
                    "parent_handle": f"0x{parent:08X}" if parent else "",
                    "class_name": win32gui.GetClassName(window_handle),
                    "title": win32gui.GetWindowText(window_handle),
                    "window_rect": {
                        "left": left,
                        "top": top,
                        "width": max(0, right - left),
                        "height": max(0, bottom - top),
                    },
                    "host_rect": {
                        "left": host_left,
                        "top": host_top,
                        "width": max(0, host_right - host_left),
                        "height": max(0, host_bottom - host_top),
                    },
                }
            )
        except Exception as exc:
            result["error"] = str(exc)
        return result

    def _status_snapshot(self) -> dict[str, Any]:
        with self._lock:
            probe = self._diagnostic_probe
            version = dict(probe["windows_version"])
            topology = dict(probe["topology"])
            prepared_handle = self._prepared_window_handle
            window_handle = self._window_handle
            workerw_handle = self._workerw_handle
            probe_matches_host = probe["prepared_window_handle"] == prepared_handle
            host_window_valid = (
                bool(probe["host_window_valid"])
                if probe_matches_host
                else bool(prepared_handle and self._host_ready.is_set())
            )
            running = bool(self._attached and host_window_valid and self._window_handle)
            media = Path(self._media_path) if self._media_path else None
            probe_matches_media = probe["media_path"] == self._media_path
            media_exists = bool(probe["media_exists"]) if probe_matches_media else False
            media_size = int(probe["media_size"]) if probe_matches_media else 0
            media_modified_at = str(probe["media_modified_at"]) if probe_matches_media else ""
            expected_structure = "modern_child" if version["modern_expected"] else "legacy_top_level"
            detected_structure = str(topology["structure"])
            probed_window = probe["window"]
            window_diagnostics = (
                dict(probed_window)
                if probe["window_handle"] == window_handle and probe["workerw_handle"] == workerw_handle
                else self._empty_window_diagnostics()
            )
            return {
                "supported": os.name == "nt",
                "platform": os.name,
                "windows_version": version,
                "expected_structure": expected_structure,
                "detected_structure": detected_structure,
                "structure_label": topology["label"],
                "structure_reason": topology["reason"],
                "structure_matches_version": detected_structure in {"not_initialized", expected_structure},
                "runtime_ready": bool(self._base_url and self._api_token),
                "host_window_ready": self._host_ready.is_set() and host_window_valid,
                "prepared_window_handle": (f"0x{prepared_handle:08X}" if prepared_handle else ""),
                "operation_busy": self._operation_lock.locked(),
                "operation_phase": self._operation_phase,
                "operation_started_at": self._operation_started_at,
                "explorer_ready": bool(topology["progman"]),
                "workerw_ready": bool(topology["host"]),
                "progman_handle": f"0x{topology['progman']:08X}" if topology["progman"] else "",
                "def_view_handle": f"0x{topology['def_view']:08X}" if topology["def_view"] else "",
                "workerw_handle": (
                    f"0x{(workerw_handle or topology['host']):08X}" if (workerw_handle or topology["host"]) else ""
                ),
                "desktop_host_kind": self._desktop_host_kind,
                "window_handle": f"0x{window_handle:08X}" if window_handle else "",
                "window": window_diagnostics,
                "running": running,
                "dynamic_type": self._runtime_type,
                "runtime_mode": self._runtime_mode,
                "media_path": self._media_path,
                "media_name": media.name if media else "",
                "media_exists": media_exists,
                "media_size": media_size,
                "media_modified_at": media_modified_at,
                "media_content_type": mimetypes.guess_type(media.name)[0] if media else "",
                "media_revision": self._media_revision,
                "started_at": self._started_at,
                "last_error": self._last_error,
                "last_operation": self._last_operation,
                "telemetry": dict(self._telemetry),
                "supported_extensions": sorted(SUPPORTED_VIDEO_SUFFIXES),
                "events": list(self._events),
            }

    def diagnose(self) -> dict[str, Any]:
        # Do not queue probes behind a slow Win32 or filesystem call. Callers can
        # keep rendering the last snapshot while the active probe finishes.
        if self._diagnostic_lock.acquire(blocking=False):
            thread = threading.Thread(
                target=self._run_diagnostic_probe,
                name="dynamic-wallpaper-diagnostics",
                daemon=True,
            )
            try:
                thread.start()
            except Exception as exc:
                self._diagnostic_lock.release()
                logger.warning("Starting dynamic wallpaper diagnostics failed: {}", exc)
        return self._status_snapshot()

    def current_type(self) -> str:
        with self._lock:
            return self._runtime_type

    def _run_diagnostic_probe(self) -> None:
        try:
            with self._lock:
                prepared_handle = self._prepared_window_handle
                window_handle = self._window_handle
                workerw_handle = self._workerw_handle
                attached = self._attached
                media_path = self._media_path

            version = self._get_windows_version()
            topology = self._find_desktop_host(spawn=False)
            host_window_valid = False
            if os.name == "nt" and prepared_handle:
                import win32gui

                host_window_valid = bool(win32gui.IsWindow(prepared_handle))
            running = bool(attached and host_window_valid and window_handle)
            media = Path(media_path) if media_path else None
            try:
                media_stat = media.stat() if media and media.is_file() else None
                media_exists = media_stat is not None
                media_size = media_stat.st_size if media_stat else 0
                media_modified_at = (
                    datetime.fromtimestamp(media_stat.st_mtime).astimezone().isoformat(timespec="seconds")
                    if media_stat
                    else ""
                )
            except OSError:
                media_exists = False
                media_size = 0
                media_modified_at = ""
            window_diagnostics = self._window_diagnostics(window_handle, workerw_handle, running)

            with self._lock:
                if self._prepared_window_handle == prepared_handle and prepared_handle and not host_window_valid:
                    self._host_ready.clear()
                    self._prepared_window_handle = 0
                    self._window_handle = 0
                    self._workerw_handle = 0
                    self._desktop_host_kind = ""
                    self._attached = False
                self._diagnostic_probe = {
                    "windows_version": version,
                    "topology": topology,
                    "prepared_window_handle": prepared_handle,
                    "host_window_valid": host_window_valid,
                    "window_handle": window_handle,
                    "workerw_handle": workerw_handle,
                    "window": window_diagnostics,
                    "media_path": media_path,
                    "media_exists": media_exists,
                    "media_size": media_size,
                    "media_modified_at": media_modified_at,
                }
        except Exception as exc:
            logger.warning("Dynamic wallpaper diagnostics failed: {}", exc)
        finally:
            self._diagnostic_lock.release()

    def start(self, path: str, muted: bool = True, loop: bool = True, playback_rate: float = 1.0) -> dict[str, Any]:
        if not self._operation_lock.acquire(blocking=False):
            raise RuntimeError("动态壁纸操作正在进行，请稍候")
        self._stop_requested.clear()
        with self._lock:
            self._operation_phase = "queued"
            self._operation_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
            self._last_error = ""
        thread = threading.Thread(
            target=self._run_start,
            args=(path, muted, loop, playback_rate),
            name="dynamic-wallpaper-start",
            daemon=True,
        )
        try:
            thread.start()
        except Exception:
            with self._lock:
                self._operation_phase = "idle"
                self._operation_started_at = ""
            self._operation_lock.release()
            raise
        return self._status_snapshot()

    def start_scene(self, revision: int, background_type: str = "image") -> dict[str, Any]:
        if not self._operation_lock.acquire(blocking=False):
            with self._lock:
                self._pending_scene = (max(0, int(revision)), str(background_type))
                self._last_operation = "apply-scene-requested"
            self._record("info", f"已排队动态场景修订 {revision}，将替换当前操作")
            return self._status_snapshot()
        self._stop_requested.clear()
        with self._lock:
            self._pending_scene = None
        with self._lock:
            self._operation_phase = "queued"
            self._operation_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
            self._last_error = ""
        thread = threading.Thread(
            target=self._run_scene_start,
            args=(max(0, int(revision)), str(background_type)),
            name="dynamic-wallpaper-scene-start",
            daemon=True,
        )
        try:
            thread.start()
        except Exception:
            with self._lock:
                self._operation_phase = "idle"
                self._operation_started_at = ""
            self._operation_lock.release()
            raise
        return self._status_snapshot()

    def _run_scene_start(self, revision: int, background_type: str) -> None:
        window: Any | None = None
        try:
            with self._lock:
                self._operation_phase = "validating"
                if os.name != "nt":
                    raise OSError("动态壁纸仅支持 Windows")
                if not self._base_url or not self._api_token:
                    raise RuntimeError("动态壁纸运行时尚未配置")
                window = self._window
                if window is None:
                    raise RuntimeError("播放器宿主未预创建，请重启主程序")
            handle = self._wait_for_host_handle(window)
            with self._lock:
                existing_running = self._attached
                scene_url = self.scene_url(revision)

            if existing_running:
                self._set_operation_phase("switching")
                self._raise_if_stop_requested()
                with self._lock:
                    scene_runtime_loaded = self._scene_runtime_loaded
                if not scene_runtime_loaded:
                    window.load_url(scene_url)
                    self._raise_if_stop_requested()
                    with self._lock:
                        self._scene_runtime_loaded = True
                with self._lock:
                    self._last_operation = "switch-scene"
                    self._runtime_type = background_type
                    self._runtime_mode = "scene"
                    self._media_path = ""
                    self._media_paths.clear()
                    self._telemetry = self._empty_telemetry()
                self._record("info", f"已应用动态场景修订 {revision}")
                return

            self._set_operation_phase("finding-desktop")
            topology = self._find_desktop_host(spawn=True)
            self._raise_if_stop_requested()
            desktop_host = int(topology["host"])
            if not desktop_host:
                raise RuntimeError("发送桌面切换消息后仍未找到可用 WorkerW")
            self._set_operation_phase("loading-player")
            with self._lock:
                scene_runtime_loaded = self._scene_runtime_loaded
            if not scene_runtime_loaded:
                window.load_url(scene_url)
                self._raise_if_stop_requested()
                with self._lock:
                    self._scene_runtime_loaded = True
            self._set_operation_phase("attaching")
            width, height = self._attach_to_workerw(handle, desktop_host)
            self._raise_if_stop_requested()
            if topology["structure"] == "modern_child":
                self._redraw_desktop_icons(int(topology["def_view"]))
            with self._lock:
                self._window_handle = handle
                self._workerw_handle = desktop_host
                self._desktop_host_kind = str(topology["label"])
                self._attached = True
                self._runtime_type = background_type
                self._runtime_mode = "scene"
                self._started_at = datetime.now().astimezone().isoformat(timespec="seconds")
                self._last_operation = "start-scene"
            self._record("info", f"动态场景已附着桌面，画布 {width} x {height}")
        except InterruptedError:
            self._record("info", "动态场景启动已取消")
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
                attached = self._attached
                handle = self._prepared_window_handle
            if os.name == "nt" and handle and not attached:
                import win32con
                import win32gui
                with contextlib.suppress(Exception):
                    win32gui.ShowWindow(handle, win32con.SW_HIDE)
            self._record("error", f"启动动态场景失败：{exc}")
        finally:
            with self._lock:
                self._operation_phase = "stopping" if self._stop_requested.is_set() else "idle"
                self._operation_started_at = ""
            self._operation_lock.release()
            self._finish_requested_stop()
            self._start_pending_scene()

    def _run_start(self, path: str, muted: bool, loop: bool, playback_rate: float) -> None:
        window: Any | None = None
        player_loaded = False
        try:
            with self._lock:
                self._operation_phase = "validating"
                if os.name != "nt":
                    raise OSError("动态壁纸调试宿主仅支持 Windows")
                if not self._base_url or not self._api_token:
                    raise RuntimeError("动态壁纸运行时尚未配置")
                if self._window is None:
                    raise RuntimeError("播放器宿主未预创建，请重启主程序")

            media = Path(path).expanduser().resolve()
            if not media.is_file():
                raise FileNotFoundError(str(media))
            if media.suffix.lower() not in SUPPORTED_VIDEO_SUFFIXES:
                raise ValueError("仅支持 MP4、WebM、MOV 和 M4V 视频")
            rate = max(0.25, min(4.0, float(playback_rate)))

            handle = self._wait_for_host_handle(self._window)

            with self._lock:
                window = self._window
                if window is None or not handle:
                    raise RuntimeError("播放器宿主原生窗口不可用")
                self._last_error = ""
                previous_path = self._media_path
                previous_revision = self._media_revision
                self._media_path = str(media)
                self._media_revision += 1
                revision = self._media_revision
                self._media_paths[revision] = self._media_path
                self._media_paths = dict(sorted(self._media_paths.items())[-4:])
                self._telemetry = self._empty_telemetry()
                self._telemetry["media_revision"] = revision
                player_url = self._player_url(muted, loop, rate)
                existing_running = self._attached

            if existing_running:
                self._set_operation_phase("switching")
                self._record("info", f"正在热切换媒体：{media.name}")
                try:
                    self._raise_if_stop_requested()
                    window.load_url(player_url)
                    self._raise_if_stop_requested()
                except Exception as exc:
                    with self._lock:
                        self._media_paths.pop(revision, None)
                        self._media_path = previous_path
                        self._media_revision = previous_revision
                        self._last_error = str(exc)
                    self._record("error", f"热切换媒体失败：{exc}")
                    raise
                with self._lock:
                    self._last_operation = "switch"
                    self._runtime_type = "video"
                    self._runtime_mode = "raw-video"
                    self._scene_runtime_loaded = False
                self._record("info", f"已向现有宿主发送媒体修订 {revision}")
                return

            self._set_operation_phase("finding-desktop")
            self._record("info", f"正在加载媒体：{media.name}")
            topology = self._find_desktop_host(spawn=True)
            self._raise_if_stop_requested()
            desktop_host = int(topology["host"])
            host_kind = str(topology["label"])
            if not desktop_host:
                raise RuntimeError("发送桌面切换消息后仍未找到可用 WorkerW")
            self._record("info", f"检测到{host_kind}：{topology['reason']}")

            self._set_operation_phase("loading-player")
            window.load_url(player_url)
            player_loaded = True
            self._raise_if_stop_requested()
            self._set_operation_phase("attaching")
            width, height = self._attach_to_workerw(handle, desktop_host)
            self._raise_if_stop_requested()
            if topology["structure"] == "modern_child":
                self._redraw_desktop_icons(int(topology["def_view"]))

            with self._lock:
                self._window_handle = handle
                self._workerw_handle = desktop_host
                self._desktop_host_kind = host_kind
                self._attached = True
                self._runtime_type = "video"
                self._runtime_mode = "raw-video"
                self._scene_runtime_loaded = False
                self._started_at = datetime.now().astimezone().isoformat(timespec="seconds")
                self._last_operation = "start"
            self._record("info", f"已附着 {host_kind}，画布 {width} x {height}")
        except InterruptedError:
            self._record("info", "动态壁纸启动已取消")
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
                handle = self._prepared_window_handle
                attached = self._attached
                if not attached:
                    self._clear_media_state()
            if os.name == "nt" and handle and not attached:
                import win32con
                import win32gui

                with contextlib.suppress(Exception):
                    win32gui.ShowWindow(handle, win32con.SW_HIDE)
            self._record("error", f"启动动态壁纸失败：{exc}")
        finally:
            with self._lock:
                self._operation_phase = "stopping" if self._stop_requested.is_set() else "idle"
                self._operation_started_at = ""
            self._operation_lock.release()
            self._finish_requested_stop()
            self._start_pending_scene()

    def _set_operation_phase(self, phase: str) -> None:
        with self._lock:
            self._operation_phase = phase

    def _raise_if_stop_requested(self) -> None:
        if self._stop_requested.is_set():
            raise InterruptedError("动态壁纸操作已取消")

    def _stop_runtime(self) -> None:
        with self._lock:
            window = self._window
            handle = self._prepared_window_handle
            self._window_handle = 0
            self._workerw_handle = 0
            self._desktop_host_kind = ""
            self._runtime_type = ""
            self._runtime_mode = ""
            self._attached = False
            self._clear_media_state()
        self._hide_native_host(handle)
        with self._lock:
            self._last_operation = "stop"
            self._operation_phase = "idle"
            self._operation_started_at = ""
        self._stop_requested.clear()
        self._record("info", "动态壁纸已停止并释放媒体资源，空白宿主保留待复用")

    @staticmethod
    def _hide_native_host(handle: int) -> None:
        if os.name != "nt" or not handle:
            return
        import win32con
        import win32gui

        with contextlib.suppress(Exception):
            win32gui.ShowWindow(handle, win32con.SW_HIDE)

    def _finish_requested_stop(self) -> None:
        if not self._stop_requested.is_set() or not self._operation_lock.acquire(blocking=False):
            return
        try:
            self._stop_runtime()
        finally:
            self._operation_lock.release()

    def _start_pending_scene(self) -> None:
        with self._lock:
            pending = None if self._stop_requested.is_set() else self._pending_scene
            self._pending_scene = None
        if pending is None:
            return
        revision, background_type = pending
        try:
            self.start_scene(revision, background_type)
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            self._record("error", f"启动排队动态场景失败：{exc}")

    def requires_static_wallpaper_confirmation(self) -> bool:
        """Return whether switching to a static wallpaper interrupts active work."""
        with self._lock:
            return self._attached or self._operation_lock.locked()

    def wait_until_idle(self, timeout: float = 10.0) -> bool:
        deadline = time.monotonic() + max(0.0, timeout)
        while self._operation_lock.locked() and time.monotonic() < deadline:
            time.sleep(0.05)
        return not self._operation_lock.locked()

    @staticmethod
    def _release_player(window: Any | None) -> None:
        if window is None:
            return
        with contextlib.suppress(Exception):
            window.evaluate_js(
                """(() => {
                    const video = document.getElementById('wallpaper');
                    if (video) {
                        video.pause();
                        video.removeAttribute('src');
                        video.load();
                    }
                    window.__ltwPlayer = undefined;
                    return true;
                })()"""
            )
        with contextlib.suppress(Exception):
            window.evaluate_js(
                "window.__ltwDynamicRuntime?.dispose?.(); window.__ltwDynamicRuntime = undefined; true"
            )

    def _clear_media_state(self) -> None:
        self._media_revision += 1
        self._media_path = ""
        self._media_paths.clear()
        self._started_at = ""
        self._runtime_type = ""
        self._runtime_mode = ""
        self._telemetry = self._empty_telemetry()

    def update_telemetry(self, payload: dict[str, Any]) -> None:
        with self._lock:
            if not isinstance(payload, dict):
                return
            try:
                revision = int(payload.get("media_revision", 0))
            except (TypeError, ValueError):
                return
            if not self._attached or revision != self._media_revision:
                return

            event = str(payload.get("event") or "update")[:32]
            previous_event = str(self._telemetry.get("event") or "")
            numeric_fields = {
                "current_time": float,
                "duration": float,
                "progress": float,
                "ready_state": int,
                "network_state": int,
                "video_width": int,
                "video_height": int,
                "buffered_start": float,
                "buffered_end": float,
                "buffered_ranges": int,
                "volume": float,
                "playback_rate": float,
                "fps": float,
                "dropped_frames": int,
                "total_frames": int,
                "error_code": int,
            }
            telemetry = dict(self._telemetry)
            telemetry.update(
                {
                    "received": True,
                    "event": event,
                    "updated_at": datetime.now().astimezone().isoformat(timespec="milliseconds"),
                    "media_revision": revision,
                }
            )
            for key, converter in numeric_fields.items():
                with contextlib.suppress(TypeError, ValueError):
                    telemetry[key] = converter(payload.get(key, telemetry.get(key, 0)))
            for key in ("paused", "ended", "seeking", "muted", "loop"):
                if key in payload:
                    telemetry[key] = bool(payload[key])
            telemetry["error_message"] = str(payload.get("error_message") or "")[:500]
            telemetry["visibility"] = str(payload.get("visibility") or "")[:32]
            telemetry["fps_source"] = str(payload.get("fps_source") or "")[:32]
            if event == "loadedmetadata" and not telemetry["player_loaded_at"]:
                telemetry["player_loaded_at"] = telemetry["updated_at"]
            self._telemetry = telemetry

            significant_events = {
                "loadedmetadata",
                "playing",
                "pause",
                "waiting",
                "stalled",
                "ended",
                "error",
                "emptied",
            }
            if event in significant_events and event != previous_event:
                message = f"播放器事件：{event}"
                if event == "error" and telemetry["error_message"]:
                    message += f" ({telemetry['error_message']})"
                    self._last_error = telemetry["error_message"]
                self._record("error" if event == "error" else "info", message)

    def control(self, action: str) -> dict[str, Any]:
        if not self._operation_lock.acquire(blocking=False):
            raise RuntimeError("动态壁纸操作正在进行，请稍候")
        try:
            with self._lock:
                self._operation_phase = f"control-{str(action).strip().lower()}"
                self._operation_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
                normalized = str(action or "").strip().lower()
                scripts = {
                    "play": "window.__ltwPlayer?.play?.() ?? window.__ltwDynamicRuntime?.play?.()",
                    "pause": "window.__ltwPlayer?.pause?.() ?? window.__ltwDynamicRuntime?.pause?.()",
                    "auto": "window.__ltwPlayer?.auto?.() ?? window.__ltwDynamicRuntime?.auto?.()",
                    "reload": "window.__ltwPlayer?.reload?.() ?? window.__ltwDynamicRuntime?.reload?.()",
                    "next": "window.__ltwDynamicRuntime?.next?.()",
                    "previous": "window.__ltwDynamicRuntime?.previous?.()",
                }
                if normalized not in scripts:
                    raise ValueError("不支持的播放器操作")
                window = self._window
                if window is None or not self._attached:
                    raise RuntimeError("动态壁纸宿主未运行")
                script = scripts[normalized]
            window.evaluate_js(script)
            with self._lock:
                self._last_operation = normalized
            self._record("info", f"已发送播放器操作：{normalized}")
            return self._status_snapshot()
        finally:
            with self._lock:
                self._operation_phase = "stopping" if self._stop_requested.is_set() else "idle"
                self._operation_started_at = ""
            self._operation_lock.release()
            self._finish_requested_stop()

    def stop(self) -> dict[str, Any]:
        self._stop_requested.set()
        with self._lock:
            self._pending_scene = None
            handle = self._prepared_window_handle
            self._attached = False
            self._window_handle = 0
            self._workerw_handle = 0
            self._desktop_host_kind = ""
            self._runtime_type = ""
            self._runtime_mode = ""
        # Always remove the wallpaper from the visible desktop first, even when
        # a start/switch operation still owns the operation lock.
        self._hide_native_host(handle)
        if not self._operation_lock.acquire(blocking=False):
            with self._lock:
                self._operation_phase = "stopping"
                self._operation_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
                self._last_operation = "stop-requested"
            self._record("info", "已请求停止，正在取消当前动态壁纸操作")
            return self._status_snapshot()
        try:
            self._stop_runtime()
        finally:
            self._operation_lock.release()
        return self._status_snapshot()

    def media_file(self, revision: int = 0) -> tuple[Path, str] | None:
        with self._lock:
            selected_path = self._media_paths.get(int(revision)) if revision else self._media_path
        if not selected_path:
            return None
        path = Path(selected_path)
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_VIDEO_SUFFIXES:
            return None
        content_type = mimetypes.guess_type(path.name)[0] or "video/mp4"
        return path, content_type

    def shutdown(self) -> None:
        self._stop_requested.set()
        with self._lock:
            window = self._window
            handle = self._prepared_window_handle
            self._attached = False
            self._window_handle = 0
            self._workerw_handle = 0
            self._desktop_host_kind = ""
            self._runtime_type = ""
            self._runtime_mode = ""
            self._pending_scene = None
        self._hide_native_host(handle)
        # Give in-flight Win32 attachment code a short cancellation window, but
        # never hold application exit hostage to a WebView navigation.
        self.wait_until_idle(timeout=0.5)
        with self._lock:
            self._window = None
            self._scene_runtime_loaded = False
            self._host_ready.clear()
            self._prepared_window_handle = 0
            self._window_handle = 0
            self._workerw_handle = 0
            self._desktop_host_kind = ""
            self._attached = False
            self._clear_media_state()
        if window is not None:
            with contextlib.suppress(Exception):
                window.destroy()
