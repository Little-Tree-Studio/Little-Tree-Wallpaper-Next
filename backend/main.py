"""Application entry point.

Starts a FastAPI backend (uvicorn) bound to ``127.0.0.1`` on a random free port
(so it is never exposed to the network), then opens a LumiView window pointed
at the backend. The frontend receives a per-session secret token via the launch
URL and uses it to authorize all API calls.
"""

from __future__ import annotations

import secrets
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from backend.webview_config import configure_webview2_gesture_arguments  # noqa: E402

configure_webview2_gesture_arguments()

import uvicorn
from loguru import logger
from lumiview import CloseBehavior

from backend.api import BackendAPI  # noqa: E402
from backend.app_meta import APP_NAME, BUILD_TIME, GIT_COMMIT, VERSION  # noqa: E402
from backend.logging_setup import LOG_DIR  # noqa: E402
from backend.logging_setup import configure as configure_logging  # noqa: E402
from backend.lumiview_host import LumiViewHost  # noqa: E402
from backend.paths import BASE_DIR, ensure_dirs, get_cache_dir  # noqa: E402
from backend.server import create_app  # noqa: E402
from backend.services.autostart import is_autostart_launch, should_start_hidden  # noqa: E402
from backend.tray import ApplicationTray  # noqa: E402

ensure_dirs()

# Rotating file sinks (full + error-only) plus the default console sink. The
# file level is configurable at runtime via the Help & Feedback page and only
# affects what is written to disk (the console is always verbose).
configure_logging()

# The backend must only listen on the loopback interface. Binding here (rather
# than to 0.0.0.0) is the primary guarantee that the API is not exposed.
HOST = "127.0.0.1"
READINESS_TIMEOUT = 15.0


def _find_free_port() -> int:
    """Return an OS-assigned free TCP port on the loopback interface."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        return sock.getsockname()[1]


def _write_log_header() -> None:
    """Write a startup header with version and environment information.

    Output goes directly to the terminal and the log file (raw, not via
    ``logger.info``) so the banner is never filtered out by the configured file
    log level.
    """
    from backend.logging_setup import write_raw

    header = "\n".join(
        [
            "=" * 60,
            f"{APP_NAME} - Session started",
            f"Version: {VERSION} (commit {GIT_COMMIT or 'dev'})",
            f"Built:   {BUILD_TIME or 'unknown'}",
            f"Platform: {sys.platform}",
            f"Python: {sys.version.replace(chr(10), ' ')}",
            f"Cache directory: {get_cache_dir()}",
            "=" * 60,
        ]
    )
    write_raw(header)


def _app_version() -> str:
    """Return the application version constant from :mod:`backend.app_meta`."""
    return VERSION


def _latest_log_file() -> Path | None:
    """Return the most recent application log file, or None if missing."""
    try:
        log_files = sorted(
            (f for f in LOG_DIR.glob("app_*.log") if f.is_file()),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return None
    return log_files[0] if log_files else None


def _tail_log_file(path: Path, lines: int = 120) -> str:
    """Return the last ``lines`` lines from a log file."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        return "".join(all_lines[-lines:]) if all_lines else ""
    except OSError as exc:
        return f"<无法读取日志: {exc}>"


def _generate_crash_report(exc_info: traceback.TracebackException | None = None) -> Path:
    """Generate a crash report file and return its path.

    The report includes the exception traceback, environment details and the
    tail of the current log file so users can attach it when reporting issues.
    """
    report_dir = get_cache_dir() / "crash_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = report_dir / f"crash_report_{timestamp}.txt"

    exception_text = ""
    if exc_info is not None:
        exception_text = "".join(exc_info.format())

    log_tail = ""
    latest_log = _latest_log_file()
    if latest_log:
        log_tail = _tail_log_file(latest_log, lines=200)

    report = f"""Little Tree Wallpaper Next - Crash Report
============================================================
Time: {datetime.now().isoformat()}
Version: {_app_version()}
Platform: {sys.platform}
Python: {sys.version}
Executable: {sys.executable}
Command line: {" ".join(sys.argv)}

------------------------------------------------------------
Exception traceback
------------------------------------------------------------
{exception_text or "Unknown error (no traceback available)"}

------------------------------------------------------------
Recent log tail ({latest_log or "no log file"})
------------------------------------------------------------
{log_tail}
"""
    report_path.write_text(report, encoding="utf-8")
    return report_path


