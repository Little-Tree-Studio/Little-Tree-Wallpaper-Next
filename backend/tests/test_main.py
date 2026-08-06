from __future__ import annotations

import unittest

from backend.services.autostart import is_autostart_launch, should_start_hidden


class StartupModeTests(unittest.TestCase):
    def test_autostart_argument_is_detected(self) -> None:
        self.assertTrue(is_autostart_launch(["--autostart"]))
        self.assertFalse(is_autostart_launch([]))

    def test_only_autostart_launch_with_tray_can_start_hidden(self) -> None:
        self.assertTrue(
            should_start_hidden(autostart_launch=True, hide_on_launch=True, tray_enabled=True)
        )
        self.assertFalse(
            should_start_hidden(autostart_launch=False, hide_on_launch=True, tray_enabled=True)
        )
        self.assertFalse(
            should_start_hidden(autostart_launch=True, hide_on_launch=False, tray_enabled=True)
        )
        self.assertFalse(
            should_start_hidden(autostart_launch=True, hide_on_launch=True, tray_enabled=False)
        )


if __name__ == "__main__":
    unittest.main()
