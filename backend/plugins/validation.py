from __future__ import annotations

import hashlib
import io
import json
import math
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

MAX_PACKAGE_SIZE = 10 * 1024 * 1024
MAX_ARCHIVE_SIZE = 20 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 256
MAX_FILE_SIZE = 4 * 1024 * 1024
MAX_MANIFEST_SIZE = 64 * 1024
MAX_PATH_LENGTH = 240
MAX_JSON_SIZE = 256 * 1024
MAX_PAYLOAD_SIZE = 64 * 1024
MAX_RESULT_SIZE = 256 * 1024
MAX_STYLE_SIZE = 64 * 1024
MAX_PAGE_BLOCKS = 64
MAX_BLOCK_DEPTH = 3

ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
SETTING_KEY_PATTERN = re.compile(r"^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$")
ENTRYPOINT_PATTERN = re.compile(r"(?P<module>[A-Za-z0-9_/-]+\.py):(?P<callable>[A-Za-z_][A-Za-z0-9_]*)")
VERSION_PATTERN = re.compile(
    r"^(?P<release>(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3})"
    r"(?P<suffix>[-+][0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$"
)
ROUTE_PATTERN = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$")
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

SAFE_IMAGE_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".webp"}
NATIVE_OR_EXECUTABLE_SUFFIXES = {
    ".bat",
    ".class",
    ".cmd",
    ".com",
    ".dll",
    ".dylib",
    ".exe",
    ".jar",
    ".msi",
    ".pyd",
    ".pyc",
    ".pyo",
    ".ps1",
    ".sh",
    ".so",
}
SUPPORTED_PERMISSIONS = {
    "ui.buttons",
    "ui.global_style",
    "ui.navigation",
    "ui.overlay",
    "ui.pages",
    "ui.resource_pages",
    "ui.theme",
}
CONTRIBUTION_PERMISSIONS = {
    "buttons": "ui.buttons",
    "navigation": "ui.navigation",
    "overlays": "ui.overlay",
    "pages": "ui.pages",
    "resource_pages": "ui.resource_pages",
    "theme": "ui.theme",
}
SUPPORTED_CONTRIBUTIONS = {
    "buttons",
    "navigation",
    "overlays",
    "pages",
    "resource_pages",
    "styles",
    "theme",
}


class PluginError(Exception):
    """Base exception for plugin operations."""


class PluginValidationError(PluginError):
    """Raised when a package, manifest, or plugin value is invalid."""


@dataclass(frozen=True)
class ValidatedPackage:
    data: bytes
    package_hash: str
    manifest: dict[str, Any]
    files: frozenset[str]

    def extract_to(self, destination: Path) -> None:
        root = destination.resolve(strict=True)
        with zipfile.ZipFile(io.BytesIO(self.data)) as archive:
            for info in archive.infolist():
                relative = PurePosixPath(info.filename.rstrip("/"))
                target = destination.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    target.parent.resolve(strict=True).relative_to(root)
                except ValueError as exc:
                    raise PluginValidationError(f"Archive path escaped extraction root: {relative}") from exc
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                with archive.open(info) as source, target.open("wb") as output:
                    while chunk := source.read(64 * 1024):
                        output.write(chunk)


def json_copy(value: Any, *, limit: int = MAX_JSON_SIZE, label: str = "value") -> Any:
    _validate_json_types(value, label)
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    except (TypeError, ValueError) as exc:
        raise PluginValidationError(f"{label} must be JSON-compatible: {exc}") from exc
    if len(encoded) > limit:
        raise PluginValidationError(f"{label} exceeds the {limit}-byte limit")
    return json.loads(encoded)


