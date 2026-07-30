from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.tray import ApplicationTray


class ApplicationTrayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = MagicMock()
        self.tray = ApplicationTray(
            api=self.api,
            launch_url="http://127.0.0.1/",
            title="Little Tree",
            icon_path=None,
            dynamic_host=MagicMock(),
            on_quit=MagicMock(),
        )

    def test_notification_api_is_available(self) -> None:
        self.assertTrue(callable(self.tray.notify))

    @patch("backend.tray.sys.platform", "linux")
    def test_notification_falls_back_to_tray_icon(self) -> None:
        icon = MagicMock()
        self.tray._tray_icon = icon

        self.tray.notify("Title", "Message")

        icon.notify.assert_called_once_with("Message", "Title")

    @patch("backend.tray.webview.create_window")
    def test_show_recreates_released_window(self, create_window: MagicMock) -> None:
        window = MagicMock()
        create_window.return_value = window

        self.tray.show_main_window()

        self.assertIs(self.tray._main_window, window)
        create_window.assert_called_once()

    def test_quit_stops_dynamic_wallpaper_before_destroying_host(self) -> None:
        calls: list[str] = []
        main_window = MagicMock()
        self.tray._main_window = main_window
        self.tray._api.shutdown_dynamic_wallpaper.side_effect = lambda: calls.append("shutdown")
        self.tray._dynamic_host.destroy.side_effect = lambda: calls.append("destroy-host")

        self.tray.quit()

        self.assertEqual(calls, ["shutdown", "destroy-host"])
        main_window.destroy.assert_called_once_with()
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
