from __future__ import annotations

import threading
from collections.abc import Callable

from pathlib import Path

from PIL import Image
from loguru import logger
from pystray import Icon, Menu, MenuItem

_ICON_PATH = Path(__file__).resolve().parent / "assets" / "icon.ico"


class TrayService:
    def __init__(
        self,
        on_show: Callable[[], None],
        on_change_once: Callable[[], None],
        on_quit: Callable[[], None],
    ) -> None:
        self.on_show = on_show
        self.on_change_once = on_change_once
        self.on_quit = on_quit
        self.icon: Icon | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self.icon is not None:
            return
        self.icon = Icon(
            "little-tree-wallpaper",
            self._create_icon_image(),
            "小树壁纸 Next",
            menu=Menu(
                MenuItem("显示主窗口", lambda icon, item: self.on_show()),
                MenuItem("立即换一张", lambda icon, item: self.on_change_once()),
                MenuItem("退出", lambda icon, item: self.on_quit()),
            ),
        )
        self._thread = threading.Thread(
            target=self._run_icon, name="tray-icon", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        if self.icon is not None:
            self.icon.stop()
            self.icon = None
        if (
            self._thread is not None
            and self._thread.is_alive()
            and threading.current_thread() is not self._thread
        ):
            self._thread.join(timeout=1.5)
        self._thread = None

    def _run_icon(self) -> None:
        try:
            assert self.icon is not None
            self.icon.run()
        except Exception:
            logger.exception("tray service failed")

    def _create_icon_image(self) -> Image.Image:
        return Image.open(_ICON_PATH)
