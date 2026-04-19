from __future__ import annotations

import ctypes
import sys
import threading
from collections.abc import Callable
from pathlib import Path

from loguru import logger
import webview

from little_tree_wallpaper.app_api import AppBridge
from little_tree_wallpaper.paths import AppPaths
from little_tree_wallpaper.services.auto_change import AutoChangeService
from little_tree_wallpaper.services.bing import BingService
from little_tree_wallpaper.services.favorites import FavoriteManager
from little_tree_wallpaper.services.intelligent_market import IntelligentMarketService
from little_tree_wallpaper.services.ltws import LTWSService
from little_tree_wallpaper.services.plugins import PluginManager
from little_tree_wallpaper.services.sniff import SniffService
from little_tree_wallpaper.services.spotlight import SpotlightService
from little_tree_wallpaper.services.storage import StorageService
from little_tree_wallpaper.services.store import StoreService
from little_tree_wallpaper.services.wallpaper import WallpaperService
from little_tree_wallpaper.settings import SettingsStore
from little_tree_wallpaper.single_instance import SingleInstanceManager
from little_tree_wallpaper.tray import TrayService

_ICON_PATH = Path(__file__).resolve().parent / "assets" / "icon.ico"


def _configure_logging(log_dir: Path, debug_enabled: bool) -> None:
    level = "DEBUG" if debug_enabled else "INFO"
    logger.remove()
    logger.add(
        sys.stderr,
        level=level,
        backtrace=debug_enabled,
        diagnose=debug_enabled,
    )
    logger.add(
        log_dir / "app.log",
        level=level,
        rotation="2 MB",
        retention=5,
        encoding="utf-8",
        backtrace=debug_enabled,
        diagnose=debug_enabled,
    )


def run() -> None:
    workspace_root = Path(__file__).resolve().parents[2]
    paths = AppPaths.create(workspace_root)
    single_instance = SingleInstanceManager(str(workspace_root))
    if not single_instance.acquire():
        _show_conflict_window()
        return

    settings = SettingsStore(paths.config_dir / "config.json")
    if not settings.get("storage.cache_directory"):
        settings.set("storage.cache_directory", str(paths.cache_dir))
    if not settings.get("storage.log_directory"):
        settings.set("storage.log_directory", str(paths.log_dir))
    raw_download_directory = settings.get("storage.download_directory")
    if isinstance(raw_download_directory, str) and raw_download_directory.strip():
        candidate_download_directory = Path(raw_download_directory).expanduser()
        download_directory = (
            candidate_download_directory.resolve()
            if candidate_download_directory.is_absolute()
            else paths.downloads_dir.resolve()
        )
    else:
        download_directory = paths.downloads_dir.resolve()
    download_directory.mkdir(parents=True, exist_ok=True)
    settings.set("storage.download_directory", str(download_directory))
    debug_enabled = bool(settings.get("debug.enabled", False))
    _configure_logging(paths.log_dir, debug_enabled)

    def refresh_debug_logging() -> None:
        current_debug_enabled = bool(settings.get("debug.enabled", False))
        _configure_logging(paths.log_dir, current_debug_enabled)
        logger.info(
            "debug mode {} (restart required for webview devtools)",
            "enabled" if current_debug_enabled else "disabled",
        )

    bing_service = BingService()
    spotlight_service = SpotlightService()
    wallpaper_service = WallpaperService(download_directory, paths.history_dir)
    favorite_manager = FavoriteManager(paths.favorites_dir)
    ltws_service = LTWSService(paths.sources_dir, paths.cache_dir, paths.examples_dir)
    intelligent_market_service = IntelligentMarketService(paths.cache_dir, settings)
    storage_service = StorageService(
        paths=paths,
        wallpaper_service=wallpaper_service,
        favorite_manager=favorite_manager,
        ltws_service=ltws_service,
        intelligent_market_service=intelligent_market_service,
    )
    auto_change_service = AutoChangeService(
        settings=settings,
        wallpaper_service=wallpaper_service,
        favorite_manager=favorite_manager,
        bing_service=bing_service,
        spotlight_service=spotlight_service,
        ltws_service=ltws_service,
    )

    bridge = AppBridge(
        paths=paths,
        settings=settings,
        bing_service=bing_service,
        spotlight_service=spotlight_service,
        wallpaper_service=wallpaper_service,
        favorite_manager=favorite_manager,
        ltws_service=ltws_service,
        intelligent_market_service=intelligent_market_service,
        storage_service=storage_service,
        store_service=StoreService(),
        sniff_service=SniffService(),
        plugin_manager=PluginManager(
            paths.plugins_dir, paths.config_dir / "plugins.json"
        ),
        auto_change_service=auto_change_service,
        debug_session_enabled=debug_enabled,
        on_debug_settings_changed=refresh_debug_logging,
    )

    frontend_entry = paths.frontend_dist_dir / "index.html"
    if not frontend_entry.exists():
        raise FileNotFoundError(
            f"未找到前端构建产物: {frontend_entry}\n请先在 frontend 目录执行 npm install 和 npm run build。"
        )

    window = webview.create_window(
        title="小树壁纸 Next · PyWebview",
        url=str(frontend_entry),
        js_api=bridge,
        min_size=(1180, 760),
        width=1440,
        height=920,
    )
    bridge._attach_window(window)
    startup_timer: threading.Timer | None = None
    shutdown_lock = threading.Lock()
    shutdown_started = False

    def cancel_startup_timer() -> None:
        nonlocal startup_timer
        if startup_timer is not None:
            startup_timer.cancel()
            startup_timer = None

    def shutdown_application() -> None:
        nonlocal shutdown_started
        with shutdown_lock:
            if shutdown_started:
                return
            shutdown_started = True

        cancel_startup_timer()
        tray_service.stop()
        auto_change_service.shutdown()
        single_instance.release()

    tray_service = TrayService(
        on_show=lambda: _safe_window_call(window, "show"),
        on_change_once=lambda: bridge.trigger_auto_change_now(),
        on_quit=lambda: _shutdown(window, shutdown_application),
    )

    def after_start() -> None:
        nonlocal startup_timer
        tray_service.start()
        auto_change_service.start()
        _apply_window_icon_when_ready(window, _ICON_PATH)
        if settings.get("startup.wallpaper_change", False):
            delay_seconds = max(
                0, int(settings.get("startup.wallpaper_change_delay_seconds", 10))
            )
            startup_timer = threading.Timer(
                delay_seconds, bridge.trigger_auto_change_now
            )
            startup_timer.daemon = True
            startup_timer.start()
        if settings.get("startup.hide_on_launch", False):
            _safe_window_call(window, "hide")

    def on_closing() -> bool:
        if shutdown_started:
            return True
        if settings.get("ui.hide_on_close", True):
            _safe_window_call(window, "hide")
            return False
        shutdown_application()
        return True

    try:
        window.events.closing += on_closing
    except Exception:
        logger.warning(
            "pywebview closing event hook unavailable; close-to-tray disabled"
        )

    try:
        webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = bool(
            settings.get("debug.open_devtools_on_start", True)
        )
        webview.start(
            after_start,
            http_server=True,
            debug=debug_enabled,
            icon=_ICON_PATH,
        )
    finally:
        shutdown_application()


