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


if __name__ == "__main__":
    unittest.main()
