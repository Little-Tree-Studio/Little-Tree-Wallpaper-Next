from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import json
import logging
import os
import shutil
import sys
import threading
import uuid
from dataclasses import dataclass, field
from functools import wraps
from pathlib import Path
from types import ModuleType
from typing import Any

from backend.paths import (
    get_cache_dir,
    get_config_dir,
    get_data_dir,
    get_plugin_cache_dir,
    get_plugin_config_dir,
    get_plugin_data_dir,
    get_plugin_state_path,
    get_plugins_dir,
)

from .context import PluginContext
from .validation import (
    MAX_ARCHIVE_ENTRIES,
    MAX_ARCHIVE_SIZE,
    MAX_FILE_SIZE,
    MAX_MANIFEST_SIZE,
    MAX_PATH_LENGTH,
    MAX_PAYLOAD_SIZE,
    MAX_RESULT_SIZE,
    SAFE_IMAGE_SUFFIXES,
    PluginError,
    PluginValidationError,
    compare_versions,
    json_copy,
    read_package,
    validate_contribution_set,
    validate_identifier,
    validate_manifest,
)

INSTALL_METADATA = ".install.json"


def _serialized(method: Any) -> Any:
    @wraps(method)
    def wrapped(self: Any, *args: Any, **kwargs: Any) -> Any:
        with self._operation_lock:
            return method(self, *args, **kwargs)

    return wrapped


@dataclass
class _PluginRecord:
    plugin_id: str
    source_path: Path
    manifest: dict[str, Any] | None = None
    package_hash: str | None = None
    source: str | None = None
    enabled: bool = False
    status: str = "installed"
    error: str | None = None
    module: ModuleType | None = None
    module_name: str | None = None
    context: PluginContext | None = None
    instance: Any = None
    actions: dict[str, Any] = field(default_factory=dict)
    contributions: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    started: bool = False
    generation: int = 0


