from __future__ import annotations

import subprocess
import unittest
from unittest.mock import call, patch

from backend.services import sys_wallpaper


class TrySubprocessTests(unittest.TestCase):
    def test_default_timeout(self) -> None:
        cmd = ["gsettings", "get", "schema", "key"]
        with patch.object(sys_wallpaper.subprocess, "check_output", return_value="") as check_output:
            sys_wallpaper._try_subprocess(cmd)

        check_output.assert_called_once_with(cmd, text=True, timeout=5)

    def test_explicit_timeout_override(self) -> None:
        for timeout in (1.25, 0, None):
            with self.subTest(timeout=timeout):
                with patch.object(sys_wallpaper.subprocess, "check_output", return_value="") as check_output:
                    sys_wallpaper._try_subprocess(["command"], timeout=timeout, stderr=subprocess.DEVNULL)

                check_output.assert_called_once_with(
                    ["command"], text=True, timeout=timeout, stderr=subprocess.DEVNULL,
                )

    def test_timeout_is_logged_and_returns_none(self) -> None:
        cmd = ["command"]
        with (
            patch.object(sys_wallpaper.subprocess, "check_output", side_effect=subprocess.TimeoutExpired(cmd, 5)),
            patch.object(sys_wallpaper.logger, "debug") as debug,
        ):
            self.assertIsNone(sys_wallpaper._try_subprocess(cmd))

        debug.assert_called_once()
        self.assertEqual(debug.call_args.args[1:], (cmd, 5))

    def test_successful_output_is_stripped(self) -> None:
        with patch.object(sys_wallpaper.subprocess, "check_output", return_value=" \t/wallpaper.jpg\r\n"):
            self.assertEqual(sys_wallpaper._try_subprocess(["command"]), "/wallpaper.jpg")

    def test_missing_executable_returns_none(self) -> None:
        with patch.object(sys_wallpaper.subprocess, "check_output", side_effect=FileNotFoundError):
            self.assertIsNone(sys_wallpaper._try_subprocess(["missing-command"]))

    def test_failed_command_returns_none(self) -> None:
        with patch.object(
            sys_wallpaper.subprocess, "check_output",
            side_effect=subprocess.CalledProcessError(1, ["command"], stderr="failed"),
        ):
            self.assertIsNone(sys_wallpaper._try_subprocess(["command"]))

    def test_linux_falls_back_to_kde_after_gsettings_timeouts(self) -> None:
        commands = [
            ["gsettings", "get", "org.gnome.desktop.background", "picture-uri-dark"],
            ["gsettings", "get", "org.gnome.desktop.background", "picture-uri"],
            ["gsettings", "get", "org.cinnamon.desktop.background", "picture-uri"],
            ["gsettings", "get", "org.mate.background", "picture-filename"],
            [
                "kreadconfig6", "--file", "plasma-org.kde.plasma.desktop-appletsrc",
                "--group", "Containments", "--group", "1", "--group", "Wallpaper",
                "--group", "org.kde.image", "--group", "General", "--key", "Image",
            ],
        ]
        results = [subprocess.TimeoutExpired(cmd, 5) for cmd in commands[:-1]]
        with (
            patch.object(sys_wallpaper, "os") as mock_os,
            patch.object(sys_wallpaper.sys, "platform", "linux"),
            patch.object(
                sys_wallpaper.subprocess, "check_output",
                side_effect=[*results, "file:///wallpaper.jpg\n"],
            ) as check_output,
        ):
            mock_os.name = "posix"
            mock_os.path.isfile.return_value = True

            self.assertEqual(sys_wallpaper.get_sys_wallpaper(), "/wallpaper.jpg")
            mock_os.path.isfile.assert_called_once_with("/wallpaper.jpg")

        self.assertEqual(
            check_output.call_args_list,
            [call(cmd, text=True, timeout=5) for cmd in commands],
        )


if __name__ == "__main__":
    unittest.main()
