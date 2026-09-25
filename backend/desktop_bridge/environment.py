"""Unified desktop-environment capabilities exposed by ``desktop_bridge``.

The application talks to this module instead of branching on operating-system
details. Platform-specific implementations remain in the small service modules
that already own them, while this class provides one stable contract for the
rest of the application and for future desktop integrations.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from loguru import logger

from backend.services.sys_wallpaper import (
    get_display_resolutions,
    get_sys_wallpaper,
    set_wallpaper,
)


@dataclass(frozen=True, slots=True)
class DesktopNotification:
    """A platform-neutral desktop notification request."""

    title: str
    message: str
    urgency: str = "normal"
    timeout_ms: int = 5_000
    on_activate: Callable[[], None] | None = None


NotificationSink = Callable[[DesktopNotification], bool | None]


class DesktopEnvironment:
    """Facade for desktop features shared by the backend and integrations."""

    def __init__(
        self,
        *,
        wallpaper_getter: Callable[[], str | None] = get_sys_wallpaper,
        wallpaper_setter: Callable[[str], None] = set_wallpaper,
        display_getter: Callable[[], list[dict[str, object]]] = get_display_resolutions,
    ) -> None:
        self._wallpaper_getter = wallpaper_getter
        self._wallpaper_setter = wallpaper_setter
        self._display_getter = display_getter
        self._notification_sink: NotificationSink | None = None
        self._notification_fallback: NotificationSink | None = None

    @property
    def platform(self) -> str:
        """Return the normalized platform identifier used by the API."""
        return {
            "win32": "windows",
            "darwin": "macos",
            "linux": "linux",
        }.get(sys.platform, sys.platform)

    @property
    def desktop_session(self) -> str:
        """Return the best available desktop-session identifier."""
        if self.platform != "linux":
            return self.platform
        values = (
            os.environ.get("XDG_CURRENT_DESKTOP", ""),
            os.environ.get("XDG_SESSION_DESKTOP", ""),
            os.environ.get("DESKTOP_SESSION", ""),
        )
        return next((value.split(":", 1)[0].strip().lower() for value in values if value.strip()), "unknown")

    def capabilities(self) -> dict[str, Any]:
        """Describe supported capabilities without exposing implementation details."""
        return {
            "platform": self.platform,
            "desktop_session": self.desktop_session,
            "wallpaper": {
                "get": True,
                "set": True,
                "displays": True,
            },
            "notifications": True,
            "native_notifications": self.platform in {"windows", "macos", "linux"},
        }

    def get_wallpaper(self) -> str | None:
        """Return the current desktop wallpaper path, when available."""
        return self._wallpaper_getter()

    def set_wallpaper(self, path: str) -> None:
        """Set the desktop wallpaper using the active platform adapter."""
        self._wallpaper_setter(str(Path(path).expanduser()))

    def get_displays(self) -> list[dict[str, object]]:
        """Return active displays in a stable, JSON-friendly shape."""
        return self._display_getter()

    def set_notification_sink(self, sink: NotificationSink | None) -> None:
        """Install an integration sink, such as a tray implementation."""
        self._notification_sink = sink

    def set_notification_fallback(self, fallback: NotificationSink | None) -> None:
        """Install a fallback used when the native notification API is absent."""
        self._notification_fallback = fallback

    def notify(
        self,
        title: str,
        message: str,
        *,
        urgency: str = "normal",
        timeout_ms: int = 5_000,
        on_activate: Callable[[], None] | None = None,
    ) -> bool:
        """Show a desktop notification and report whether it was delivered."""
        request = DesktopNotification(
            title=str(title),
            message=str(message),
            urgency=urgency if urgency in {"low", "normal", "critical"} else "normal",
            timeout_ms=max(1_000, min(120_000, int(timeout_ms))),
            on_activate=on_activate,
        )
        for handler in (self._notification_sink, self._notify_native, self._notification_fallback):
            if handler is None:
                continue
            try:
                if handler(request):
                    return True
            except Exception as exc:
                logger.debug("Desktop notification handler failed: {}", exc)
        return False

    def _notify_native(self, request: DesktopNotification) -> bool:
        if self.platform == "windows":
            return self._notify_windows(request)
        if self.platform == "macos":
            return self._notify_macos(request)
        if self.platform == "linux":
            return self._notify_linux(request)
        return False

    @staticmethod
    def _notify_windows(request: DesktopNotification) -> bool:
        try:
            from windows_toasts import Toast, WindowsToaster

            toaster = WindowsToaster("Little Tree Wallpaper")
            notification = Toast()
            notification.text_fields = [request.title, request.message]
            if request.on_activate is not None:
                notification.on_activated = lambda _args: request.on_activate()
            toaster.show_toast(notification)
            return True
        except Exception as exc:
            logger.debug("Windows native notification unavailable: {}", exc)
            return False

    @staticmethod
    def _notify_macos(request: DesktopNotification) -> bool:
        try:
            subprocess.run(
                [
                    "osascript",
                    "-e",
                    "display notification "
                    + DesktopEnvironment._apple_script_string(request.message)
                    + " with title "
                    + DesktopEnvironment._apple_script_string(request.title),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except (OSError, subprocess.CalledProcessError) as exc:
            logger.debug("macOS native notification unavailable: {}", exc)
            return False

    @staticmethod
    def _notify_linux(request: DesktopNotification) -> bool:
        if not _command_available("notify-send"):
            return False
        try:
            subprocess.run(
                [
                    "notify-send",
                    "--urgency",
                    request.urgency,
                    "--expire-time",
                    str(request.timeout_ms),
                    request.title,
                    request.message,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except (OSError, subprocess.CalledProcessError) as exc:
            logger.debug("Linux native notification unavailable: {}", exc)
            return False

    @staticmethod
    def _apple_script_string(value: str) -> str:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _command_available(command: str) -> bool:
    import shutil

    return shutil.which(command) is not None


__all__ = ["DesktopEnvironment", "DesktopNotification", "NotificationSink"]
