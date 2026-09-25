from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.desktop_bridge import DesktopEnvironment, DesktopNotification


class DesktopEnvironmentTests(unittest.TestCase):
    def test_capabilities_are_normalized(self) -> None:
        environment = DesktopEnvironment(
            wallpaper_getter=lambda: "C:/wallpaper.jpg",
            display_getter=lambda: [{"id": "primary", "is_primary": True}],
        )

        with patch("backend.desktop_bridge.environment.sys.platform", "win32"):
            self.assertEqual(environment.platform, "windows")
            self.assertEqual(environment.get_wallpaper(), "C:/wallpaper.jpg")
            self.assertTrue(environment.capabilities()["wallpaper"]["set"])

    def test_notification_uses_sink_before_native_and_fallback(self) -> None:
        events: list[str] = []
        environment = DesktopEnvironment()
        environment.set_notification_sink(lambda request: events.append(f"sink:{request.title}") or False)
        environment.set_notification_fallback(lambda request: events.append(f"fallback:{request.message}") or True)

        self.assertTrue(environment.notify("Title", "Message", urgency="invalid"))
        self.assertEqual(events, ["sink:Title", "fallback:Message"])

    def test_notification_normalizes_request_values(self) -> None:
        received: list[DesktopNotification] = []
        environment = DesktopEnvironment()
        environment.set_notification_sink(lambda request: received.append(request) or True)

        self.assertTrue(environment.notify("Title", "Message", urgency="critical", timeout_ms=999_999))
        self.assertEqual(received[0].urgency, "critical")
        self.assertEqual(received[0].timeout_ms, 120_000)

    def test_set_wallpaper_delegates_to_adapter(self) -> None:
        setter = MagicMock()
        environment = DesktopEnvironment(wallpaper_setter=setter)

        environment.set_wallpaper("~/wallpaper.jpg")

        setter.assert_called_once()
        self.assertTrue(str(setter.call_args.args[0]).endswith("wallpaper.jpg"))


if __name__ == "__main__":
    unittest.main()
