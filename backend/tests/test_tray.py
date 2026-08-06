from __future__ import annotations

import unittest
from unittest.mock import MagicMock, call, patch

from backend.tray import ApplicationTray


class ApplicationTrayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = MagicMock()
        self.tray = ApplicationTray(
            api=self.api,
            title="Little Tree",
            icon_path=None,
            create_main_window=MagicMock(),
            on_quit=MagicMock(),
        )

    def test_notification_api_is_available(self) -> None:
        self.assertTrue(callable(self.tray.notify))

    def test_start_returns_false_when_tray_is_disabled(self) -> None:
        self.tray._api.store.get.return_value = False

        self.assertFalse(self.tray.start())

    @patch("backend.tray.sys.platform", "linux")
    def test_notification_falls_back_to_tray_icon(self) -> None:
        icon = MagicMock()
        self.tray._tray_icon = icon

        self.tray.notify("Title", "Message")

        icon.notify.assert_called_once_with("Message", "Title")

    def test_show_recreates_released_window(self) -> None:
        window = MagicMock()
        self.tray._create_main_window.return_value = window

        self.tray.show_main_window()

        self.assertIs(self.tray._main_window, window)
        self.tray._create_main_window.assert_called_once()

    def test_dynamic_play_and_pause_dispatch_to_backend(self) -> None:
        self.tray._dynamic_action("play")
        self.tray._dynamic_action("pause")

        self.assertEqual(
            self.api.control_dynamic_wallpaper.call_args_list,
            [call("play"), call("pause")],
        )

    def test_quit_stops_dynamic_wallpaper_before_closing_main_window(self) -> None:
        calls: list[str] = []
        main_window = MagicMock()
        self.tray._main_window = main_window
        self.tray._api.shutdown_dynamic_wallpaper.side_effect = lambda: calls.append("shutdown")
        main_window.close.side_effect = lambda: calls.append("close-main")

        self.tray.quit()

        self.assertEqual(calls, ["shutdown", "close-main"])
        main_window.close.assert_called_once_with()
        self.tray._on_quit.assert_called_once_with()

    def test_closing_main_window_stops_dynamic_wallpaper_before_hiding(self) -> None:
        window = MagicMock()
        self.tray._main_window = window
        preferences = {
            "ui.hide_on_close": True,
            "ui.minimize_to_tray": True,
            "ui.release_webview_on_close": False,
        }
        self.tray._api.store.get.side_effect = lambda key, default=None: preferences.get(key, default)

        result = self.tray._on_main_closing()

        self.assertFalse(result)
        self.tray._api.stop_dynamic_wallpaper.assert_called_once_with()
        window.hide.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
