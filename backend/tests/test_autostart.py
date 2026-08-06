from __future__ import annotations

import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from backend.api import BackendAPI
from backend.services.autostart import AUTOSTART_ARGUMENT, MACOS_LABEL, AutostartService


class MemoryWindowsAutostart(AutostartService):
    value: str | None = None

    def _read_windows_value(self) -> str:
        if self.value is None:
            raise FileNotFoundError
        return self.value

    def _write_windows_value(self, value: str) -> None:
        self.value = value

    def _delete_windows_value(self) -> None:
        self.value = None


class AutostartServiceTests(unittest.TestCase):
    def test_windows_entry_round_trip_and_disable(self) -> None:
        service = MemoryWindowsAutostart(
            "Little Tree",
            platform="win32",
            executable=Path("C:/Program Files/Little Tree/app.exe"),
            frozen=True,
        )

        enabled = service.set_enabled(True)

        self.assertTrue(enabled["enabled"])
        self.assertEqual(service.value, subprocess.list2cmdline(service.launch_arguments()))
        disabled = service.set_enabled(False)
        self.assertFalse(disabled["enabled"])
        self.assertIsNone(service.value)

    def test_frozen_launch_uses_only_current_executable(self) -> None:
        service = AutostartService(
            "Little Tree",
            platform="win32",
            executable=Path("C:/Program Files/Little Tree/app.exe"),
            frozen=True,
        )

        self.assertEqual(service.launch_arguments(), [str(service.executable), AUTOSTART_ARGUMENT])
        command = subprocess.list2cmdline(service.launch_arguments())
        self.assertIn(str(service.executable), command)
        self.assertTrue(command.startswith('"'))

    def test_source_launch_uses_absolute_entrypoint(self) -> None:
        service = AutostartService(
            "Little Tree",
            platform="linux",
            executable=Path("/usr/bin/python3"),
            entrypoint=Path("/opt/little tree/backend/main.py"),
            frozen=False,
        )

        self.assertEqual(
            service.launch_arguments(),
            [str(service.executable), str(service.entrypoint), AUTOSTART_ARGUMENT],
        )

    def test_linux_entry_round_trip_and_disable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = AutostartService(
                "Little Tree",
                platform="linux",
                executable=root / "Little Tree",
                home=root,
                environ={"XDG_CONFIG_HOME": str(root / "xdg")},
                frozen=True,
            )

            enabled = service.set_enabled(True)

            self.assertTrue(enabled["enabled"])
            entry = root / "xdg" / "autostart" / "little-tree-wallpaper.desktop"
            self.assertIn(f"Exec={service._desktop_exec()}", entry.read_text(encoding="utf-8"))
            self.assertFalse(entry.read_text(encoding="utf-8").endswith("\n\n"))
            disabled = service.set_enabled(False)
            self.assertFalse(disabled["enabled"])
            self.assertFalse(entry.exists())

    def test_macos_entry_uses_launch_agent_program_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = AutostartService(
                "Little Tree",
                platform="darwin",
                executable=root / "Little Tree.app" / "Contents" / "MacOS" / "Little Tree",
                home=root,
                frozen=True,
            )

            status = service.set_enabled(True)

            self.assertTrue(status["enabled"])
            entry = root / "Library" / "LaunchAgents" / f"{MACOS_LABEL}.plist"
            with entry.open("rb") as file:
                payload = plistlib.load(file)
            self.assertEqual(payload["ProgramArguments"], service.launch_arguments())
            self.assertTrue(payload["RunAtLoad"])

    def test_stale_linux_entry_is_registered_but_not_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / ".config" / "autostart" / "little-tree-wallpaper.desktop"
            entry.parent.mkdir(parents=True)
            entry.write_text("[Desktop Entry]\nExec=\"/old/app\" --autostart\n", encoding="utf-8")
            service = AutostartService("Little Tree", platform="linux", home=root, frozen=True)

            status = service.status()

            self.assertTrue(status["registered"])
            self.assertFalse(status["enabled"])
            self.assertFalse(status["command_matches"])

    def test_linux_snapshot_restores_previous_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / ".config" / "autostart" / "little-tree-wallpaper.desktop"
            entry.parent.mkdir(parents=True)
            original = b"[Desktop Entry]\nExec=\"/old/app\" --autostart\n"
            entry.write_bytes(original)
            service = AutostartService("Little Tree", platform="linux", home=root, frozen=True)

            snapshot = service.capture()
            service.set_enabled(True)
            service.restore(snapshot)

            self.assertEqual(entry.read_bytes(), original)

    def test_desktop_environment_disable_flag_is_respected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = AutostartService("Little Tree", platform="linux", home=root, frozen=True)
            service.set_enabled(True)
            entry = root / ".config" / "autostart" / "little-tree-wallpaper.desktop"
            content = entry.read_text(encoding="utf-8").replace(
                "X-GNOME-Autostart-enabled=true",
                "X-GNOME-Autostart-enabled=false",
            )
            entry.write_text(content, encoding="utf-8")

            self.assertFalse(service.status()["enabled"])

    def test_unknown_platform_is_reported_as_unsupported(self) -> None:
        status = AutostartService("Little Tree", platform="haiku").status()

        self.assertFalse(status["supported"])
        self.assertTrue(status["reason"])


class AutostartApiTests(unittest.TestCase):
    def test_config_failure_restores_previous_system_entry(self) -> None:
        api = BackendAPI.__new__(BackendAPI)
        api.store = MagicMock()
        api.store.set.side_effect = OSError("config locked")
        api._autostart_service = MagicMock()
        api._autostart_service.capture.return_value = (True, "old command")
        api._autostart_service.set_enabled.return_value = {
            "supported": True,
            "enabled": True,
        }

        with self.assertRaisesRegex(OSError, "config locked"):
            api.set_autostart_enabled(True)

        api._autostart_service.restore.assert_called_once_with((True, "old command"))


if __name__ == "__main__":
    unittest.main()
