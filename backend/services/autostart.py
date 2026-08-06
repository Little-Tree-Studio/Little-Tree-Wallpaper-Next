from __future__ import annotations

import os
import plistlib
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

try:
    import winreg
except ImportError:  # pragma: no cover - available only on Windows
    winreg = None  # type: ignore[assignment]

AUTOSTART_ARGUMENT = "--autostart"
WINDOWS_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
WINDOWS_VALUE_NAME = "LittleTreeWallpaper"
MACOS_LABEL = "com.littletreestudio.littletreewallpaper"
LINUX_DESKTOP_FILENAME = "little-tree-wallpaper.desktop"


def is_autostart_launch(arguments: Sequence[str]) -> bool:
    return AUTOSTART_ARGUMENT in arguments


def should_start_hidden(*, autostart_launch: bool, hide_on_launch: bool, tray_enabled: bool) -> bool:
    return autostart_launch and hide_on_launch and tray_enabled


class AutostartService:
    """Manage the current user's login item without requiring elevation."""

    def __init__(
        self,
        app_name: str,
        *,
        platform: str | None = None,
        executable: Path | None = None,
        entrypoint: Path | None = None,
        home: Path | None = None,
        environ: dict[str, str] | None = None,
        frozen: bool | None = None,
    ) -> None:
        self.app_name = app_name
        self.platform = platform or sys.platform
        self.executable = (executable or Path(sys.executable)).resolve()
        self.entrypoint = (entrypoint or Path(__file__).resolve().parents[1] / "main.py").resolve()
        self.home = (home or Path.home()).resolve()
        self.environ = environ if environ is not None else os.environ
        self.frozen = bool(getattr(sys, "frozen", False)) if frozen is None else frozen

    @property
    def supported(self) -> bool:
        return self.platform == "win32" or self.platform == "darwin" or self.platform.startswith(
            ("linux", "freebsd", "openbsd", "netbsd", "dragonfly")
        )

    @property
    def mechanism(self) -> str:
        if self.platform == "win32":
            return "Windows 登录启动项"
        if self.platform == "darwin":
            return "macOS LaunchAgent"
        return "XDG Autostart"

    @property
    def platform_label(self) -> str:
        if self.platform == "win32":
            return "Windows"
        if self.platform == "darwin":
            return "macOS"
        if self.supported:
            return "Linux / Unix"
        return self.platform

    def launch_arguments(self) -> list[str]:
        if self.frozen:
            return [str(self.executable), AUTOSTART_ARGUMENT]
        return [str(self.executable), str(self.entrypoint), AUTOSTART_ARGUMENT]

    def status(self) -> dict[str, Any]:
        base = {
            "supported": self.supported,
            "enabled": False,
            "registered": False,
            "command_matches": False,
            "platform": self.platform_label,
            "mechanism": self.mechanism if self.supported else "",
            "reason": "",
        }
        if not self.supported:
            base["reason"] = "当前操作系统没有可用的用户级自启动实现"
            return base
        try:
            registered, command_matches = self._read_state()
        except Exception as exc:  # noqa: BLE001 - status must remain queryable
            base["reason"] = f"无法读取系统启动项：{exc}"
            return base
        base.update(
            {
                "enabled": registered and command_matches,
                "registered": registered,
                "command_matches": command_matches,
            }
        )
        if registered and not command_matches:
            base["reason"] = "启动项指向了其他位置，请重新启用以修复"
        return base

    def set_enabled(self, enabled: bool) -> dict[str, Any]:
        if not self.supported:
            raise RuntimeError("当前操作系统不支持开机自启动")
        if enabled:
            self._enable()
        else:
            self._disable()
        status = self.status()
        if enabled and not status["enabled"]:
            raise RuntimeError(status["reason"] or "系统启动项写入后未生效")
        return status

    def capture(self) -> Any:
        if not self.supported:
            return None
        if self.platform == "win32":
            try:
                return True, self._read_windows_value()
            except FileNotFoundError:
                return False, None
        path = self._entry_path()
        try:
            return True, path.read_bytes()
        except FileNotFoundError:
            return False, None

    def restore(self, snapshot: Any) -> None:
        if not self.supported or snapshot is None:
            return
        existed, value = snapshot
        if self.platform == "win32":
            if existed:
                self._write_windows_value(str(value))
            else:
                self._delete_windows_value()
            return
        path = self._entry_path()
        if existed:
            self._write_file(path, bytes(value), 0o600 if self.platform == "darwin" else 0o644)
        else:
            path.unlink(missing_ok=True)

    def _read_state(self) -> tuple[bool, bool]:
        if self.platform == "win32":
            try:
                value = self._read_windows_value()
            except FileNotFoundError:
                return False, False
            expected = subprocess.list2cmdline(self.launch_arguments())
            return True, value == expected

        path = self._entry_path()
        if not path.is_file():
            return False, False
        if self.platform == "darwin":
            try:
                with path.open("rb") as file:
                    value = plistlib.load(file)
            except (OSError, plistlib.InvalidFileException):
                return True, False
            matches = (
                value.get("Label") == MACOS_LABEL
                and value.get("ProgramArguments") == self.launch_arguments()
                and value.get("RunAtLoad") is True
            )
            return True, matches

        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            return True, False
        expected_exec = f"Exec={self._desktop_exec()}"
        lines = content.splitlines()
        matches = (
            expected_exec in lines
            and "Hidden=true" not in lines
            and "X-GNOME-Autostart-enabled=false" not in lines
        )
        return True, matches

    def _enable(self) -> None:
        if self.platform == "win32":
            self._write_windows_value(subprocess.list2cmdline(self.launch_arguments()))
            return
        if self.platform == "darwin":
            payload = plistlib.dumps(
                {
                    "Label": MACOS_LABEL,
                    "ProgramArguments": self.launch_arguments(),
                    "RunAtLoad": True,
                    "ProcessType": "Interactive",
                },
                fmt=plistlib.FMT_XML,
                sort_keys=True,
            )
            self._write_file(self._entry_path(), payload, 0o600)
            return
        payload = "\n".join(
            [
                "[Desktop Entry]",
                "Type=Application",
                f"Name={self.app_name}",
                f"Exec={self._desktop_exec()}",
                "Terminal=false",
                "Hidden=false",
                "X-GNOME-Autostart-enabled=true",
                "",
            ]
        ).encode("utf-8")
        self._write_file(self._entry_path(), payload, 0o644)

    def _disable(self) -> None:
        if self.platform == "win32":
            self._delete_windows_value()
        else:
            self._entry_path().unlink(missing_ok=True)

    def _entry_path(self) -> Path:
        if self.platform == "darwin":
            return self.home / "Library" / "LaunchAgents" / f"{MACOS_LABEL}.plist"
        configured_home = self.environ.get("XDG_CONFIG_HOME", "")
        configured_path = Path(configured_home).expanduser() if configured_home else None
        config_home = configured_path if configured_path and configured_path.is_absolute() else self.home / ".config"
        return config_home / "autostart" / LINUX_DESKTOP_FILENAME

    def _desktop_exec(self) -> str:
        return " ".join(self._quote_desktop_argument(argument) for argument in self.launch_arguments())

    @staticmethod
    def _quote_desktop_argument(value: str) -> str:
        escaped = (
            value.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("`", "\\`")
            .replace("$", "\\$")
            .replace("%", "%%")
        )
        return f'"{escaped}"'

    @staticmethod
    def _write_file(path: Path, payload: bytes, mode: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as file:
                temporary_path = Path(file.name)
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())
            os.chmod(temporary_path, mode)
            os.replace(temporary_path, path)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _winreg() -> Any:
        if winreg is None:
            raise RuntimeError("Windows 注册表模块不可用")
        return winreg

    def _read_windows_value(self) -> str:
        winreg = self._winreg()
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_KEY, 0, winreg.KEY_READ) as key:
            value, _value_type = winreg.QueryValueEx(key, WINDOWS_VALUE_NAME)
        return str(value)

    def _write_windows_value(self, value: str) -> None:
        winreg = self._winreg()
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, WINDOWS_VALUE_NAME, 0, winreg.REG_SZ, value)

    def _delete_windows_value(self) -> None:
        winreg = self._winreg()
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
                winreg.DeleteValue(key, WINDOWS_VALUE_NAME)
        except FileNotFoundError:
            pass
