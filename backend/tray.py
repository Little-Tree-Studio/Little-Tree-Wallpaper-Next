from __future__ import annotations

import contextlib
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from loguru import logger
from lumiview import WindowBaseEvent, WindowEvent


class ApplicationTray:
    """Own the main WebView lifecycle while background services stay alive."""

    def __init__(
        self,
        api: Any,
        title: str,
        icon_path: str | None,
        create_main_window: Callable[[], Any],
        on_quit: Callable[[], None],
    ) -> None:
        self._api = api
        self._title = title
        self._icon_path = icon_path
        self._create_main_window = create_main_window
        self._on_quit = on_quit
        self._lock = threading.RLock()
        self._window_operation_lock = threading.Lock()
        self._main_window: Any | None = None
        self._tray_icon: Any | None = None
        self._windows_toaster: Any | None = None
        self._allow_close = False
        self._quitting = False

    def attach_main_window(self, window: Any) -> None:
        with self._lock:
            self._main_window = window
            self._allow_close = False

        @window.on(WindowEvent.CloseRequestedEvent)
        def on_close_requested(event: WindowBaseEvent) -> None:
            if self._on_main_closing() is False:
                event.prevent()

    def _on_main_closing(self, *_args: Any) -> bool | None:
        with self._lock:
            if self._allow_close or self._quitting:
                return None
        # Closing the visible application window must never leave an invisible
        # wallpaper session running, even when the app itself stays in the tray.
        with contextlib.suppress(Exception):
            self._api.stop_dynamic_wallpaper()
        if not bool(self._api.store.get("ui.hide_on_close", True)) or not bool(
            self._api.store.get("ui.minimize_to_tray", True)
        ):
            threading.Timer(0, self.quit).start()
            return False
        if bool(self._api.store.get("ui.release_webview_on_close", False)):
            # Complete the destruction after the cancellable closing event returns.
            threading.Timer(0, self.release_main_window).start()
        else:
            self.hide_main_window()
        return False

    def _on_main_closed(self, window: Any) -> None:
        with self._lock:
            if self._main_window is window:
                self._main_window = None
                self._allow_close = False

    def show_main_window(self, *_args: Any) -> None:
        with self._window_operation_lock:
            with self._lock:
                window = self._main_window
                if self._quitting:
                    return
            try:
                if window is None:
                    window = self._create_main_window()
                    self.attach_main_window(window)
                else:
                    window.show()
                    window.minimize(False)
            except Exception as exc:
                logger.error("Failed to show main window: {}", exc)

    def hide_main_window(self, *_args: Any) -> None:
        with self._lock:
            window = self._main_window
        if window is not None:
            with contextlib.suppress(Exception):
                window.hide()

    def release_main_window(self, *_args: Any) -> None:
        with self._window_operation_lock:
            with self._lock:
                window = self._main_window
                if window is None:
                    return
                self._allow_close = True
            with contextlib.suppress(Exception):
                self._on_main_closed(window)
                window.close()

    def notify(self, title: str, message: str) -> None:
        """Show a clickable Windows notification with a tray fallback."""
        if sys.platform == "win32":
            try:
                from windows_toasts import Toast, WindowsToaster

                if self._windows_toaster is None:
                    self._windows_toaster = WindowsToaster(self._title)
                notification = Toast()
                notification.text_fields = [title, message]
                notification.on_activated = lambda _args: self.show_main_window()
                self._windows_toaster.show_toast(notification)
                return
            except Exception as exc:
                logger.warning("Clickable Windows notification failed: {}", exc)
        with self._lock:
            icon = self._tray_icon
        if icon is not None:
            with contextlib.suppress(Exception):
                icon.notify(message, title)

    def _dynamic_action(self, action: str) -> None:
        try:
            if action == "stop":
                self._api.stop_dynamic_wallpaper()
            else:
                self._api.control_dynamic_wallpaper(action)
        except Exception as exc:
            logger.warning("Tray dynamic wallpaper action {} failed: {}", action, exc)

    def _cancel_automation(self) -> None:
        with contextlib.suppress(Exception):
            self._api.cancel_automation()

    def _load_icon_image(self) -> Any:
        from PIL import Image, ImageDraw

        if self._icon_path and Path(self._icon_path).is_file():
            return Image.open(self._icon_path).convert("RGBA")
        image = Image.new("RGBA", (64, 64), (4, 133, 247, 255))
        draw = ImageDraw.Draw(image)
        draw.ellipse((17, 8, 47, 38), fill=(255, 255, 255, 255))
        draw.rectangle((29, 32, 35, 56), fill=(255, 255, 255, 255))
        return image

    def start(self) -> bool:
        if not bool(self._api.store.get("ui.minimize_to_tray", True)):
            logger.info("System tray disabled by settings")
            return False
        try:
            import pystray

            menu = pystray.Menu(
                pystray.MenuItem("显示主界面", self.show_main_window, default=True),
                pystray.MenuItem("隐藏主界面", self.hide_main_window),
                pystray.MenuItem("释放主界面内存", self.release_main_window),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(
                    "动态壁纸",
                    pystray.Menu(
                        pystray.MenuItem("继续播放", lambda *_: self._dynamic_action("play")),
                        pystray.MenuItem("暂停", lambda *_: self._dynamic_action("pause")),
                        pystray.MenuItem("关闭", lambda *_: self._dynamic_action("stop")),
                    ),
                ),
                pystray.MenuItem("停止当前自动化", lambda *_: self._cancel_automation()),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出", self.quit),
            )
            icon = pystray.Icon("little-tree-wallpaper", self._load_icon_image(), self._title, menu)
            with self._lock:
                self._tray_icon = icon
            icon.run_detached()
            logger.info("System tray started")
            return True
        except Exception as exc:
            logger.error("System tray could not start: {}", exc)
            return False

    def quit(self, *_args: Any) -> None:
        with self._lock:
            if self._quitting:
                return
            self._quitting = True
            self._allow_close = True
            window = self._main_window
            icon = self._tray_icon
        if icon is not None:
            with contextlib.suppress(Exception):
                icon.stop()
        # Stop and detach the WorkerW child before destroying any WebView. If a
        # scene is still starting, shutdown requests cancellation and waits for
        # the worker to leave its critical section.
        with contextlib.suppress(Exception):
            self._api.shutdown_dynamic_wallpaper()
        if window is not None:
            with contextlib.suppress(Exception):
                self._on_main_closed(window)
                window.close()
        self._on_quit()
