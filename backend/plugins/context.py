from __future__ import annotations

import contextlib
import json
import os
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .validation import (
    MAX_JSON_SIZE,
    PluginValidationError,
    json_copy,
    validate_contribution,
    validate_identifier,
    validate_setting_key,
)


class PluginContext:
    """Narrow host interface made available to trusted plugin setup and hooks."""

    __slots__ = (
        "_actions",
        "_contributions",
        "_lock",
        "_permissions",
        "_settings_path",
        "cache_path",
        "config_path",
        "data_path",
        "logger",
        "plugin_id",
        "plugin_path",
    )

    def __init__(
        self,
        plugin_id: str,
        plugin_path: Path,
        data_path: Path,
        config_path: Path,
        cache_path: Path,
        permissions: set[str] | frozenset[str],
        logger: Any,
    ) -> None:
        self.plugin_id = plugin_id
        self.plugin_path = plugin_path
        self.data_path = data_path
        self.config_path = config_path
        self.cache_path = cache_path
        self.logger = logger
        self._permissions = frozenset(permissions)
        self._actions: dict[str, Callable[[Any], Any]] = {}
        self._contributions: dict[str, list[dict[str, Any]]] = {}
        self._settings_path = config_path / "settings.json"
        self._lock = threading.RLock()
        for path in (data_path, config_path, cache_path):
            path.mkdir(parents=True, exist_ok=True)

    def get_setting(self, key: str, default: Any = None) -> Any:
        parts = validate_setting_key(key).split(".")
        with self._lock:
            data = self._read_settings()
            current: Any = data
            for part in parts:
                if not isinstance(current, dict) or part not in current:
                    return json_copy(default, label="setting default")
                current = current[part]
            return json_copy(current, label="setting value")

    def set_setting(self, key: str, value: Any) -> None:
        parts = validate_setting_key(key).split(".")
        checked = json_copy(value, limit=MAX_JSON_SIZE, label="setting value")
        with self._lock:
            data = self._read_settings()
            current = data
            for part in parts[:-1]:
                child = current.get(part)
                if not isinstance(child, dict):
                    child = {}
                    current[part] = child
                current = child
            current[parts[-1]] = checked
            self._write_settings(data)

    def register_action(self, action_id: str, action: Callable[[Any], Any]) -> None:
        checked_id = validate_identifier(action_id, "action ID", max_length=80)
        if not callable(action):
            raise PluginValidationError("Registered action must be callable")
        with self._lock:
            if checked_id in self._actions:
                raise PluginValidationError(f"Duplicate action ID: {checked_id}")
            self._actions[checked_id] = action

    def contribute(self, kind: str, descriptor: dict[str, Any]) -> None:
        checked = validate_contribution(
            kind,
            descriptor,
            self._permissions,
            source_path=self.plugin_path,
        )
        with self._lock:
            descriptors = self._contributions.setdefault(kind, [])
            if any(item["id"] == checked["id"] for item in descriptors):
                raise PluginValidationError(f"Duplicate {kind} contribution ID: {checked['id']}")
            descriptors.append(checked)

    def _read_settings(self) -> dict[str, Any]:
        if not self._settings_path.exists():
            return {}
        try:
            raw = json.loads(self._settings_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PluginValidationError(f"Plugin settings are invalid: {exc}") from exc
        checked = json_copy(raw, limit=MAX_JSON_SIZE, label="plugin settings")
        if not isinstance(checked, dict):
            raise PluginValidationError("Plugin settings root must be an object")
        return checked

    def _write_settings(self, data: dict[str, Any]) -> None:
        checked = json_copy(data, limit=MAX_JSON_SIZE, label="plugin settings")
        temporary = self._settings_path.with_name(f"settings.{os.getpid()}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("w", encoding="utf-8") as file:
                json.dump(checked, file, ensure_ascii=False, indent=2, allow_nan=False)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, self._settings_path)
        finally:
            with contextlib.suppress(OSError):
                temporary.unlink()

    def _snapshot(self) -> tuple[dict[str, Callable[[Any], Any]], dict[str, list[dict[str, Any]]]]:
        with self._lock:
            actions = dict(self._actions)
            contributions = json_copy(self._contributions, label="plugin contributions")
        return actions, contributions