def _install_global_exception_hook() -> None:
    """Install sys.excepthook so uncaught exceptions generate a crash report."""
    original_hook = sys.excepthook

    def _hook(exc_type: type[BaseException], exc_value: BaseException, tb: Any) -> None:
        try:
            exc_info = traceback.TracebackException(exc_type, exc_value, tb)
            report_path = _generate_crash_report(exc_info)
            logger.error("Unhandled exception, crash report written to {}", report_path)
        except Exception as hook_error:  # noqa: BLE001 - must not recurse
            logger.error("Failed to generate crash report: {}", hook_error)
        original_hook(exc_type, exc_value, tb)

    sys.excepthook = _hook


# Install the hook as early as possible so import-time crashes are captured.
_install_global_exception_hook()


def _wait_for_ready(base_url: str, token: str, timeout: float = READINESS_TIMEOUT) -> None:
    """Poll the health endpoint until the server responds or the timeout elapses."""
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    health_url = f"{base_url}/api/health"
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request(health_url, headers={"X-Api-Token": token})
            with urllib.request.urlopen(req, timeout=2) as resp:  # noqa: S310 - loopback only
                if resp.status == 200:
                    return
        except Exception as exc:  # noqa: BLE001 - server may not be up yet
            last_error = exc
            time.sleep(0.1)
    raise RuntimeError(f"Backend did not become ready within {timeout}s: {last_error}")


def _start_backend(api: BackendAPI, token: str, port: int) -> uvicorn.Server:
    """Create and start the uvicorn server on a background daemon thread."""
    frontend_dir = BASE_DIR / "frontend" / "dist"
    app = create_app(api, token, frontend_dir)

    # Access logs are handled by RequestLoggingMiddleware; disable uvicorn's own
    # access logger to avoid double logging. log_level keeps uvicorn's internal
    # noise down while letting our middleware log requests at INFO.
    config = uvicorn.Config(
        app,
        host=HOST,
        port=port,
        log_config=None,
        access_log=False,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="uvicorn", daemon=True)
    thread.start()
    logger.info("Backend server thread started on http://{}:{}", HOST, port)
    return server


def _resolve_icon(frontend_dir: Path) -> str | None:
    ico = frontend_dir / "logo.ico"
    if ico.exists():
        return str(ico)
    png = frontend_dir / "logo.png"
    if png.exists():
        return str(png)
    return None


def _ensure_frontend(frontend_dir: Path) -> Path:
    """Return the index.html path, creating a minimal placeholder if missing."""
    index_html = frontend_dir / "index.html"
    if index_html.exists():
        return index_html

    logger.warning("Frontend build not found at {}. Run 'npm run build' in frontend/.", index_html)
    frontend_dir.mkdir(parents=True, exist_ok=True)
    index_html.write_text(
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<title>{APP_NAME}</title></head>"
        "<body><div id='root'><h1>前端未构建</h1>"
        "<p>请在 frontend 目录运行 npm install && npm run build</p></div></body></html>",
        encoding="utf-8",
    )
    return index_html


