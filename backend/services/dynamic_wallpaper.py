from __future__ import annotations

import contextlib
import ctypes
import mimetypes
import os
import threading
import time
from collections import deque
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from loguru import logger

from backend.services.sys_wallpaper import set_wallpaper as set_sys_wallpaper

SUPPORTED_VIDEO_SUFFIXES = frozenset({".m4v", ".mov", ".mp4", ".webm"})
SUPPORTED_IMAGE_SUFFIXES = frozenset({".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp"})
MODERN_DESKTOP_BUILD = (26100, 1742)
PERFORMANCE_ACTIONS = frozenset({"keep_running", "mute", "pause", "stop"})
PERFORMANCE_CONDITIONS = (
    "other_application_focused",
    "other_application_maximized",
    "other_application_fullscreen",
    "other_application_audio",
    "on_battery",
)
STATIC_SNAPSHOT_INTERVAL_SECONDS = 5 * 60
STATIC_SNAPSHOT_SETTLE_SECONDS = 1.0


class WindowsDynamicWallpaperService:
    """Experimental LumiView video host attached to Explorer's WorkerW."""

    def __init__(
        self,
        performance_settings: Callable[[], dict[str, Any]] | None = None,
        static_snapshot_enabled: Callable[[], bool] | None = None,
        static_snapshot_path: Path | None = None,
    ) -> None:
        self._lock = threading.RLock()
        self._operation_lock = threading.Lock()
        self._diagnostic_lock = threading.Lock()
        self._host_ready = threading.Event()
        self._stop_requested = threading.Event()
        self._pending_scene: tuple[int, str] | None = None
        self._scene_runtime_loaded = False
        self._base_url = ""
        self._api_token = ""
        self._runtime_factory: Callable[..., Any] | None = None
        self._performance_settings = performance_settings or (lambda: {})
        self._static_snapshot_enabled = static_snapshot_enabled or (lambda: False)
        self._static_snapshot_path = static_snapshot_path
        self._static_snapshot_stop = threading.Event()
        self._static_snapshot_wakeup = threading.Event()
        self._static_snapshot_lock = threading.Lock()
        self._static_snapshot_thread: threading.Thread | None = None
        self._static_snapshot_due_times: deque[float] = deque()
        self._last_static_snapshot_at = ""
        self._last_static_snapshot_error = ""
        self._static_snapshot_generation = 0
        self._last_slideshow_sequence = -1
        self._performance_monitor_stop = threading.Event()
        self._performance_monitor_thread: threading.Thread | None = None
        self._performance_action = "keep_running"
        self._performance_conditions: dict[str, bool] = dict.fromkeys(PERFORMANCE_CONDITIONS, False)
        self._performance_resume: tuple[Any, ...] | None = None
        self._performance_restore_in_progress = False
        self._window: Any | None = None
        self._window_handle = 0
        self._workerw_handle = 0
        self._desktop_host_kind = ""
        self._runtime_type = ""
        self._runtime_mode = ""
        self._runtime_revision = 0
        self._media_path = ""
        self._media_revision = 0
        self._media_paths: dict[int, str] = {}
        self._video_muted = True
        self._video_loop = True
        self._video_playback_rate = 1.0
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

    def configure(
        self,
        base_url: str,
        api_token: str,
        runtime_factory: Callable[..., Any] | None = None,
    ) -> None:
        with self._lock:
            self._base_url = base_url.rstrip("/")
            self._api_token = api_token
            self._runtime_factory = runtime_factory
            if runtime_factory is not None:
                self._host_ready.set()
            self._record("info", "动态壁纸运行时已就绪")
        self._start_performance_monitor()
        self._start_static_snapshot_monitor()

    def _start_static_snapshot_monitor(self) -> None:
        with self._lock:
            if self._static_snapshot_thread is not None and self._static_snapshot_thread.is_alive():
                return
            self._static_snapshot_stop.clear()
            thread = threading.Thread(
                target=self._run_static_snapshot_monitor,
                name="dynamic-wallpaper-static-snapshot",
                daemon=True,
            )
            self._static_snapshot_thread = thread
        thread.start()

    def _run_static_snapshot_monitor(self) -> None:
        next_periodic = time.monotonic() + STATIC_SNAPSHOT_INTERVAL_SECONDS
        while not self._static_snapshot_stop.is_set():
            now = time.monotonic()
            with self._lock:
                due_at = self._static_snapshot_due_times[0] if self._static_snapshot_due_times else None
            timeout = max(0.05, min(next_periodic, due_at if due_at is not None else next_periodic) - now)
            self._static_snapshot_wakeup.wait(timeout)
            self._static_snapshot_wakeup.clear()
            if self._static_snapshot_stop.is_set():
                break
            now = time.monotonic()
            with self._lock:
                due_at = self._static_snapshot_due_times[0] if self._static_snapshot_due_times else None
                force_due = due_at is not None and now >= due_at
                periodic_due = now >= next_periodic
                if force_due:
                    self._static_snapshot_due_times.popleft()
            if not force_due and not periodic_due:
                continue
            if periodic_due:
                next_periodic = now + STATIC_SNAPSHOT_INTERVAL_SECONDS
            if not self._static_snapshot_enabled():
                continue
            self._capture_static_snapshot("slideshow" if force_due else "periodic")

    def refresh_static_snapshot(self, enabled: bool) -> None:
        if not enabled:
            with self._lock:
                self._static_snapshot_due_times.clear()
            self._static_snapshot_wakeup.set()
            return
        self._queue_static_snapshot(STATIC_SNAPSHOT_SETTLE_SECONDS)

    def _queue_static_snapshot(self, delay: float) -> None:
        if not self._static_snapshot_enabled():
            return
        due_at = time.monotonic() + max(0.0, delay)
        with self._lock:
            if not self._attached or self._window is None:
                return
            self._static_snapshot_due_times.append(due_at)
        self._static_snapshot_wakeup.set()

    def _capture_static_snapshot(self, reason: str) -> None:
        if os.name != "nt" or self._static_snapshot_path is None:
            return
        if not self._static_snapshot_lock.acquire(blocking=False):
            return
        try:
            with self._lock:
                if not self._attached or self._window is None:
                    return
                workerw_handle = self._workerw_handle
            if not workerw_handle:
                return
            suffix = self._static_snapshot_path.suffix or ".jpg"
            path = self._static_snapshot_path.with_name(
                f"{self._static_snapshot_path.stem}-{self._static_snapshot_generation % 2}{suffix}"
            )
            path.parent.mkdir(parents=True, exist_ok=True)
            self._capture_runtime_window(workerw_handle, path)
            set_sys_wallpaper(str(path))
            with self._lock:
                self._static_snapshot_generation += 1
                self._last_static_snapshot_at = datetime.now().astimezone().isoformat(timespec="seconds")
                self._last_static_snapshot_error = ""
            self._record("info", f"已将动态壁纸截图同步为系统静态壁纸（{reason}）")
        except Exception as exc:
            with self._lock:
                self._last_static_snapshot_error = str(exc)
            self._record("warning", f"同步动态壁纸截图失败：{exc}")
        finally:
            self._static_snapshot_lock.release()

    @staticmethod
    def _capture_runtime_window(workerw_handle: int, path: Path) -> None:
        import win32con
        import win32gui
        import win32ui
        from PIL import Image

        target = int(workerw_handle)
        largest_area = 0

        def find_largest_child(window: int, _lparam: int) -> bool:
            nonlocal target, largest_area
            if not win32gui.IsWindowVisible(window):
                return True
            left, top, right, bottom = win32gui.GetWindowRect(window)
            area = max(0, right - left) * max(0, bottom - top)
            if area > largest_area:
                target = int(window)
                largest_area = area
            return True

        win32gui.EnumChildWindows(workerw_handle, find_largest_child, 0)
        left, top, right, bottom = win32gui.GetClientRect(target)
        width = int(right - left)
        height = int(bottom - top)
        if width <= 0 or height <= 0:
            raise RuntimeError("无法获取动态壁纸画布尺寸")
        window_dc_handle = win32gui.GetWindowDC(target)
        window_dc = win32ui.CreateDCFromHandle(window_dc_handle)
        memory_dc = window_dc.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(window_dc, width, height)
        previous_bitmap = memory_dc.SelectObject(bitmap)
        try:
            rendered = ctypes.windll.user32.PrintWindow(target, memory_dc.GetSafeHdc(), 2)
            if not rendered:
                memory_dc.BitBlt((0, 0), (width, height), window_dc, (0, 0), win32con.SRCCOPY)
            image = Image.frombuffer("RGB", (width, height), bitmap.GetBitmapBits(True), "raw", "BGRX", 0, 1)
            image.save(path, "JPEG", quality=92)
        finally:
            memory_dc.SelectObject(previous_bitmap)
            memory_dc.DeleteDC()
            window_dc.DeleteDC()
            win32gui.ReleaseDC(target, window_dc_handle)
            win32gui.DeleteObject(bitmap.GetHandle())

    def _start_performance_monitor(self) -> None:
        with self._lock:
            if self._performance_monitor_thread is not None and self._performance_monitor_thread.is_alive():
                return
            self._performance_monitor_stop.clear()
            thread = threading.Thread(
                target=self._run_performance_monitor,
                name="dynamic-wallpaper-performance",
                daemon=True,
            )
            self._performance_monitor_thread = thread
        thread.start()

    def _run_performance_monitor(self) -> None:
        com_initialized = False
        if os.name == "nt":
            try:
                import pythoncom

                pythoncom.CoInitialize()
                com_initialized = True
            except ImportError:
                pass
        try:
            while not self._performance_monitor_stop.wait(1.0):
                try:
                    with self._lock:
                        running = self._attached and self._window is not None
                        performance_stopped = self._performance_resume is not None
                    if not running and not performance_stopped:
                        self._apply_performance_action("keep_running", dict.fromkeys(PERFORMANCE_CONDITIONS, False))
                        continue
                    conditions = self._detect_performance_conditions()
                    settings = self._performance_settings()
                    action = self._resolve_performance_action(conditions, settings)
                    self._apply_performance_action(action, conditions)
                except Exception as exc:
                    logger.debug("Dynamic wallpaper performance probe failed: {}", exc)
        finally:
            if com_initialized:
                import pythoncom

                pythoncom.CoUninitialize()

    @staticmethod
    def _resolve_performance_action(conditions: dict[str, bool], settings: Any) -> str:
        configured = settings if isinstance(settings, dict) else {}
        active_actions = {
            str(configured.get(condition, "keep_running"))
            for condition, active in conditions.items()
            if active
        }
        if "stop" in active_actions:
            return "stop"
        if "pause" in active_actions:
            return "pause"
        if "mute" in active_actions:
            return "mute"
        return "keep_running"

    @staticmethod
    def _is_own_process(process_id: int) -> bool:
        if process_id <= 0:
            return False
        try:
            import psutil

            process = psutil.Process(process_id)
            current_pid = os.getpid()
            while process is not None:
                if process.pid == current_pid:
                    return True
                process = process.parent()
        except Exception:
            return process_id == os.getpid()
        return False

    @classmethod
    def _detect_foreground_conditions(cls) -> tuple[bool, bool, bool]:
        if os.name != "nt":
            return False, False, False
        import win32api
        import win32con
        import win32gui
        import win32process

        window = int(win32gui.GetForegroundWindow() or 0)
        if not window or not win32gui.IsWindowVisible(window):
            return False, False, False
        class_name = str(win32gui.GetClassName(window) or "")
        if class_name in {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"}:
            return False, False, False
        _, process_id = win32process.GetWindowThreadProcessId(window)
        if cls._is_own_process(int(process_id)):
            return False, False, False

        left, top, right, bottom = win32gui.GetWindowRect(window)
        monitor = win32api.MonitorFromWindow(window, win32con.MONITOR_DEFAULTTONEAREST)
        monitor_left, monitor_top, monitor_right, monitor_bottom = win32api.GetMonitorInfo(monitor)["Monitor"]
        tolerance = 2
        style = int(win32gui.GetWindowLong(window, win32con.GWL_STYLE))
        fullscreen = not bool(style & win32con.WS_CAPTION) and (
            left <= monitor_left + tolerance
            and top <= monitor_top + tolerance
            and right >= monitor_right - tolerance
            and bottom >= monitor_bottom - tolerance
        )
        maximized = bool(ctypes.windll.user32.IsZoomed(window)) and not fullscreen
        return True, maximized, fullscreen

    @classmethod
    def _other_application_playing_audio(cls) -> bool:
        if os.name != "nt":
            return False
        try:
            from pycaw.pycaw import AudioUtilities, IAudioMeterInformation

            for session in AudioUtilities.GetAllSessions():
                try:
                    if session.State != 1:
                        continue
                    process = session.Process
                    if process is None or cls._is_own_process(int(process.pid)):
                        continue
                    meter = session._ctl.QueryInterface(IAudioMeterInformation)
                    if float(meter.GetPeakValue()) > 0.001:
                        return True
                except Exception:
                    continue
        except ImportError:
            return False
        except Exception as exc:
            logger.debug("Reading Windows audio sessions failed: {}", exc)
        return False

    @staticmethod
    def _using_battery() -> bool:
        if os.name != "nt":
            return False
        import ctypes

        class SystemPowerStatus(ctypes.Structure):
            _fields_ = [
                ("ac_line_status", ctypes.c_ubyte),
                ("battery_flag", ctypes.c_ubyte),
                ("battery_life_percent", ctypes.c_ubyte),
                ("system_status_flag", ctypes.c_ubyte),
                ("battery_life_time", ctypes.c_ulong),
                ("battery_full_life_time", ctypes.c_ulong),
            ]

        status = SystemPowerStatus()
        return bool(ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status))) and status.ac_line_status == 0

    @classmethod
    def _detect_performance_conditions(cls) -> dict[str, bool]:
        try:
            focused, maximized, fullscreen = cls._detect_foreground_conditions()
        except Exception as exc:
            logger.debug("Reading foreground window state failed: {}", exc)
            focused, maximized, fullscreen = False, False, False
        try:
            audio = cls._other_application_playing_audio()
        except Exception as exc:
            logger.debug("Reading application audio state failed: {}", exc)
            audio = False
        try:
            on_battery = cls._using_battery()
        except Exception as exc:
            logger.debug("Reading battery state failed: {}", exc)
            on_battery = False
        return {
            "other_application_focused": focused,
            "other_application_maximized": maximized,
            "other_application_fullscreen": fullscreen,
            "other_application_audio": audio,
            "on_battery": on_battery,
        }

    def _apply_performance_action(self, action: str, conditions: dict[str, bool]) -> None:
        normalized = action if action in PERFORMANCE_ACTIONS else "keep_running"
        with self._lock:
            previous = self._performance_action
            self._performance_conditions = dict(conditions)
            window = self._window if self._attached else None
            self._performance_action = normalized
            performance_stopped = self._performance_resume is not None
        if normalized == "stop":
            if window is not None:
                self._stop_for_performance()
            return
        if performance_stopped:
            self._restore_performance_runtime()
            return
        if window is None:
            return
        self._evaluate_window_js(
            window,
            f"window.__ltwPlayer?.setPolicyMuted?.({str(normalized == 'mute').lower()}) ?? "
            f"window.__ltwDynamicRuntime?.setPolicyMuted?.({str(normalized == 'mute').lower()})",
        )
        self._evaluate_window_js(
            window,
            f"window.__ltwPlayer?.setPolicyPaused?.({str(normalized == 'pause').lower()}) ?? "
            f"window.__ltwDynamicRuntime?.setPolicyPaused?.({str(normalized == 'pause').lower()})",
        )
        if previous != normalized:
            self._record("info", f"性能策略已切换为：{normalized}")

    def _stop_for_performance(self) -> None:
        if not self._operation_lock.acquire(blocking=False):
            return
        try:
            with self._lock:
                if self._performance_resume is not None or not self._attached or self._window is None:
                    return
                if self._runtime_mode == "scene":
                    resume: tuple[Any, ...] = ("scene", self._runtime_revision, self._runtime_type)
                elif self._runtime_mode == "raw-video" and self._media_path:
                    resume = (
                        "video",
                        self._media_path,
                        self._video_muted,
                        self._video_loop,
                        self._video_playback_rate,
                    )
                else:
                    return
                self._performance_resume = resume
                self._performance_restore_in_progress = False
            self._stop_runtime()
            with self._lock:
                self._performance_action = "stop"
                self._last_operation = "performance-stop"
            self._record("info", "性能策略已停止动态壁纸并释放资源")
        finally:
            self._operation_lock.release()

    def _restore_performance_runtime(self) -> None:
        with self._lock:
            resume = self._performance_resume
            if resume is None or self._performance_restore_in_progress:
                return
            self._performance_restore_in_progress = True
        try:
            if resume[0] == "scene":
                self.start_scene(int(resume[1]), str(resume[2]))
            else:
                self.start(str(resume[1]), bool(resume[2]), bool(resume[3]), float(resume[4]))
            self._record("info", "性能条件已解除，正在重新创建动态壁纸")
        except Exception:
            with self._lock:
                self._performance_restore_in_progress = False

    def _complete_performance_restore(self) -> None:
        with self._lock:
            if not self._performance_restore_in_progress:
                return
            self._performance_resume = None
            self._performance_restore_in_progress = False
            action = self._performance_action
            conditions = dict(self._performance_conditions)
        self._record("info", "动态壁纸已在性能条件解除后重新创建")
        self._apply_performance_action(action, conditions)

    def _fail_performance_restore(self) -> None:
        with self._lock:
            if self._performance_restore_in_progress:
                self._performance_restore_in_progress = False

    @staticmethod
    def _log_window_task(task: Any, operation: str) -> None:
        if task is None or not hasattr(task, "add_done_callback"):
            return

        def done(future: Any) -> None:
            try:
                error = future.exception()
            except Exception as exc:
                logger.warning("Dynamic wallpaper {} task failed: {}", operation, exc)
                return
            if error is not None:
                logger.warning("Dynamic wallpaper {} task failed: {}", operation, error)

        task.add_done_callback(done)

    @classmethod
    def _load_window_url(cls, window: Any, url: str) -> None:
        cls._log_window_task(window.load_url(url), "navigation")

    @classmethod
    def _evaluate_window_js(cls, window: Any, script: str) -> None:
        method = getattr(window, "eval_js", None) or window.evaluate_js
        cls._log_window_task(method(script), "JavaScript")

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
            workerw_handle = self._workerw_handle
            runtime_ready = bool(self._base_url and self._api_token and self._runtime_factory)
            running = bool(self._attached and self._window is not None and workerw_handle)
            media = Path(self._media_path) if self._media_path else None
            probe_matches_media = probe["media_path"] == self._media_path
            media_exists = bool(probe["media_exists"]) if probe_matches_media else False
            media_size = int(probe["media_size"]) if probe_matches_media else 0
            media_modified_at = str(probe["media_modified_at"]) if probe_matches_media else ""
            expected_structure = "modern_child" if version["modern_expected"] else "legacy_top_level"
            detected_structure = str(topology["structure"])
            window_diagnostics = self._empty_window_diagnostics()
            if running:
                window_diagnostics.update({"valid": True, "visible": True, "parent_matches": True})
            return {
                "supported": os.name == "nt",
                "platform": os.name,
                "windows_version": version,
                "expected_structure": expected_structure,
                "detected_structure": detected_structure,
                "structure_label": topology["label"],
                "structure_reason": topology["reason"],
                "structure_matches_version": detected_structure in {"not_initialized", expected_structure},
                "runtime_ready": runtime_ready,
                "host_window_ready": runtime_ready,
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
                "window_handle": "",
                "window": window_diagnostics,
                "running": running,
                "dynamic_type": self._runtime_type,
                "runtime_mode": self._runtime_mode,
                "runtime_revision": self._runtime_revision,
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
                "performance": {
                    "action": self._performance_action,
                    "conditions": dict(self._performance_conditions),
                    "stopped": self._performance_resume is not None,
                },
                "static_snapshot": {
                    "enabled": bool(self._static_snapshot_enabled()),
                    "interval_seconds": STATIC_SNAPSHOT_INTERVAL_SECONDS,
                    "last_updated_at": self._last_static_snapshot_at,
                    "last_error": self._last_static_snapshot_error,
                },
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
                workerw_handle = self._workerw_handle
                attached = self._attached
                media_path = self._media_path

            version = self._get_windows_version()
            topology = self._find_desktop_host(spawn=False)
            host_window_valid = self._runtime_factory is not None
            running = bool(attached and self._window is not None and workerw_handle)
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
            window_diagnostics = self._empty_window_diagnostics()
            if running:
                window_diagnostics.update({"valid": True, "visible": True, "parent_matches": True})

            with self._lock:
                self._diagnostic_probe = {
                    "windows_version": version,
                    "topology": topology,
                    "prepared_window_handle": prepared_handle,
                    "host_window_valid": host_window_valid,
                    "window_handle": 0,
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
            if not self._performance_restore_in_progress:
                self._performance_resume = None
                self._performance_action = "keep_running"
            self._operation_phase = "queued"
            self._operation_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
            self._last_error = ""
        snapshot = self._status_snapshot()
        thread = threading.Thread(
            target=self._run_start,
            args=(path, muted, loop, playback_rate),
            name="dynamic-wallpaper-start",
            daemon=True,
        )
        try:
            thread.start()
        except Exception:
            self._fail_performance_restore()
            with self._lock:
                self._operation_phase = "idle"
                self._operation_started_at = ""
            self._operation_lock.release()
            raise
        return snapshot

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
            if not self._performance_restore_in_progress:
                self._performance_resume = None
                self._performance_action = "keep_running"
            self._operation_phase = "queued"
            self._operation_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
            self._last_error = ""
        snapshot = self._status_snapshot()
        thread = threading.Thread(
            target=self._run_scene_start,
            args=(max(0, int(revision)), str(background_type)),
            name="dynamic-wallpaper-scene-start",
            daemon=True,
        )
        try:
            thread.start()
        except Exception:
            self._fail_performance_restore()
            with self._lock:
                self._operation_phase = "idle"
                self._operation_started_at = ""
            self._operation_lock.release()
            raise
        return snapshot

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
                scene_url = self.scene_url(revision)
                existing_running = self._attached and window is not None

            if existing_running:
                self._set_operation_phase("switching")
                self._raise_if_stop_requested()
                self._load_window_url(window, scene_url)
                with self._lock:
                    self._scene_runtime_loaded = True
                    self._last_operation = "switch-scene"
                    self._runtime_type = background_type
                    self._runtime_mode = "scene"
                    self._runtime_revision = revision
                    self._last_slideshow_sequence = -1
                    self._media_path = ""
                    self._media_paths.clear()
                    self._telemetry = self._empty_telemetry()
                    self._telemetry["media_revision"] = revision
                self._complete_performance_restore()
                self._record("info", f"已应用动态场景修订 {revision}")
                self._queue_static_snapshot(STATIC_SNAPSHOT_SETTLE_SECONDS)
                return

            self._set_operation_phase("finding-desktop")
            topology = self._find_desktop_host(spawn=True)
            self._raise_if_stop_requested()
            desktop_host = int(topology["host"])
            if not desktop_host:
                raise RuntimeError("发送桌面切换消息后仍未找到可用 WorkerW")
            self._set_operation_phase("creating-webview")
            window, width, height = self._create_runtime(desktop_host, scene_url)
            self._raise_if_stop_requested()
            with self._lock:
                self._window = window
                self._scene_runtime_loaded = True
                self._prepared_window_handle = 0
                self._window_handle = 0
                self._workerw_handle = desktop_host
                self._desktop_host_kind = str(topology["label"])
                self._attached = True
                self._runtime_type = background_type
                self._runtime_mode = "scene"
                self._runtime_revision = revision
                self._last_slideshow_sequence = -1
                self._telemetry = self._empty_telemetry()
                self._telemetry["media_revision"] = revision
                self._started_at = datetime.now().astimezone().isoformat(timespec="seconds")
                self._last_operation = "start-scene"
            self._complete_performance_restore()
            self._record("info", f"动态场景 WebView 已直接嵌入桌面，画布 {width} x {height}")
            self._queue_static_snapshot(STATIC_SNAPSHOT_SETTLE_SECONDS)
        except InterruptedError:
            self._record("info", "动态场景启动已取消")
        except Exception as exc:
            self._fail_performance_restore()
            with self._lock:
                self._last_error = str(exc)
                attached = self._attached
            if window is not None and not attached:
                with contextlib.suppress(Exception):
                    self._log_window_task(window.close(), "close")
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
        try:
            with self._lock:
                self._operation_phase = "validating"
                if os.name != "nt":
                    raise OSError("动态壁纸调试宿主仅支持 Windows")
                if not self._base_url or not self._api_token:
                    raise RuntimeError("动态壁纸运行时尚未配置")

            media = Path(path).expanduser().resolve()
            if not media.is_file():
                raise FileNotFoundError(str(media))
            if media.suffix.lower() not in SUPPORTED_VIDEO_SUFFIXES:
                raise ValueError("仅支持 MP4、WebM、MOV 和 M4V 视频")
            rate = max(0.25, min(4.0, float(playback_rate)))

            with self._lock:
                window = self._window
                self._last_error = ""
                previous_path = self._media_path
                previous_revision = self._media_revision
                previous_video_settings = (self._video_muted, self._video_loop, self._video_playback_rate)
                self._media_path = str(media)
                self._media_revision += 1
                revision = self._media_revision
                self._runtime_revision = revision
                self._last_slideshow_sequence = -1
                self._media_paths[revision] = self._media_path
                self._media_paths = dict(sorted(self._media_paths.items())[-4:])
                self._telemetry = self._empty_telemetry()
                self._telemetry["media_revision"] = revision
                self._video_muted = bool(muted)
                self._video_loop = bool(loop)
                self._video_playback_rate = rate
                player_url = self._player_url(muted, loop, rate)
                existing_running = self._attached and window is not None

            if existing_running:
                self._set_operation_phase("switching")
                self._record("info", f"正在热切换媒体：{media.name}")
                try:
                    self._raise_if_stop_requested()
                    self._load_window_url(window, player_url)
                    self._raise_if_stop_requested()
                except Exception as exc:
                    with self._lock:
                        self._media_paths.pop(revision, None)
                        self._media_path = previous_path
                        self._media_revision = previous_revision
                        self._video_muted, self._video_loop, self._video_playback_rate = previous_video_settings
                        self._last_error = str(exc)
                    self._record("error", f"热切换媒体失败：{exc}")
                    raise
                with self._lock:
                    self._last_operation = "switch"
                    self._runtime_type = "video"
                    self._runtime_mode = "raw-video"
                    self._scene_runtime_loaded = False
                self._complete_performance_restore()
                self._record("info", f"已向现有宿主发送媒体修订 {revision}")
                self._queue_static_snapshot(STATIC_SNAPSHOT_SETTLE_SECONDS)
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

            self._set_operation_phase("creating-webview")
            window, width, height = self._create_runtime(desktop_host, player_url)
            self._raise_if_stop_requested()
            with self._lock:
                self._window = window
                self._prepared_window_handle = 0
                self._window_handle = 0
                self._workerw_handle = desktop_host
                self._desktop_host_kind = host_kind
                self._attached = True
                self._runtime_type = "video"
                self._runtime_mode = "raw-video"
                self._scene_runtime_loaded = False
                self._started_at = datetime.now().astimezone().isoformat(timespec="seconds")
                self._last_operation = "start"
            self._complete_performance_restore()
            self._record("info", f"视频 WebView 已直接嵌入 {host_kind}，画布 {width} x {height}")
            self._queue_static_snapshot(STATIC_SNAPSHOT_SETTLE_SECONDS)
        except InterruptedError:
            self._record("info", "动态壁纸启动已取消")
        except Exception as exc:
            self._fail_performance_restore()
            with self._lock:
                self._last_error = str(exc)
                attached = self._attached
                if not attached:
                    self._clear_media_state()
            if window is not None and not attached:
                with contextlib.suppress(Exception):
                    self._log_window_task(window.close(), "close")
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

    @staticmethod
    def _logical_runtime_bounds(
        x: int,
        y: int,
        width: int,
        height: int,
        dpi: int,
    ) -> tuple[int, int, int, int]:
        scale = max(96, int(dpi or 96)) / 96
        return (
            round(x / scale),
            round(y / scale),
            max(1, round(width / scale)),
            max(1, round(height / scale)),
        )

    def _create_runtime(self, desktop_host: int, url: str) -> tuple[Any, int, int]:
        with self._lock:
            factory = self._runtime_factory
        if factory is None:
            raise RuntimeError("嵌入式 WebView 运行时尚未配置")

        import win32api
        import win32con
        import win32gui

        monitor = win32api.MonitorFromPoint((0, 0), win32con.MONITOR_DEFAULTTOPRIMARY)
        monitor_left, monitor_top, monitor_right, monitor_bottom = win32api.GetMonitorInfo(monitor)["Monitor"]
        x, y = win32gui.ScreenToClient(desktop_host, (monitor_left, monitor_top))
        x = int(x)
        y = int(y)
        physical_width = max(1, int(monitor_right - monitor_left))
        physical_height = max(1, int(monitor_bottom - monitor_top))
        try:
            import ctypes

            dpi = int(ctypes.windll.user32.GetDpiForWindow(desktop_host) or 96)
        except (AttributeError, OSError):
            dpi = 96
        x, y, width, height = self._logical_runtime_bounds(
            x,
            y,
            physical_width,
            physical_height,
            dpi,
        )
        try:
            task = factory(desktop_host, width, height, url, x, y)
        except TypeError:
            # Keep custom runtime factories compatible while the production host
            # accepts explicit positioning within a virtual-desktop WorkerW.
            task = factory(desktop_host, width, height, url)
        runtime = task.result(timeout=15) if hasattr(task, "result") else task
        if runtime is None:
            raise RuntimeError("创建嵌入式 WebView 失败")
        return runtime, width, height

    def _stop_runtime(self) -> None:
        with self._lock:
            window = self._window
            self._window = None
            self._window_handle = 0
            self._workerw_handle = 0
            self._desktop_host_kind = ""
            self._runtime_type = ""
            self._runtime_mode = ""
            self._attached = False
            self._static_snapshot_due_times.clear()
            self._clear_media_state()
        if window is not None:
            with contextlib.suppress(Exception):
                self._log_window_task(window.close(), "close")
        with self._lock:
            self._last_operation = "stop"
            self._operation_phase = "idle"
            self._operation_started_at = ""
        self._stop_requested.clear()
        self._record("info", "动态壁纸已停止并销毁嵌入式 WebView")

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
            return self._attached or self._performance_resume is not None or self._operation_lock.locked()

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
            WindowsDynamicWallpaperService._evaluate_window_js(
                window,
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
            WindowsDynamicWallpaperService._evaluate_window_js(
                window,
                "window.__ltwDynamicRuntime?.dispose?.(); window.__ltwDynamicRuntime = undefined; true",
            )

    def _clear_media_state(self) -> None:
        self._media_revision += 1
        self._media_path = ""
        self._media_paths.clear()
        self._started_at = ""
        self._runtime_type = ""
        self._runtime_mode = ""
        self._runtime_revision = 0
        self._telemetry = self._empty_telemetry()

    def update_telemetry(self, payload: dict[str, Any]) -> None:
        queue_slideshow_snapshot = False
        with self._lock:
            if not isinstance(payload, dict):
                return
            try:
                revision = int(payload.get("media_revision", 0))
            except (TypeError, ValueError):
                return
            if not self._attached or revision != self._runtime_revision:
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

            if event == "slideshow-change":
                try:
                    sequence = int(payload.get("slideshow_sequence", -1))
                except (TypeError, ValueError):
                    sequence = -1
                if sequence > self._last_slideshow_sequence:
                    self._last_slideshow_sequence = sequence
                    queue_slideshow_snapshot = True

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
        if queue_slideshow_snapshot:
            self._queue_static_snapshot(STATIC_SNAPSHOT_SETTLE_SECONDS)

    def control(self, action: str) -> dict[str, Any]:
        if not self._operation_lock.acquire(blocking=False):
            raise RuntimeError("动态壁纸操作正在进行，请稍候")
        try:
            with self._lock:
                self._operation_phase = f"control-{str(action).strip().lower()}"
                self._operation_started_at = datetime.now().astimezone().isoformat(timespec="seconds")
                normalized = str(action or "").strip().lower()
                scripts = {
                    "play": "window.__ltwPlayer ? window.__ltwPlayer.play() : window.__ltwDynamicRuntime?.play?.()",
                    "pause": "window.__ltwPlayer ? window.__ltwPlayer.pause() : window.__ltwDynamicRuntime?.pause?.()",
                    "auto": "window.__ltwPlayer ? window.__ltwPlayer.auto() : window.__ltwDynamicRuntime?.auto?.()",
                    "reload": "window.__ltwPlayer ? window.__ltwPlayer.reload?.() : window.__ltwDynamicRuntime?.reload?.()",
                    "next": "window.__ltwDynamicRuntime?.next?.()",
                    "previous": "window.__ltwDynamicRuntime?.previous?.()",
                }
                if normalized not in scripts:
                    raise ValueError("不支持的播放器操作")
                window = self._window
                if window is None or not self._attached:
                    raise RuntimeError("动态壁纸宿主未运行")
                script = (
                    "window.__ltwPlayer?.setPolicyPaused?.(true) ?? "
                    "window.__ltwDynamicRuntime?.setPolicyPaused?.(true)"
                    if self._performance_action == "pause" and normalized in {"play", "auto"}
                    else scripts[normalized]
                )
            self._evaluate_window_js(window, script)
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
            self._performance_resume = None
            self._performance_restore_in_progress = False
            self._performance_action = "keep_running"
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
        self._performance_monitor_stop.set()
        self._static_snapshot_stop.set()
        self._static_snapshot_wakeup.set()
        performance_thread = self._performance_monitor_thread
        if performance_thread is not None and performance_thread is not threading.current_thread():
            performance_thread.join(timeout=2)
        self._performance_monitor_thread = None
        static_snapshot_thread = self._static_snapshot_thread
        if static_snapshot_thread is not None and static_snapshot_thread is not threading.current_thread():
            static_snapshot_thread.join(timeout=2)
        self._static_snapshot_thread = None
        if self._static_snapshot_enabled():
            self._capture_static_snapshot("exit")
        with self._lock:
            window = self._window
            self._window = None
            self._attached = False
            self._window_handle = 0
            self._workerw_handle = 0
            self._desktop_host_kind = ""
            self._runtime_type = ""
            self._runtime_mode = ""
            self._pending_scene = None
            self._performance_resume = None
            self._performance_restore_in_progress = False
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
                self._log_window_task(window.close(), "close")