class PluginManager:
    """Manage explicitly trusted plugins loaded into the application process."""

    def __init__(
        self,
        *,
        data_dir: Path | None = None,
        config_dir: Path | None = None,
        cache_dir: Path | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self.data_dir = Path(data_dir) if data_dir is not None else get_data_dir()
        self.config_dir = Path(config_dir) if config_dir is not None else get_config_dir()
        self.cache_dir = Path(cache_dir) if cache_dir is not None else get_cache_dir()
        self.plugins_dir = get_plugins_dir(self.data_dir)
        self.state_path = get_plugin_state_path(self.config_dir)
        self.logger = logger or logging.getLogger("backend.plugins")
        self._lock = threading.RLock()
        self._operation_lock = threading.RLock()
        self._records: dict[str, _PluginRecord] = {}
        for path in (
            self.plugins_dir,
            self.state_path.parent,
            self.data_dir / "plugin_data",
            self.cache_dir / "plugins",
        ):
            path.mkdir(parents=True, exist_ok=True)
        enabled = self._read_enabled_state()
        self._discover(enabled)
        self._write_state()

    def list_plugins(self) -> dict[str, Any]:
        with self._lock:
            plugins = [
                self._serialize(record) for record in sorted(self._records.values(), key=lambda item: item.plugin_id)
            ]
        return {"state": "ok", "status": "ok", "error": None, "plugins": plugins}

    @_serialized
    def install_package(self, path: str | Path, allow_downgrade: bool = False) -> dict[str, Any]:
        try:
            package = read_package(Path(path))
            plugin_id = package.manifest["id"]
            with self._lock:
                existing = self._records.get(plugin_id)
                if existing is not None and existing.enabled:
                    raise PluginError("Cannot install or upgrade an enabled plugin")
                if existing is not None and existing.manifest is not None:
                    comparison = compare_versions(package.manifest["version"], existing.manifest["version"])
                    if comparison < 0 and not allow_downgrade:
                        raise PluginError("Plugin downgrade requires allow_downgrade=True")
                preserved_enabled = existing.enabled if existing is not None else False
            target = self.plugins_dir / plugin_id
            temporary = self.plugins_dir / f".{plugin_id}.{uuid.uuid4().hex}.tmp"
            backup = self.plugins_dir / f".{plugin_id}.{uuid.uuid4().hex}.backup"
            try:
                temporary.mkdir()
                package.extract_to(temporary)
                self._write_json(
                    temporary / INSTALL_METADATA,
                    {"package_hash": package.package_hash, "source": str(Path(path).resolve(strict=False))},
                )
                if target.exists():
                    os.replace(target, backup)
                try:
                    os.replace(temporary, target)
                except Exception:
                    if backup.exists():
                        os.replace(backup, target)
                    raise
                shutil.rmtree(backup, ignore_errors=True)
            finally:
                shutil.rmtree(temporary, ignore_errors=True)
                if backup.exists() and not target.exists():
                    os.replace(backup, target)
                else:
                    shutil.rmtree(backup, ignore_errors=True)
            record = _PluginRecord(
                plugin_id,
                target,
                manifest=package.manifest,
                package_hash=package.package_hash,
                source=str(Path(path).resolve(strict=False)),
                enabled=preserved_enabled,
            )
            with self._lock:
                self._records[plugin_id] = record
                self._write_state_locked()
                return self._serialize(record)
        except Exception as exc:
            self.logger.exception("Plugin installation failed: %s", path)
            return self._error_result(exc)

    @_serialized
    def set_enabled(self, plugin_id: str, enabled: bool) -> dict[str, Any]:
        try:
            checked_id = validate_identifier(plugin_id, "plugin ID")
            if not isinstance(enabled, bool):
                raise PluginValidationError("enabled must be a boolean")
            with self._lock:
                record = self._require(checked_id)
                if record.enabled == enabled and (not enabled or record.started):
                    return self._serialize(record)
                record.enabled = enabled
                self._write_state_locked()
            if enabled:
                self._load_and_start(record)
            else:
                self._stop_and_unload(record)
            with self._lock:
                return self._serialize(record)
        except Exception as exc:
            self.logger.exception("Failed to set plugin %s enabled=%s", plugin_id, enabled)
            return self._record_error(plugin_id, exc)

    @_serialized
    def reload(self, plugin_id: str) -> dict[str, Any]:
        try:
            checked_id = validate_identifier(plugin_id, "plugin ID")
            with self._lock:
                record = self._require(checked_id)
                enabled = record.enabled
            self._stop_and_unload(record)
            if enabled:
                self._load_and_start(record)
            with self._lock:
                return self._serialize(record)
        except Exception as exc:
            self.logger.exception("Failed to reload plugin %s", plugin_id)
            return self._record_error(plugin_id, exc)

    @_serialized
    def remove(self, plugin_id: str) -> dict[str, Any]:
        try:
            checked_id = validate_identifier(plugin_id, "plugin ID")
            with self._lock:
                record = self._require(checked_id)
                if record.enabled:
                    raise PluginError("Disable the plugin before removing it")
            self._stop_and_unload(record)
            shutil.rmtree(record.source_path)
            for path in (
                get_plugin_data_dir(checked_id, self.data_dir),
                get_plugin_config_dir(checked_id, self.config_dir),
                get_plugin_cache_dir(checked_id, self.cache_dir),
            ):
                shutil.rmtree(path, ignore_errors=True)
            with self._lock:
                self._records.pop(checked_id, None)
                self._write_state_locked()
            return {
                "state": "removed",
                "status": "removed",
                "error": None,
                "manifest": record.manifest,
                "contributions": {},
                "package_hash": record.package_hash,
                "source": record.source,
            }
        except Exception as exc:
            self.logger.exception("Failed to remove plugin %s", plugin_id)
            return self._record_error(plugin_id, exc)

    @_serialized
    def invoke(self, plugin_id: str, action: str, payload: Any = None) -> dict[str, Any]:
        try:
            checked_id = validate_identifier(plugin_id, "plugin ID")
            checked_action = validate_identifier(action, "action ID", max_length=80)
            checked_payload = json_copy(payload, limit=MAX_PAYLOAD_SIZE, label="action payload")
            with self._lock:
                record = self._require(checked_id)
                if not record.enabled or not record.started:
                    raise PluginError("Plugin is not enabled and started")
                callback = record.actions.get(checked_action)
                if callback is None:
                    raise PluginError(f"Unknown plugin action: {checked_action}")
            result = callback(checked_payload)
            checked_result = json_copy(result, limit=MAX_RESULT_SIZE, label="action result")
            return {
                "state": "enabled",
                "status": "ok",
                "error": None,
                "manifest": record.manifest,
                "contributions": record.contributions,
                "package_hash": record.package_hash,
                "source": record.source,
                "result": checked_result,
            }
        except Exception as exc:
            self.logger.exception("Plugin action failed: %s.%s", plugin_id, action)
            return self._operation_error(plugin_id, exc)

    @_serialized
    def start_enabled(self) -> dict[str, Any]:
        with self._lock:
            records = [record for record in self._records.values() if record.enabled]
        results = []
        for record in records:
            try:
                self._load_and_start(record)
                with self._lock:
                    results.append(self._serialize(record))
            except Exception as exc:
                self.logger.exception("Failed to start plugin %s", record.plugin_id)
                results.append(self._record_error(record.plugin_id, exc))
        return {"state": "ok", "status": "ok", "error": None, "plugins": results}

    @_serialized
    def shutdown(self) -> dict[str, Any]:
        with self._lock:
            records = list(self._records.values())
        results = []
        for record in records:
            try:
                self._stop_and_unload(record)
                with self._lock:
                    results.append(self._serialize(record))
            except Exception as exc:
                self.logger.exception("Failed to stop plugin %s", record.plugin_id)
                results.append(self._record_error(record.plugin_id, exc))
        return {"state": "ok", "status": "ok", "error": None, "plugins": results}

    def _discover(self, enabled: set[str]) -> None:
        for directory in sorted(self.plugins_dir.iterdir()):
            if not directory.is_dir() or directory.name.startswith("."):
                continue
            plugin_id = directory.name
            record = _PluginRecord(plugin_id, directory, enabled=plugin_id in enabled)
            try:
                validate_identifier(plugin_id, "installed plugin folder")
                manifest_path = directory / "plugin.json"
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                files = self._validate_installed_tree(directory)
                manifest = validate_manifest(raw, available_files=files, source_path=directory)
                if manifest["id"] != plugin_id:
                    raise PluginValidationError("Installed folder name does not match manifest ID")
                metadata = self._read_install_metadata(directory)
                record.manifest = manifest
                record.package_hash = metadata.get("package_hash") or self._hash_installed_tree(directory)
                record.source = metadata.get("source") or "installed"
            except Exception as exc:
                record.status = "error"
                record.error = str(exc)
                self.logger.exception("Failed to discover plugin %s", plugin_id)
            self._records[plugin_id] = record

    def _load_and_start(self, record: _PluginRecord) -> None:
        with self._lock:
            if record.started:
                return
            if not record.enabled:
                raise PluginError("Plugin is disabled")
            manifest = record.manifest
            if manifest is None:
                raise PluginError(record.error or "Plugin manifest is unavailable")
            record.generation += 1
            generation = record.generation
        module_path_text, _, setup_name = manifest["entrypoint"].partition(":")
        module_path = record.source_path.joinpath(*module_path_text.split("/"))
        module_prefix = f"_ltp_{record.plugin_id.replace('.', '_').replace('-', '_')}_{generation}_{uuid.uuid4().hex}"
        module_parts = module_path_text.removesuffix(".py").split("/")
        is_package = module_parts[-1] == "__init__"
        if is_package:
            module_parts = module_parts[:-1]
        module_name = ".".join([module_prefix, *module_parts])
        context = PluginContext(
            record.plugin_id,
            record.source_path,
            get_plugin_data_dir(record.plugin_id, self.data_dir),
            get_plugin_config_dir(record.plugin_id, self.config_dir),
            get_plugin_cache_dir(record.plugin_id, self.cache_dir),
            set(manifest["permissions"]),
            logging.LoggerAdapter(self.logger, {"plugin_id": record.plugin_id}),
        )
        for kind, descriptors in manifest["contributes"].items():
            for descriptor in descriptors:
                context.contribute(kind, descriptor)
        module: ModuleType | None = None
        instance: Any = None
        cleanup_needed = False
        try:
            self._create_module_namespace(module_prefix, record.source_path, module_parts[:-1])
            spec = importlib.util.spec_from_file_location(
                module_name,
                module_path,
                submodule_search_locations=[str(module_path.parent)] if is_package else None,
            )
            if spec is None or spec.loader is None:
                raise PluginError("Cannot create an import specification for the plugin")
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            self._remove_bytecode(record.source_path)
            setup = getattr(module, setup_name, None)
            if not callable(setup):
                raise PluginError(f"Plugin entrypoint callable does not exist: {setup_name}")
            instance = setup(context)
            cleanup_needed = instance is not None
            on_start = getattr(instance, "on_start", None) if instance is not None else None
            if on_start is not None:
                if not callable(on_start):
                    raise PluginError("Plugin on_start attribute must be callable")
                on_start(context)
            actions, contributions = context._snapshot()
            validate_contribution_set(contributions, set(actions))
            expected_route_prefix = f"/plugins/{record.plugin_id}"
            routes = {item["route"] for kind in ("pages", "resource_pages") for item in contributions.get(kind, [])}
            if any(
                route != expected_route_prefix and not route.startswith(f"{expected_route_prefix}/") for route in routes
            ):
                raise PluginError(f"Plugin routes must use the namespace {expected_route_prefix}")
            with self._lock:
                if not record.enabled:
                    raise PluginError("Plugin was disabled while starting")
                active_routes = {
                    item["route"]
                    for other in self._records.values()
                    if other is not record and other.started
                    for kind in ("pages", "resource_pages")
                    for item in other.contributions.get(kind, [])
                }
                conflicts = routes.intersection(active_routes)
                if conflicts:
                    raise PluginError(f"Plugin route is already registered: {sorted(conflicts)[0]}")
                record.module = module
                record.module_name = module_name
                record.context = context
                record.instance = instance
                record.actions = actions
                record.contributions = contributions
                record.started = True
                record.status = "started"
                record.error = None
        except Exception:
            if cleanup_needed and instance is not None:
                on_stop = getattr(instance, "on_stop", None)
                if callable(on_stop):
                    try:
                        on_stop(context)
                    except Exception:
                        self.logger.exception("Plugin %s cleanup after failed startup also failed", record.plugin_id)
            self._remove_bytecode(record.source_path)
            self._unload_module_namespace(module_name)
            with self._lock:
                record.module = None
                record.module_name = None
                record.context = None
                record.instance = None
                record.actions = {}
                record.contributions = {}
                record.started = False
                record.status = "error"
            raise

    def _stop_and_unload(self, record: _PluginRecord) -> None:
        with self._lock:
            instance = record.instance
            context = record.context
            module_name = record.module_name
            was_started = record.started
            if not was_started and record.module is None:
                record.status = "disabled" if not record.enabled else "installed"
                if not record.enabled:
                    record.error = None
                return
            record.started = False
        error: Exception | None = None
        if was_started and instance is not None:
            on_stop = getattr(instance, "on_stop", None)
            if on_stop is not None:
                if not callable(on_stop):
                    error = PluginError("Plugin on_stop attribute must be callable")
                else:
                    try:
                        on_stop(context)
                    except Exception as exc:
                        error = exc
        if module_name is not None:
            self._unload_module_namespace(module_name)
        with self._lock:
            record.module = None
            record.module_name = None
            record.context = None
            record.instance = None
            record.actions = {}
            record.contributions = {}
            record.status = "disabled" if not record.enabled else "installed"
            record.error = str(error) if error is not None else None
        if error is not None:
            raise error

    def _read_enabled_state(self) -> set[str]:
        if not self.state_path.exists():
            return set()
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict) or not isinstance(raw.get("enabled", []), list):
                raise PluginValidationError("Plugin state root is invalid")
            return {
                validate_identifier(item, "state plugin ID") for item in raw.get("enabled", []) if isinstance(item, str)
            }
        except Exception:
            self.logger.exception("Failed to read plugin state: %s", self.state_path)
            return set()

    def _write_state(self) -> None:
        with self._lock:
            self._write_state_locked()

    def _write_state_locked(self) -> None:
        enabled = sorted(record.plugin_id for record in self._records.values() if record.enabled)
        self._write_json(self.state_path, {"schema_version": 1, "enabled": enabled})

    @staticmethod
    def _write_json(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("w", encoding="utf-8") as file:
                json.dump(value, file, ensure_ascii=False, indent=2, allow_nan=False)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
        finally:
            with contextlib.suppress(OSError):
                temporary.unlink()

    @staticmethod
    def _read_install_metadata(directory: Path) -> dict[str, Any]:
        path = directory / INSTALL_METADATA
        if not path.exists():
            return {}
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}

    @staticmethod
    def _validate_installed_tree(directory: Path) -> set[str]:
        files: set[str] = set()
        total_size = 0
        entry_count = 0
        for path in directory.rglob("*"):
            if "__pycache__" in path.relative_to(directory).parts:
                continue
            if path.is_symlink():
                raise PluginValidationError(f"Installed plugin contains a symlink: {path.name}")
            if path.is_dir():
                continue
            relative = path.relative_to(directory).as_posix()
            if relative == INSTALL_METADATA:
                continue
            entry_count += 1
            size = path.stat().st_size
            total_size += size
            if entry_count > MAX_ARCHIVE_ENTRIES:
                raise PluginValidationError("Installed plugin contains too many files")
            if len(relative) > MAX_PATH_LENGTH:
                raise PluginValidationError(f"Installed plugin path is too long: {relative}")
            if size > MAX_FILE_SIZE or total_size > MAX_ARCHIVE_SIZE:
                raise PluginValidationError(f"Installed plugin file limits exceeded: {relative}")
            if relative == "plugin.json" and size > MAX_MANIFEST_SIZE:
                raise PluginValidationError("Installed plugin manifest exceeds its size limit")
            suffix = path.suffix.lower()
            if relative != "plugin.json" and suffix != ".py" and suffix not in SAFE_IMAGE_SUFFIXES:
                raise PluginValidationError(f"Installed plugin contains unsupported file: {relative}")
            files.add(relative)
        return files

    @staticmethod
    def _remove_bytecode(directory: Path) -> None:
        for path in directory.rglob("__pycache__"):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)

    @staticmethod
    def _create_module_namespace(prefix: str, root: Path, parent_parts: list[str]) -> None:
        parts: list[str] = []
        for part in [prefix, *parent_parts]:
            parts.append(part)
            name = ".".join(parts)
            if name in sys.modules:
                continue
            module = ModuleType(name)
            relative_parts = parts[1:]
            module.__package__ = name
            module.__path__ = [str(root.joinpath(*relative_parts))]  # type: ignore[attr-defined]
            sys.modules[name] = module

    @staticmethod
    def _unload_module_namespace(module_name: str) -> None:
        prefix = module_name.partition(".")[0]
        for name in [name for name in sys.modules if name == prefix or name.startswith(f"{prefix}.")]:
            sys.modules.pop(name, None)

    @staticmethod
    def _hash_installed_tree(directory: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or path.name == INSTALL_METADATA:
                continue
            digest.update(path.relative_to(directory).as_posix().encode())
            digest.update(b"\0")
            with path.open("rb") as file:
                while chunk := file.read(64 * 1024):
                    digest.update(chunk)
        return digest.hexdigest()

    def _require(self, plugin_id: str) -> _PluginRecord:
        record = self._records.get(plugin_id)
        if record is None:
            raise PluginError(f"Plugin is not installed: {plugin_id}")
        return record

    @staticmethod
    def _serialize(record: _PluginRecord) -> dict[str, Any]:
        state = "enabled" if record.enabled else "disabled"
        if record.status == "error":
            state = "error"
        return {
            "id": record.plugin_id,
            "enabled": record.enabled,
            "state": state,
            "status": record.status,
            "error": record.error,
            "manifest": json_copy(record.manifest, label="manifest") if record.manifest is not None else None,
            "contributions": json_copy(record.contributions, label="contributions"),
            "package_hash": record.package_hash,
            "source": record.source or str(record.source_path),
        }

    @staticmethod
    def _error_result(exc: Exception) -> dict[str, Any]:
        return {
            "state": "error",
            "status": "error",
            "error": str(exc),
            "manifest": None,
            "contributions": {},
            "package_hash": None,
            "source": None,
        }

    def _record_error(self, plugin_id: str, exc: Exception) -> dict[str, Any]:
        with self._lock:
            record = self._records.get(plugin_id)
            if record is None:
                return self._error_result(exc)
            record.error = str(exc)
            record.status = "error"
            return self._serialize(record)

    def _operation_error(self, plugin_id: str, exc: Exception) -> dict[str, Any]:
        with self._lock:
            record = self._records.get(plugin_id)
            if record is None:
                return self._error_result(exc)
            result = self._serialize(record)
        result["state"] = "error"
        result["status"] = "error"
        result["error"] = str(exc)
        return result