def _safe_window_call(window: webview.Window, method_name: str) -> None:
    try:
        getattr(window, method_name)()
    except Exception:
        logger.exception("window method %s failed", method_name)


def _shutdown(window: webview.Window, shutdown_application: Callable[[], None]) -> None:
    shutdown_application()
    try:
        window.destroy()
    except Exception:
        logger.exception("window destroy failed")


def _show_conflict_window() -> None:
    conflict_html = """
    <html><body style='font-family:Segoe UI,sans-serif;background:#f2ecdf;display:grid;place-items:center;height:100vh;margin:0;'>
      <div style='max-width:520px;padding:32px;border-radius:24px;background:#fffaf2;border:1px solid #d7c9b7;box-shadow:0 20px 60px rgba(0,0,0,.08)'>
        <h2 style='margin-top:0'>已有实例正在运行</h2>
        <p>小树壁纸 Next 已经在后台启动。请检查系统托盘，或关闭已有实例后再重新打开。</p>
      </div>
    </body></html>
    """
    webview.create_window(
        "冲突提示",
        html=conflict_html,
        width=620,
        height=320,
        resizable=False,
    )
    webview.start(debug=False)


def _apply_window_icon_when_ready(
    window: webview.Window,
    icon_path: Path,
    attempts: int = 12,
    delay_seconds: float = 0.25,
) -> None:
    native_window = getattr(window, "native", None)
    if native_window is None:
        if attempts <= 1:
            logger.debug("window native handle not ready; skip icon apply")
            return
        retry_timer = threading.Timer(
            delay_seconds,
            lambda: _apply_window_icon_when_ready(
                window,
                icon_path,
                attempts=attempts - 1,
                delay_seconds=delay_seconds,
            ),
        )
        retry_timer.daemon = True
        retry_timer.start()
        return
    _apply_window_icon(window, icon_path)


def _apply_window_icon(window: webview.Window, icon_path: Path) -> None:
    try:
        hwnd = window.native.Handle.ToInt32()
    except Exception:
        logger.opt(exception=True).debug("get window handle failed")
        return
    user32 = ctypes.windll.user32
    IMAGE_ICON = 1
    LR_LOADFROMFILE = 0x00000010
    LR_DEFAULTSIZE = 0x00000040
    WM_SETICON = 0x0080
    ICON_SMALL = 0
    ICON_BIG = 1
    hicon = user32.LoadImageW(
        None, str(icon_path), IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE
    )
    if hicon:
        user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, hicon)
        user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, hicon)
