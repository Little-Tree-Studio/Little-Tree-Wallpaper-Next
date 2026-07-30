#!/usr/bin/env python3
"""Build a deterministic Little Tree plugin package from a source directory."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

try:
    from backend.plugins.validation import (
        MAX_ARCHIVE_ENTRIES,
        MAX_ARCHIVE_SIZE,
        MAX_FILE_SIZE,
        MAX_MANIFEST_SIZE,
        MAX_PATH_LENGTH,
        SAFE_IMAGE_SUFFIXES,
        PluginValidationError,
        read_package,
        validate_manifest,
    )
except (
    ImportError
) as exc:  # pragma: no cover - only useful outside a repository checkout
    raise SystemExit(f"error: cannot import backend.plugins.validation: {exc}") from exc


FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
REGULAR_FILE_MODE = stat.S_IFREG | 0o644
SAFE_PATH_COMPONENT_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
WINDOWS_RESERVED_NAMES = {
    "aux",
    "clock$",
    "con",
    "nul",
    "prn",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a plugin source directory and create a deterministic .ltp package."
    )
    parser.add_argument(
        "source_dir", type=Path, help="directory containing plugin.json at its root"
    )
    parser.add_argument("-o", "--output", type=Path, help="output .ltp path")
    return parser.parse_args()


def _load_manifest(path: Path) -> Any:
    try:
        if path.stat().st_size > MAX_MANIFEST_SIZE:
            raise PluginValidationError("plugin.json exceeds its size limit")
        return json.loads(
            path.read_text(encoding="utf-8"), parse_constant=_reject_constant
        )
    except OSError as exc:
        raise PluginValidationError(f"Cannot read plugin.json: {exc}") from exc
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        raise PluginValidationError(
            f"plugin.json is not valid UTF-8 JSON: {exc}"
        ) from exc


def _collect_files(source: Path) -> list[tuple[str, Path]]:
    if _is_link(source):
        raise PluginValidationError("Plugin source directory cannot be a symlink")
    if not source.is_dir():
        raise PluginValidationError(f"Plugin source directory does not exist: {source}")

    files: list[tuple[str, Path]] = []
    collision_keys: set[str] = set()
    total_size = 0

    def walk_error(error: OSError) -> None:
        raise PluginValidationError(
            f"Cannot enumerate plugin source: {error}"
        ) from error

    for root, directories, names in os.walk(
        source, topdown=True, onerror=walk_error, followlinks=False
    ):
        root_path = Path(root)
        for name in directories:
            path = root_path / name
            if _is_link(path):
                raise PluginValidationError(
                    f"Symlinks are not allowed: {path.relative_to(source).as_posix()}"
                )
            try:
                mode = path.stat(follow_symlinks=False).st_mode
            except OSError as exc:
                raise PluginValidationError(
                    f"Cannot inspect plugin directory {path}: {exc}"
                ) from exc
            if not stat.S_ISDIR(mode):
                raise PluginValidationError(
                    f"Special filesystem entry is not allowed: {path.name}"
                )

        for name in names:
            path = root_path / name
            relative = path.relative_to(source).as_posix()
            try:
                metadata = path.stat(follow_symlinks=False)
            except OSError as exc:
                raise PluginValidationError(
                    f"Cannot inspect plugin file {relative}: {exc}"
                ) from exc
            if stat.S_ISLNK(metadata.st_mode) or _is_link(path):
                raise PluginValidationError(f"Symlinks are not allowed: {relative}")
            if not stat.S_ISREG(metadata.st_mode):
                raise PluginValidationError(
                    f"Special filesystem entry is not allowed: {relative}"
                )
            _validate_relative_name(relative)
            collision_key = relative.casefold()
            if collision_key in collision_keys:
                raise PluginValidationError(
                    f"Case-insensitive path collision: {relative}"
                )
            collision_keys.add(collision_key)
            _validate_file_type(relative)
            if metadata.st_size > MAX_FILE_SIZE:
                raise PluginValidationError(
                    f"Plugin file exceeds its size limit: {relative}"
                )
            total_size += metadata.st_size
            if total_size > MAX_ARCHIVE_SIZE:
                raise PluginValidationError(
                    "Plugin source expands beyond its size limit"
                )
            files.append((relative, path))

    if len(files) > MAX_ARCHIVE_ENTRIES:
        raise PluginValidationError("Plugin source contains too many files")
    if "plugin.json" not in {relative for relative, _ in files}:
        raise PluginValidationError("plugin.json must exist at the source root")
    return sorted(files, key=lambda item: item[0])


def _is_link(path: Path) -> bool:
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def _validate_relative_name(relative: str) -> None:
    if (
        not relative
        or "\\" in relative
        or "\x00" in relative
        or len(relative) > MAX_PATH_LENGTH
    ):
        raise PluginValidationError(f"Unsafe plugin path: {relative!r}")
    path = PurePosixPath(relative)
    if (
        path.is_absolute()
        or not path.parts
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise PluginValidationError(f"Unsafe plugin path: {relative}")
    for part in path.parts:
        if (
            not SAFE_PATH_COMPONENT_PATTERN.fullmatch(part)
            or part.endswith((" ", "."))
            or ":" in part
            or part.partition(".")[0].casefold() in WINDOWS_RESERVED_NAMES
        ):
            raise PluginValidationError(f"Plugin path is not portable: {relative}")


def _validate_file_type(relative: str) -> None:
    suffix = Path(relative).suffix.lower()
    if (
        relative != "plugin.json"
        and suffix != ".py"
        and suffix not in SAFE_IMAGE_SUFFIXES
    ):
        raise PluginValidationError(f"Unsupported plugin file type: {relative}")


def _write_archive(path: Path, files: list[tuple[str, Path]]) -> None:
    with path.open("w+b") as output:
        with zipfile.ZipFile(
            output,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=True,
        ) as archive:
            for relative, source_path in files:
                info = zipfile.ZipInfo(relative, FIXED_TIMESTAMP)
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = REGULAR_FILE_MODE << 16
                info.flag_bits = 0x800
                archive.writestr(
                    info,
                    source_path.read_bytes(),
                    compress_type=zipfile.ZIP_DEFLATED,
                    compresslevel=9,
                )
        output.flush()
        os.fsync(output.fileno())


def _package(
    source: Path, requested_output: Path | None
) -> tuple[dict[str, Any], str, Path]:
    source = source.expanduser().absolute()
    files = _collect_files(source)
    available_files = {relative for relative, _ in files}
    manifest = validate_manifest(
        _load_manifest(source / "plugin.json"),
        available_files=available_files,
        source_path=source,
    )

    output = requested_output or Path(f"{manifest['id']}-{manifest['version']}.ltp")
    if output.suffix.lower() != ".ltp":
        raise PluginValidationError("Output path must use the .ltp extension")
    output = output.expanduser().absolute()
    output.parent.mkdir(parents=False, exist_ok=True)
    if not output.parent.is_dir():
        raise PluginValidationError(
            f"Output parent is not a directory: {output.parent}"
        )

    temporary_path: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{output.stem}.", suffix=".tmp.ltp", dir=output.parent
        )
        os.close(descriptor)
        temporary_path = Path(temporary_name)
        _write_archive(temporary_path, files)
        validated = read_package(temporary_path)
        if (
            validated.manifest["id"] != manifest["id"]
            or validated.manifest["version"] != manifest["version"]
        ):
            raise PluginValidationError(
                "Packaged manifest does not match the validated source manifest"
            )
        os.replace(temporary_path, output)
        temporary_path = None
        return validated.manifest, validated.package_hash, output
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number: {value}")


def main() -> int:
    arguments = _parse_arguments()
    try:
        manifest, package_hash, output = _package(
            arguments.source_dir, arguments.output
        )
    except (OSError, PluginValidationError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"id: {manifest['id']}")
    print(f"version: {manifest['version']}")
    print(f"sha256: {package_hash}")
    print(f"output: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