def _validate_json_types(value: Any, label: str) -> None:
    if value is None or isinstance(value, (bool, str, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise PluginValidationError(f"{label} contains a non-finite number")
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_types(item, label)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise PluginValidationError(f"{label} contains a non-string object key")
            _validate_json_types(item, label)
        return
    raise PluginValidationError(f"{label} contains unsupported type {type(value).__name__}")


def validate_identifier(value: Any, label: str = "ID", *, max_length: int = 128) -> str:
    if not isinstance(value, str) or not value or len(value) > max_length or not ID_PATTERN.fullmatch(value):
        raise PluginValidationError(f"Invalid {label}: expected lowercase slug/reverse-domain characters")
    return value


def validate_setting_key(key: Any) -> str:
    if not isinstance(key, str) or len(key) > 160 or not SETTING_KEY_PATTERN.fullmatch(key):
        raise PluginValidationError("Invalid setting key")
    return key


def validate_entrypoint(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 200:
        raise PluginValidationError("Manifest entrypoint must be a string")
    match = ENTRYPOINT_PATTERN.fullmatch(value)
    if match is None:
        raise PluginValidationError("Invalid entrypoint; expected relative/path.py:callable")
    module = match.group("module")
    if "\\" in module or module.startswith("/") or ".." in PurePosixPath(module).parts:
        raise PluginValidationError("Entrypoint must be a safe relative Python path")
    return value


def validate_manifest(
    raw: Any,
    *,
    available_files: set[str] | frozenset[str] | None = None,
    source_path: Path | None = None,
) -> dict[str, Any]:
    manifest = json_copy(raw, limit=MAX_MANIFEST_SIZE, label="manifest")
    if not isinstance(manifest, dict):
        raise PluginValidationError("Manifest root must be an object")
    if type(manifest.get("schema_version")) is not int or manifest["schema_version"] != 1:
        raise PluginValidationError("Manifest schema_version must be 1")
    manifest["id"] = validate_identifier(manifest.get("id"), "plugin ID")
    for field, limit in (("name", 120), ("description", 1000), ("author", 160)):
        value = manifest.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise PluginValidationError(f"Manifest {field} must be a non-empty string")
        manifest[field] = value.strip()
    version = manifest.get("version")
    if not isinstance(version, str) or len(version) > 64 or VERSION_PATTERN.fullmatch(version) is None:
        raise PluginValidationError("Manifest version is invalid")
    entrypoint = validate_entrypoint(manifest.get("entrypoint", "module.py:setup"))
    manifest["entrypoint"] = entrypoint
    if available_files is not None and entrypoint.partition(":")[0] not in available_files:
        raise PluginValidationError("Entrypoint module is missing from the package")

    if "permissions" not in manifest:
        raise PluginValidationError("Manifest permissions field is required")
    permissions = manifest["permissions"]
    if not isinstance(permissions, list) or any(not isinstance(item, str) for item in permissions):
        raise PluginValidationError("Manifest permissions must be a list of strings")
    if len(permissions) != len(set(permissions)):
        raise PluginValidationError("Manifest permissions contain duplicates")
    unsupported = set(permissions) - SUPPORTED_PERMISSIONS
    if unsupported:
        raise PluginValidationError(f"Unsupported permission: {sorted(unsupported)[0]}")
    manifest["permissions"] = permissions

    if "contributes" not in manifest:
        raise PluginValidationError("Manifest contributes field is required")
    contributes = manifest["contributes"]
    if not isinstance(contributes, dict):
        raise PluginValidationError("Manifest contributes must be an object")
    normalized: dict[str, list[dict[str, Any]]] = {}
    for kind, descriptors in contributes.items():
        if kind not in SUPPORTED_CONTRIBUTIONS:
            raise PluginValidationError(f"Unsupported contribution kind: {kind}")
        values = descriptors if isinstance(descriptors, list) else [descriptors]
        normalized[kind] = [
            validate_contribution(
                kind,
                descriptor,
                set(permissions),
                source_path=source_path,
                available_files=available_files,
            )
            for descriptor in values
        ]
    manifest["contributes"] = normalized
    validate_contribution_set(normalized)
    return manifest


def validate_contribution(
    kind: str,
    descriptor: Any,
    permissions: set[str] | frozenset[str],
    *,
    source_path: Path | None = None,
    available_files: set[str] | frozenset[str] | None = None,
) -> dict[str, Any]:
    if kind not in SUPPORTED_CONTRIBUTIONS:
        raise PluginValidationError(f"Unsupported contribution kind: {kind}")
    required_permission = CONTRIBUTION_PERMISSIONS.get(kind)
    if required_permission is not None and required_permission not in permissions:
        raise PluginValidationError(f"Contribution {kind} requires permission {required_permission}")
    value = json_copy(descriptor, label=f"{kind} contribution")
    if not isinstance(value, dict):
        raise PluginValidationError(f"{kind} contribution must be an object")
    value["id"] = validate_identifier(value.get("id"), f"{kind} contribution ID", max_length=80)

    if kind in {"buttons", "navigation", "overlays", "pages", "resource_pages", "theme"}:
        _validate_label(value.get("label"), kind)
    if kind in {"pages", "resource_pages"}:
        value["route"] = _validate_route(value.get("route"))
        value["blocks"] = _validate_blocks(value.get("blocks", []), source_path, available_files)
    elif kind == "navigation":
        route = value.get("route")
        page = value.get("page")
        if route is None and page is None:
            raise PluginValidationError("navigation contribution requires route or page")
        if route is not None:
            value["route"] = _validate_route(route)
        if page is not None:
            value["page"] = validate_identifier(page, "navigation page reference", max_length=80)
    elif kind == "buttons":
        value["action"] = validate_identifier(value.get("action"), "button action", max_length=80)
        if "payload" in value:
            value["payload"] = json_copy(value["payload"], limit=MAX_PAYLOAD_SIZE, label="button payload")
    elif kind == "overlays":
        value["blocks"] = _validate_blocks(value.get("blocks", []), source_path, available_files)
    elif kind == "styles":
        scope = value.get("scope", "plugin")
        if scope not in {"plugin", "global"}:
            raise PluginValidationError("Style scope must be plugin or global")
        if scope == "global" and "ui.global_style" not in permissions:
            raise PluginValidationError("Global styles require permission ui.global_style")
        css = value.get("css")
        if not isinstance(css, str) or not css or len(css.encode()) > MAX_STYLE_SIZE:
            raise PluginValidationError("Style CSS is empty or exceeds its size limit")
        if scope == "plugin" and "@" in css:
            raise PluginValidationError("Plugin-scoped CSS cannot contain at-rules")
        value["scope"] = scope
    elif kind == "theme":
        variables = value.get("variables")
        if not isinstance(variables, dict) or len(variables) > 128:
            raise PluginValidationError("Theme variables must be an object with at most 128 entries")
        for key, item in variables.items():
            if not isinstance(key, str) or re.fullmatch(r"--[A-Za-z0-9_-]+", key) is None or len(key) > 80:
                raise PluginValidationError("Theme variable names must be CSS custom properties")
            if not isinstance(item, (str, int, float)) or isinstance(item, bool):
                raise PluginValidationError("Theme variable values must be strings or numbers")
            if isinstance(item, str) and any(token in item for token in ("\\", "/*", "*/", "@", "<", ">")):
                raise PluginValidationError("Theme variable value contains unsafe CSS syntax")
    _validate_optional_class_name(value.get("className"))
    if kind == "navigation" and "location" in value and value["location"] != "sidebar":
        raise PluginValidationError("Navigation location must be sidebar")
    if kind == "buttons" and "location" in value and value["location"] != "global":
        raise PluginValidationError("Button location must be global")
    if kind == "overlays":
        if "position" in value and value["position"] not in {"top-left", "top-right", "bottom-left", "bottom-right"}:
            raise PluginValidationError("Overlay position is invalid")
        if "fixed" in value and not isinstance(value["fixed"], bool):
            raise PluginValidationError("Overlay fixed must be a boolean")
    return value


def validate_contribution_set(contributions: dict[str, list[dict[str, Any]]], actions: set[str] | None = None) -> None:
    page_ids = {item["id"] for kind in ("pages", "resource_pages") for item in contributions.get(kind, [])}
    all_ids: set[str] = set()
    for kind, descriptors in contributions.items():
        ids = [item["id"] for item in descriptors]
        if len(ids) != len(set(ids)):
            raise PluginValidationError(f"Duplicate {kind} contribution ID")
        if kind in {"pages", "resource_pages"}:
            duplicates = all_ids.intersection(ids)
            if duplicates:
                raise PluginValidationError(f"Duplicate page contribution ID: {sorted(duplicates)[0]}")
            all_ids.update(ids)
    for item in contributions.get("navigation", []):
        if "page" in item and item["page"] not in page_ids:
            raise PluginValidationError(f"Unknown navigation page reference: {item['page']}")
    routes = [item["route"] for kind in ("pages", "resource_pages") for item in contributions.get(kind, [])]
    if len(routes) != len(set(routes)):
        raise PluginValidationError("Plugin page routes must be unique")
    if actions is not None:
        referenced = {item["action"] for item in contributions.get("buttons", [])}
        for kind in ("pages", "resource_pages", "overlays"):
            for item in contributions.get(kind, []):
                referenced.update(_block_actions(item.get("blocks", [])))
        missing = referenced - actions
        if missing:
            raise PluginValidationError(f"Unknown action reference: {sorted(missing)[0]}")


def read_package(path: Path) -> ValidatedPackage:
    package_path = Path(path)
    if package_path.suffix.lower() != ".ltp":
        raise PluginValidationError("Plugin package must use the .ltp extension")
    try:
        with package_path.open("rb") as file:
            data = file.read(MAX_PACKAGE_SIZE + 1)
        if not data or len(data) > MAX_PACKAGE_SIZE:
            raise PluginValidationError("Plugin package is empty or exceeds its size limit")
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (OSError, zipfile.BadZipFile) as exc:
        raise PluginValidationError(f"Invalid plugin ZIP: {exc}") from exc

    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise PluginValidationError("Plugin archive contains too many entries")
        files: set[str] = set()
        seen: set[str] = set()
        total_size = 0
        manifest_info: zipfile.ZipInfo | None = None
        for info in infos:
            normalized = _validate_archive_entry(info)
            collision_key = normalized.casefold()
            if collision_key in seen:
                raise PluginValidationError(f"Duplicate archive entry: {normalized}")
            seen.add(collision_key)
            if info.is_dir():
                continue
            files.add(normalized)
            total_size += info.file_size
            if total_size > MAX_ARCHIVE_SIZE:
                raise PluginValidationError("Plugin archive expands beyond its size limit")
            if normalized == "plugin.json":
                manifest_info = info
            if Path(normalized).suffix.lower() in SAFE_IMAGE_SUFFIXES:
                _validate_image(normalized, archive.read(info))
        if manifest_info is None:
            raise PluginValidationError("plugin.json must exist at the archive root")
        if manifest_info.file_size > MAX_MANIFEST_SIZE:
            raise PluginValidationError("plugin.json exceeds its size limit")
        try:
            raw_manifest = json.loads(archive.read(manifest_info).decode("utf-8"), parse_constant=_reject_constant)
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
            raise PluginValidationError(f"plugin.json is not valid UTF-8 JSON: {exc}") from exc
        manifest = validate_manifest(raw_manifest, available_files=files)
    return ValidatedPackage(data, hashlib.sha256(data).hexdigest(), manifest, frozenset(files))


def compare_versions(left: str, right: str) -> int:
    left_match = VERSION_PATTERN.fullmatch(left)
    right_match = VERSION_PATTERN.fullmatch(right)
    if left_match is None or right_match is None:
        raise PluginValidationError("Cannot compare invalid plugin versions")
    left_release = tuple(int(part) for part in left_match.group("release").split("."))
    right_release = tuple(int(part) for part in right_match.group("release").split("."))
    length = max(len(left_release), len(right_release))
    left_release += (0,) * (length - len(left_release))
    right_release += (0,) * (length - len(right_release))
    if left_release != right_release:
        return 1 if left_release > right_release else -1
    left_suffix = left_match.group("suffix")
    right_suffix = right_match.group("suffix")
    if left_suffix == right_suffix:
        return 0
    if left_suffix is None:
        return 1
    if right_suffix is None:
        return -1
    return 1 if left_suffix > right_suffix else -1


def _validate_archive_entry(info: zipfile.ZipInfo) -> str:
    name = info.filename
    if not name or "\\" in name or "\x00" in name or len(name) > MAX_PATH_LENGTH:
        raise PluginValidationError(f"Unsafe archive path: {name!r}")
    path = PurePosixPath(name.rstrip("/"))
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise PluginValidationError(f"Unsafe archive path: {name}")
    if ":" in path.parts[0]:
        raise PluginValidationError(f"Absolute archive path is not allowed: {name}")
    for part in path.parts:
        if (
            not SAFE_PATH_COMPONENT_PATTERN.fullmatch(part)
            or part.endswith((" ", "."))
            or ":" in part
            or part.partition(".")[0].casefold() in WINDOWS_RESERVED_NAMES
        ):
            raise PluginValidationError(f"Archive path is not portable: {name}")
    normalized = path.as_posix()
    if info.flag_bits & 0x1:
        raise PluginValidationError(f"Encrypted archive entry is not allowed: {name}")
    if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
        raise PluginValidationError(f"Unsupported compression for archive entry: {name}")
    if info.file_size > MAX_FILE_SIZE:
        raise PluginValidationError(f"Archive entry exceeds its size limit: {name}")
    if info.create_system == 3:
        mode = info.external_attr >> 16
        file_type = stat.S_IFMT(mode)
        if file_type == stat.S_IFLNK:
            raise PluginValidationError(f"Symlinks are not allowed: {name}")
        if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
            raise PluginValidationError(f"Special archive files are not allowed: {name}")
        if not info.is_dir() and mode & 0o111:
            raise PluginValidationError(f"Executable archive files are not allowed: {name}")
    if info.is_dir():
        return normalized
    suffix = Path(normalized).suffix.lower()
    if suffix in NATIVE_OR_EXECUTABLE_SUFFIXES:
        raise PluginValidationError(f"Executable or native file is not allowed: {name}")
    if normalized != "plugin.json" and suffix != ".py" and suffix not in SAFE_IMAGE_SUFFIXES:
        raise PluginValidationError(f"Unsupported plugin file type: {name}")
    return normalized


def _validate_image(name: str, data: bytes) -> None:
    suffix = Path(name).suffix.lower()
    signatures = {
        ".gif": (b"GIF87a", b"GIF89a"),
        ".jpeg": (b"\xff\xd8\xff",),
        ".jpg": (b"\xff\xd8\xff",),
        ".png": (b"\x89PNG\r\n\x1a\n",),
        ".webp": (b"RIFF",),
    }
    if not any(data.startswith(signature) for signature in signatures[suffix]):
        raise PluginValidationError(f"Static image has an invalid signature: {name}")
    if suffix == ".webp" and (len(data) < 12 or data[8:12] != b"WEBP"):
        raise PluginValidationError(f"Static image has an invalid signature: {name}")


def _validate_label(value: Any, kind: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 120:
        raise PluginValidationError(f"{kind} contribution requires a label")
    return value


def _validate_route(value: Any) -> str:
    if (
        not isinstance(value, str)
        or len(value) > 240
        or ROUTE_PATTERN.fullmatch(value) is None
        or ".." in value.split("/")
        or "%" in value
        or "//" in value
        or not value.startswith("/plugins/")
        or value.endswith("/")
    ):
        raise PluginValidationError("Invalid contribution route")
    return value


def _validate_blocks(
    blocks: Any,
    source_path: Path | None,
    available_files: set[str] | frozenset[str] | None,
    *,
    depth: int = 0,
    count: list[int] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(blocks, list):
        raise PluginValidationError("Page blocks must be a list")
    if depth > MAX_BLOCK_DEPTH:
        raise PluginValidationError("Page blocks are nested too deeply")
    counter = count if count is not None else [0]
    normalized: list[dict[str, Any]] = []
    for block in blocks:
        counter[0] += 1
        if counter[0] > MAX_PAGE_BLOCKS:
            raise PluginValidationError("Page contains too many blocks")
        value = json_copy(block, label="page block")
        if not isinstance(value, dict):
            raise PluginValidationError("Page block must be an object")
        block_type = value.get("type")
        if block_type not in {"text", "heading", "image", "card", "button", "divider"}:
            raise PluginValidationError(f"Unsupported page block type: {block_type}")
        _validate_optional_class_name(value.get("className"))
        if block_type in {"text", "heading"}:
            text = value.get("text")
            if not isinstance(text, str) or not text or len(text) > 4000:
                raise PluginValidationError(f"{block_type} block requires bounded text")
            if block_type == "heading" and value.get("level", 2) not in {1, 2, 3, 4, 5, 6}:
                raise PluginValidationError("Heading level must be between 1 and 6")
        elif block_type == "image":
            value["src"] = _validate_asset(value.get("src"), source_path, available_files)
            if "alt" in value and (not isinstance(value["alt"], str) or len(value["alt"]) > 300):
                raise PluginValidationError("Image alt text is invalid")
        elif block_type == "card":
            if "title" in value and (not isinstance(value["title"], str) or len(value["title"]) > 200):
                raise PluginValidationError("Card title is invalid")
            value["blocks"] = _validate_blocks(
                value.get("blocks", []), source_path, available_files, depth=depth + 1, count=counter
            )
        elif block_type == "button":
            _validate_label(value.get("label"), "button block")
            value["action"] = validate_identifier(value.get("action"), "button block action", max_length=80)
            if "payload" in value:
                value["payload"] = json_copy(value["payload"], limit=MAX_PAYLOAD_SIZE, label="button payload")
        normalized.append(value)
    return normalized


def _validate_asset(value: Any, source_path: Path | None, available_files: set[str] | frozenset[str] | None) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_PATH_LENGTH or "\\" in value:
        raise PluginValidationError("Invalid image asset path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or Path(value).suffix.lower() not in SAFE_IMAGE_SUFFIXES:
        raise PluginValidationError("Image asset must be a safe relative static image path")
    normalized = path.as_posix()
    if available_files is not None and normalized not in available_files:
        raise PluginValidationError(f"Image asset does not exist: {normalized}")
    if source_path is not None and not (source_path / Path(*path.parts)).is_file():
        raise PluginValidationError(f"Image asset does not exist: {normalized}")
    return normalized


def _block_actions(blocks: list[dict[str, Any]]) -> set[str]:
    actions: set[str] = set()
    for block in blocks:
        if block.get("type") == "button":
            actions.add(block["action"])
        actions.update(_block_actions(block.get("blocks", [])))
    return actions


def _reject_constant(value: str) -> None:
    raise ValueError(value)


def _validate_optional_class_name(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, str) or len(value) > 256:
        raise PluginValidationError("className must be a bounded string")
    names = value.strip().split()
    if len(names) > 16 or any(
        len(name) > 64 or re.fullmatch(r"-?[_A-Za-z][_A-Za-z0-9-]*", name) is None for name in names
    ):
        raise PluginValidationError("className contains an invalid CSS class")