def main() -> None:
    _write_log_header()
    frontend_dir = BASE_DIR / "frontend" / "dist"
    _ensure_frontend(frontend_dir)

    token = secrets.token_urlsafe(32)
    port = _find_free_port()
    base_url = f"http://{HOST}:{port}"

    api = BackendAPI()
    api.set_api_token(token)
    autostart_launch = is_autostart_launch(sys.argv[1:])
    start_hidden = should_start_hidden(
        autostart_launch=autostart_launch,
        hide_on_launch=bool(api.store.get("startup.hide_on_launch", True)),
        tray_enabled=bool(api.store.get("ui.minimize_to_tray", True)),
    )
    logger.info("Launch source: {}; main window hidden: {}", "autostart" if autostart_launch else "manual", start_hidden)
    server: uvicorn.Server | None = None
    try:
        server = _start_backend(api, token, port)
        try:
            _wait_for_ready(base_url, token)
        except Exception as exc:
            report_path = _generate_crash_report()
            logger.error("Backend startup failed: {}. Crash report: {}", exc, report_path)
            raise

        # The token is delivered to the frontend via the launch URL; the React app
        # reads it once, stores it in sessionStorage and strips it from the bar.
        launch_url = f"{base_url}/?token={token}"
        logger.info("Launching LumiView window at {}", base_url)

        try:
            host = LumiViewHost(APP_NAME, str(get_cache_dir() / "webview"))
            runtime_error: list[BaseException] = []

            async def start_runtime() -> None:
                try:
                    icon_path = _resolve_icon(frontend_dir)
                    main_window = await host.create_window_async(
                        title=APP_NAME,
                        url=launch_url,
                        width=1200,
                        height=800,
                        min_size=(800, 600),
                        hidden=start_hidden,
                        focus=not start_hidden,
                        icon=icon_path,
                        devtools=True,
                        frameless=True,
                    )
                    logger.info("LumiView main window created")
                    widget_editor = await host.create_window_async(
                        title="小组件编辑器",
                        html="<!doctype html><html><body style='margin:0;background:#111'></body></html>",
                        width=1120,
                        height=760,
                        min_size=(800, 600),
                        hidden=True,
                        icon=icon_path,
                        close_behavior=CloseBehavior.Hide,
                        frameless=True,
                    )
                    logger.info("LumiView widget editor created")
                    api.configure_dynamic_wallpaper_runtime(
                        base_url,
                        token,
                        host.create_embedded_webview,
                    )
                    editor_url = f"{base_url}/?token={token}#/dynamic/editor"
                    api.configure_dynamic_editor_runtime(widget_editor, editor_url)

                    def create_main_window() -> Any:
                        return host.create_window(
                            title=APP_NAME,
                            url=launch_url,
                            width=1200,
                            height=800,
                            min_size=(800, 600),
                            icon=icon_path,
                            devtools=True,
                            frameless=True,
                        )

                    def stop_runtime() -> None:
                        server.should_exit = True
                        host.exit()

                    tray = ApplicationTray(
                        api=api,
                        title=APP_NAME,
                        icon_path=icon_path,
                        create_main_window=create_main_window,
                        on_quit=stop_runtime,
                    )
                    api._configure_desktop_notifications(tray.notify)
                    tray.attach_main_window(main_window)
                    api.start_automation_runtime()
                    tray_started = tray.start()
                    if start_hidden and not tray_started:
                        logger.warning("Hidden launch requested but the system tray is unavailable; showing the main window")
                        main_window.show()
                        main_window.minimize(False)
                except BaseException as exc:
                    logger.exception("LumiView runtime initialization failed: {}", exc)
                    runtime_error.append(exc)
                    host.exit()

            host.run(start_runtime)
            if runtime_error:
                raise runtime_error[0]
        except Exception as exc:
            report_path = _generate_crash_report()
            logger.error("Window runtime error: {}. Crash report: {}", exc, report_path)
            raise
    finally:
        logger.info("Stopping backend server and plugins")
        api.shutdown_automation()
        api.shutdown_dynamic_wallpaper()
        if server is not None:
            server.should_exit = True
        api.plugin_manager.shutdown()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.error("Application terminated abnormally: {}", exc)
        raise
