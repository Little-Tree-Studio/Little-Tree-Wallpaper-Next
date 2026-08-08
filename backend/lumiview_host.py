from __future__ import annotations

import sys
import uuid
from collections.abc import Callable
from typing import Any

from backend.webview_config import configure_webview2_overscroll_arguments

configure_webview2_overscroll_arguments()

from lumiview import App, Bridge, BridgeContext, CloseBehavior, InitContext, Plugin, Window, WindowEffect  # noqa: E402
from lumiview.plugins import WindowControls  # noqa: E402
from wryview import WebContext, WebView, WindowHandleKind  # noqa: E402


class WindowThemeControls(Plugin):
    def __init__(self) -> None:
        super().__init__("windowTheme")
        self.command(self.set_acrylic)

    def on_init(self, context: InitContext) -> InitContext:
        command = self._full_name("set_acrylic")
        context.inject_script += f"""
(() => {{
  const lumiview = window.lumiview || (window.lumiview = {{}});
  lumiview.windowTheme = {{
    setAcrylic(enabled, dark) {{ return lumiview.invoke({command!r}, {{enabled, dark}}); }},
  }};
}})();
"""
        return context

    @staticmethod
    def set_acrylic(enabled: bool, dark: bool, context: BridgeContext) -> bool:
        if sys.platform == "win32":
            effect = WindowEffect.Acrylic
            tint = (18, 18, 22, 72) if dark else (255, 255, 255, 72)
        elif sys.platform == "darwin":
            effect = WindowEffect.Vibrancy
            tint = None
        else:
            return False
        try:
            if enabled:
                context.window.apply_effect(effect, tint).result()
            else:
                context.window.clear_effect(effect).result()
            return True
        except NotImplementedError:
            return False


class EmbeddedWebView:
    """Thread-safe reference to a WebView owned by the LumiView GUI thread."""

    def __init__(self, host: LumiViewHost, view_id: str) -> None:
        self._host = host
        self._view_id = view_id

    def load_url(self, url: str) -> Any:
        return self._host._call_embedded(self._view_id, "load_url", url)

    def eval_js(self, script: str) -> Any:
        return self._host._call_embedded(self._view_id, "eval_js", script)

    def close(self) -> Any:
        return self._host._close_embedded(self._view_id)


class LumiViewHost:
    def __init__(self, name: str, data_directory: str) -> None:
        self._app = App(name=name, exit_on_last_window=False)
        self._web_context = WebContext(data_directory=data_directory)
        self._embedded_views: dict[str, WebView] = {}

    async def create_window_async(self, **options: Any) -> Window:
        options.setdefault("web_context", self._web_context)
        return await Window.create(**self._window_options(options))

    async def native_handle(self, window: Window) -> int:
        return int(await window.native_handle())

    def create_embedded_webview(
        self,
        parent_hwnd: int,
        width: int,
        height: int,
        url: str,
        x: int = 0,
        y: int = 0,
    ) -> Any:
        view_id = uuid.uuid4().hex

        def create() -> EmbeddedWebView:
            webview = WebView(
                int(parent_hwnd),
                width=max(1, int(width)),
                height=max(1, int(height)),
                url=url,
                background_color=(0, 0, 0, 255),
                focused=False,
                autoplay=True,
                hotkeys_zoom=False,
                back_forward_gestures=False,
                clipboard=False,
                web_context=self._web_context,
                https_scheme=True,
                default_context_menus=False,
                as_child=True,
                parent_hwnd_kind=WindowHandleKind.Win32,
            )
            if x or y:
                webview.set_bounds(int(x), int(y), max(1, int(width)), max(1, int(height)))
            self._embedded_views[view_id] = webview
            return EmbeddedWebView(self, view_id)

        return self._app.call_on_main(create)

    def _call_embedded(self, view_id: str, method: str, *args: Any) -> Any:
        def invoke() -> None:
            webview = self._embedded_views.get(view_id)
            if webview is None:
                return
            getattr(webview, method)(*args)

        return self._app.call_on_main(invoke)

    def _close_embedded(self, view_id: str) -> Any:
        def close() -> None:
            webview = self._embedded_views.pop(view_id, None)
            if webview is not None:
                webview.close()

        return self._app.call_on_main(close)

    def create_window(self, **options: Any) -> Window:
        options.setdefault("web_context", self._web_context)
        return Window.create(**self._window_options(options)).result(timeout=30)

    def run(self, entry: Callable[[], Any]) -> int:
        return self._app.run(entry)

    def exit(self) -> None:
        def close_embedded_and_exit() -> None:
            for webview in list(self._embedded_views.values()):
                webview.close()
            self._embedded_views.clear()
            self._app.exit()

        self._app.call_on_main(close_embedded_and_exit)

    @staticmethod
    def _window_options(options: dict[str, Any]) -> dict[str, Any]:
        # WebView2 environment flags must match for every WebView that shares a
        # WebContext. Dynamic wallpapers require autoplay, so enable it for all
        # application windows rather than only the media host.
        options.setdefault("autoplay", True)
        options.setdefault("hotkeys_zoom", False)
        options.setdefault("back_forward_gestures", False)
        hidden = bool(options.pop("hidden", False))
        frameless = bool(options.pop("frameless", False))
        focus = bool(options.pop("focus", True))
        shadow = options.pop("shadow", None)
        background_color = options.pop("background_color", None)
        close_behavior = options.pop("close_behavior", CloseBehavior.Hide)

        # These legacy host flags have no LumiView equivalent.
        options.pop("text_select", None)
        options.pop("easy_drag", None)

        if frameless and "bridge" not in options:
            bridge = Bridge()
            bridge.include(WindowControls(drag_regions=True))
            bridge.include(WindowThemeControls())
            options["bridge"] = bridge
            options.setdefault("transparent", True)
            if background_color is None:
                background_color = (0, 0, 0, 0)

        if isinstance(background_color, str):
            color = background_color.lstrip("#")
            if len(color) == 6:
                background_color = tuple(int(color[index : index + 2], 16) for index in (0, 2, 4)) + (255,)
            else:
                background_color = None

        return {
            **options,
            "visible": not hidden,
            "decorations": not frameless,
            "focused": focus,
            "focusable": focus,
            "undecorated_shadow": shadow,
            "background_color": background_color,
            "close_behavior": close_behavior,
        }
