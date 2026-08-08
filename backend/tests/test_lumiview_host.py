from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.lumiview_host import (
    EMBEDDED_WALLPAPER_GESTURE_GUARD,
    LumiViewHost,
    WindowThemeControls,
)
from backend.webview_config import (
    WEBVIEW2_DISABLED_FEATURES,
    WEBVIEW2_GESTURE_ARGUMENTS,
    configure_webview2_gesture_arguments,
)
from lumiview import Bridge, CloseBehavior, InitContext, Plugin


class LumiViewHostOptionsTests(unittest.TestCase):
    def test_webview2_gesture_arguments_merge_without_duplicates(self) -> None:
        with patch.dict("os.environ", {"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": "--existing --disable-features=ExistingFeature"}, clear=False):
            first = configure_webview2_gesture_arguments()
            second = configure_webview2_gesture_arguments()

        self.assertEqual(first, second)
        self.assertTrue(first.startswith("--existing "))
        for argument in WEBVIEW2_GESTURE_ARGUMENTS:
            self.assertEqual(first.split().count(argument), 1)
        disabled = next(argument for argument in first.split() if argument.startswith("--disable-features="))
        features = disabled.partition("=")[2].split(",")
        self.assertIn("ExistingFeature", features)
        for feature in WEBVIEW2_DISABLED_FEATURES:
            self.assertEqual(features.count(feature), 1)

    def test_all_windows_enable_autoplay_for_shared_web_context(self) -> None:
        options = LumiViewHost._window_options({"title": "Main"})

        self.assertTrue(options["autoplay"])
        self.assertEqual(options["close_behavior"], CloseBehavior.Hide)

    def test_legacy_window_options_are_mapped(self) -> None:
        options = LumiViewHost._window_options(
            {
                "hidden": True,
                "frameless": True,
                "focus": False,
                "shadow": False,
                "background_color": "#102030",
                "text_select": False,
                "easy_drag": False,
            }
        )

        self.assertFalse(options["visible"])
        self.assertFalse(options["decorations"])
        self.assertFalse(options["focused"])
        self.assertFalse(options["focusable"])
        self.assertFalse(options["undecorated_shadow"])
        self.assertEqual(options["background_color"], (16, 32, 48, 255))
        self.assertIn("bridge", options)
        self.assertNotIn("text_select", options)
        self.assertNotIn("easy_drag", options)

    def test_theme_controls_are_initialized_as_a_plugin(self) -> None:
        controls = WindowThemeControls()
        bridge = Bridge(includes=[controls])

        context = bridge._run_on_init(InitContext())

        self.assertIsInstance(controls, Plugin)
        self.assertIn("lumiview.windowTheme", context.inject_script)
        self.assertIn("windowTheme.set_acrylic", context.inject_script)

    def test_native_handle_uses_public_window_api(self) -> None:
        host = LumiViewHost.__new__(LumiViewHost)
        window = MagicMock()
        window.native_handle = AsyncMock(return_value=2048)

        async def read_handle() -> int:
            return await LumiViewHost.native_handle(host, window)

        self.assertEqual(asyncio.run(read_handle()), 2048)
        window.native_handle.assert_called_once_with()

    @patch("backend.lumiview_host.WebView")
    def test_embedded_webview_applies_positioned_bounds(self, webview_type: MagicMock) -> None:
        host = LumiViewHost.__new__(LumiViewHost)
        host._web_context = MagicMock()
        host._embedded_views = {}
        host._app = MagicMock()
        host._app.call_on_main.side_effect = lambda callback: callback()

        host.create_embedded_webview(10, 1920, 1080, "http://runtime", 1920, 0)

        options = webview_type.call_args.kwargs
        self.assertFalse(options["hotkeys_zoom"])
        self.assertFalse(options["back_forward_gestures"])
        self.assertEqual(options["initialization_script"], EMBEDDED_WALLPAPER_GESTURE_GUARD)
        webview_type.return_value.set_bounds.assert_called_once_with(1920, 0, 1920, 1080)


if __name__ == "__main__":
    unittest.main()
