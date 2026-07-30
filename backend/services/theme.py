from __future__ import annotations

import contextlib
import copy
import json
import mimetypes
import os
import re
import shutil
import stat
import sys
import threading
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

THEME_FORMAT = "little-tree-theme"
THEME_FORMAT_VERSION = 1
THEME_MANIFEST = "theme.json"
DEFAULT_THEME_ID = "default"

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_COLOR_FUNCTION_RE = re.compile(r"^(?:rgb|rgba|hsl|hsla|oklch|oklab|color)\([^;{}<>]{1,120}\)$", re.IGNORECASE)
_GRADIENT_RE = re.compile(r"^(?:repeating-)?(?:linear|radial|conic)-gradient\([^{}<>]{1,2048}\)$", re.IGNORECASE)
_IMAGE_EXTENSIONS = {".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".webp"}
_VIDEO_EXTENSIONS = {".m4v", ".mov", ".mp4", ".webm"}
_FONT_EXTENSIONS = {".otf", ".ttf", ".woff", ".woff2"}
_EXTENSIONS_BY_ROLE = {
    "image": _IMAGE_EXTENSIONS,
    "video": _VIDEO_EXTENSIONS,
    "font": _FONT_EXTENSIONS,
}
_MIME_OVERRIDES = {
    ".avif": "image/avif",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
}
_MAX_MANIFEST_BYTES = 512 * 1024
_MAX_CUSTOM_CSS_CHARS = 128 * 1024
_MAX_PACKAGE_BYTES = 1024 * 1024 * 1024
_MAX_PACKAGE_FILES = 64
_MAX_ASSET_BYTES = 768 * 1024 * 1024


DEFAULT_THEME: dict[str, Any] = {
    "format": THEME_FORMAT,
    "format_version": THEME_FORMAT_VERSION,
    "id": DEFAULT_THEME_ID,
    "name": "小树默认",
    "description": "小树壁纸的标准界面主题。",
    "author": "Little Tree Studio",
    "version": "1.0.0",
    "colors": {
        "accent": "#0485F7",
        "accent_foreground": "#FCFCFC",
        "light": {
            "background": "#F7F7F7",
            "foreground": "#18181B",
            "surface": "#FFFFFF",
            "surface_secondary": "#F2F2F3",
            "surface_tertiary": "#EEEEEF",
            "muted": "#71717A",
            "border": "#DEDEE0",
            "separator": "#E6E6E8",
        },
        "dark": {
            "background": "#0D0D0F",
            "foreground": "#FAFAFA",
            "surface": "#18181B",
            "surface_secondary": "#252527",
            "surface_tertiary": "#29292B",
            "muted": "#A1A1AA",
            "border": "#2D2D30",
            "separator": "#252527",
        },
    },
    "background": {
        "type": "solid",
        "gradient": "linear-gradient(135deg, #F7F7F7 0%, #EDEDEF 100%)",
        "source": None,
        "fit": "cover",
        "position": "center center",
        "media_opacity": 1.0,
        "overlay_opacity": 0.0,
        "video_volume": 0.0,
    },
    "typography": {
        "font_family": '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        "source": None,
    },
    "custom_css": "",
    "created_at": "",
    "updated_at": "",
    "is_builtin": True,
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _string(value: Any, field: str, limit: int, *, allow_empty: bool = True) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} 必须是字符串")
    normalized = value.strip()
    if not allow_empty and not normalized:
        raise ValueError(f"{field} 不能为空")
    if len(normalized) > limit:
        raise ValueError(f"{field} 超出长度限制")
    return normalized


def _color(value: Any, field: str) -> str:
    normalized = _string(value, field, 128, allow_empty=False)
    if normalized.lower() == "transparent":
        return normalized
    if re.fullmatch(r"#[0-9a-fA-F]{3,8}", normalized) or _COLOR_FUNCTION_RE.fullmatch(normalized):
        return normalized
    raise ValueError(f"{field} 不是受支持的 CSS 颜色")


def _gradient(value: Any) -> str:
    normalized = _string(value, "background.gradient", 2048, allow_empty=False)
    if "url(" in normalized.lower() or not _GRADIENT_RE.fullmatch(normalized):
        raise ValueError("background.gradient 不是受支持的 CSS 渐变")
    return normalized


def _number(value: Any, field: str, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} 必须是数字") from exc
    if not minimum <= number <= maximum:
        raise ValueError(f"{field} 超出范围")
    return number


def _safe_asset_path(root: Path, value: str) -> Path:
    relative = PurePosixPath(value)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts or relative.parts[0] != "assets":
        raise ValueError("内置资源路径无效")
    candidate = (root / Path(*relative.parts)).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("内置资源路径越界") from exc
    return candidate


def _source(
    value: Any,
    field: str,
    role: str,
    *,
    theme_root: Path | None,
    check_paths: bool,
    allow_installed: bool = False,
) -> dict[str, str] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{field} 必须是对象或 null")
    mode = _string(value.get("mode"), f"{field}.mode", 16, allow_empty=False).lower()
    raw_value = _string(value.get("value"), f"{field}.value", 4096, allow_empty=False)
    allowed_modes = {"bundled", "path", "url"} | ({"installed"} if allow_installed else set())
    if mode not in allowed_modes:
        raise ValueError(f"{field}.mode 不受支持")
    if mode == "installed":
        return {"mode": mode, "value": raw_value}
    allowed_extensions = _EXTENSIONS_BY_ROLE[role]
    if mode == "url":
        parsed = urlparse(raw_value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError(f"{field}.value 必须是无凭据的 HTTP(S) 链接")
        return {"mode": mode, "value": raw_value}

    if mode == "bundled":
        if theme_root is None:
            raise ValueError(f"{field} 缺少主题资源目录")
        candidate = _safe_asset_path(theme_root, raw_value)
    else:
        candidate = Path(raw_value).expanduser()
        if not candidate.is_absolute():
            raise ValueError(f"{field}.value 必须是绝对路径")

    if candidate.suffix.lower() not in allowed_extensions:
        raise ValueError(f"{field}.value 文件类型不受支持")
    if check_paths and (not candidate.is_file() or candidate.stat().st_size > _MAX_ASSET_BYTES):
        raise ValueError(f"{field}.value 文件不存在或过大")
    return {"mode": mode, "value": raw_value}


def _palette(value: Any, field: str) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} 必须是对象")
    return {
        key: _color(value.get(key), f"{field}.{key}")
        for key in (
            "background",
            "foreground",
            "surface",
            "surface_secondary",
            "surface_tertiary",
            "muted",
            "border",
            "separator",
        )
    }


def normalize_theme(
    value: Any,
    *,
    theme_root: Path | None = None,
    check_paths: bool = True,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("主题根节点必须是对象")
    if value.get("format") != THEME_FORMAT or value.get("format_version") != THEME_FORMAT_VERSION:
        raise ValueError("主题格式或版本不受支持")
    theme_id = _string(value.get("id"), "id", 64, allow_empty=False).lower()
    if not _ID_RE.fullmatch(theme_id):
        raise ValueError("主题 ID 只能包含小写字母、数字、点、下划线和连字符")
    colors = value.get("colors")
    if not isinstance(colors, dict):
        raise ValueError("colors 必须是对象")

    background = value.get("background")
    if not isinstance(background, dict):
        raise ValueError("background 必须是对象")
    background_type = _string(background.get("type"), "background.type", 16, allow_empty=False).lower()
    if background_type not in {"solid", "gradient", "image", "video"}:
        raise ValueError("background.type 不受支持")
    source_role = "video" if background_type == "video" else "image"
    background_source = _source(
        background.get("source"),
        "background.source",
        source_role,
        theme_root=theme_root,
        check_paths=check_paths,
    )
    if background_type in {"image", "video"} and background_source is None:
        raise ValueError("图片或视频背景必须指定 source")

    typography = value.get("typography")
    if not isinstance(typography, dict):
        raise ValueError("typography 必须是对象")
    custom_css = value.get("custom_css", "")
    if not isinstance(custom_css, str) or len(custom_css) > _MAX_CUSTOM_CSS_CHARS:
        raise ValueError("custom_css 必须是长度受限的字符串")
    if "</style" in custom_css.lower():
        raise ValueError("custom_css 包含无效的 style 结束标签")

    normalized = {
        "format": THEME_FORMAT,
        "format_version": THEME_FORMAT_VERSION,
        "id": theme_id,
        "name": _string(value.get("name"), "name", 80, allow_empty=False),
        "description": _string(value.get("description", ""), "description", 500),
        "author": _string(value.get("author", ""), "author", 80),
        "version": _string(value.get("version", "1.0.0"), "version", 32, allow_empty=False),
        "colors": {
            "accent": _color(colors.get("accent"), "colors.accent"),
            "accent_foreground": _color(colors.get("accent_foreground"), "colors.accent_foreground"),
            "light": _palette(colors.get("light"), "colors.light"),
            "dark": _palette(colors.get("dark"), "colors.dark"),
        },
        "background": {
            "type": background_type,
            "gradient": _gradient(background.get("gradient", DEFAULT_THEME["background"]["gradient"])),
            "source": background_source,
            "fit": _string(background.get("fit", "cover"), "background.fit", 16, allow_empty=False),
            "position": _string(background.get("position", "center center"), "background.position", 64, allow_empty=False),
            "media_opacity": _number(background.get("media_opacity", 1), "background.media_opacity", 0, 1),
            "overlay_opacity": _number(background.get("overlay_opacity", 0), "background.overlay_opacity", 0, 1),
            "video_volume": _number(background.get("video_volume", 0), "background.video_volume", 0, 1),
        },
        "typography": {
            "font_family": _string(typography.get("font_family"), "typography.font_family", 240, allow_empty=False),
            "source": _source(
                typography.get("source"),
                "typography.source",
                "font",
                theme_root=theme_root,
                check_paths=check_paths,
                allow_installed=True,
            ),
        },
        "custom_css": custom_css,
        "created_at": _string(value.get("created_at", ""), "created_at", 64),
        "updated_at": _string(value.get("updated_at", ""), "updated_at", 64),
        "is_builtin": theme_id == DEFAULT_THEME_ID,
    }
    if normalized["background"]["fit"] not in {"cover", "contain", "fill", "none"}:
        raise ValueError("background.fit 不受支持")
    return normalized


class ThemeService:
    def __init__(self, themes_dir: Path) -> None:
        self.themes_dir = themes_dir
        self.themes_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._preview_paths: dict[str, tuple[Path, str]] = {}
        self._system_fonts: list[dict[str, str]] | None = None

    @staticmethod
    def _system_font_directories() -> list[Path]:
        home = Path.home()
        if sys.platform == "win32":
            roots = [
                Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts",
                Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
                / "Microsoft"
                / "Windows"
                / "Fonts",
            ]
        elif sys.platform == "darwin":
            roots = [
                Path("/System/Library/Fonts"),
                Path("/Library/Fonts"),
                home / "Library" / "Fonts",
            ]
        else:
            roots = [
                Path("/usr/share/fonts"),
                Path("/usr/local/share/fonts"),
                home / ".local" / "share" / "fonts",
                home / ".fonts",
            ]
        return list(dict.fromkeys(root.expanduser() for root in roots if root.is_dir()))

    def list_system_fonts(self) -> list[dict[str, str]]:
        with self._lock:
            if self._system_fonts is not None:
                return list(self._system_fonts)

        from fontTools.ttLib import TTCollection, TTFont, TTLibError

        extensions = {".dfont", ".otc", ".otf", ".ttc", ".ttf"}
        fonts: dict[tuple[str, str], dict[str, str]] = {}
        scanned = 0
        for root in self._system_font_directories():
            for directory, _, filenames in os.walk(root, followlinks=False):
                for filename in filenames:
                    path = Path(directory) / filename
                    if path.suffix.lower() not in extensions:
                        continue
                    scanned += 1
                    if scanned > 4096:
                        break
                    opened_fonts: list[Any] = []
                    try:
                        if path.suffix.lower() in {".otc", ".ttc"}:
                            collection = TTCollection(str(path), lazy=True)
                            opened_fonts = list(collection.fonts)
                        else:
                            opened_fonts = [TTFont(str(path), lazy=True)]
                        for font in opened_fonts:
                            names = font["name"]
                            family = (names.getBestFamilyName() or names.getDebugName(1) or "").strip()
                            style = (names.getBestSubFamilyName() or names.getDebugName(2) or "Regular").strip()
                            full_name = (names.getBestFullName() or names.getDebugName(4) or family).strip()
                            if not family.strip("? ") or len(family) > 160 or len(full_name) > 200:
                                continue
                            entry = {"family": family, "full_name": full_name, "style": style}
                            fonts.setdefault((family.casefold(), full_name.casefold()), entry)
                    except (KeyError, OSError, TTLibError):
                        continue
                    finally:
                        for font in opened_fonts:
                            font.close()
                if scanned > 4096:
                    break
            if scanned > 4096:
                break

        result = sorted(fonts.values(), key=lambda item: (item["family"].casefold(), item["full_name"].casefold()))
        with self._lock:
            self._system_fonts = result
        return list(result)

    def _theme_dir(self, theme_id: str) -> Path:
        normalized = str(theme_id).strip().lower()
        if not _ID_RE.fullmatch(normalized):
            raise ValueError("主题 ID 无效")
        return self.themes_dir / normalized

    def _manifest_path(self, theme_id: str) -> Path:
        return self._theme_dir(theme_id) / THEME_MANIFEST

    def exists(self, theme_id: str) -> bool:
        return theme_id == DEFAULT_THEME_ID or self._manifest_path(theme_id).is_file()

    def get_theme(self, theme_id: str) -> dict[str, Any]:
        if theme_id == DEFAULT_THEME_ID:
            return copy.deepcopy(DEFAULT_THEME)
        path = self._manifest_path(theme_id)
        if not path.is_file() or path.stat().st_size > _MAX_MANIFEST_BYTES:
            raise ValueError("主题不存在")
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("主题清单无法读取") from exc
        return normalize_theme(raw, theme_root=path.parent, check_paths=False)

    def list_themes(self) -> list[dict[str, Any]]:
        themes = [self._summary(copy.deepcopy(DEFAULT_THEME), self.themes_dir)]
        with self._lock:
            for directory in sorted(self.themes_dir.iterdir(), key=lambda item: item.name.lower()):
                if not directory.is_dir() or directory.name.startswith("."):
                    continue
                try:
                    theme = self.get_theme(directory.name)
                    themes.append(self._summary(theme, directory))
                except (OSError, ValueError):
                    continue
        return themes

    @staticmethod
    def _summary(theme: dict[str, Any], directory: Path) -> dict[str, Any]:
        size = 0
        if theme["id"] != DEFAULT_THEME_ID and directory.is_dir():
            for path in directory.rglob("*"):
                if path.is_file():
                    with contextlib.suppress(OSError):
                        size += path.stat().st_size
        return {
            "id": theme["id"],
            "name": theme["name"],
            "description": theme["description"],
            "author": theme["author"],
            "version": theme["version"],
            "accent": theme["colors"]["accent"],
            "background_type": theme["background"]["type"],
            "is_builtin": theme["id"] == DEFAULT_THEME_ID,
            "size_bytes": size,
            "updated_at": theme.get("updated_at", ""),
        }

    def save_theme(self, value: dict[str, Any]) -> dict[str, Any]:
        theme_id = str(value.get("id") or "").strip().lower()
        if theme_id == DEFAULT_THEME_ID:
            raise ValueError("默认主题不可修改")
        directory = self._theme_dir(theme_id)
        directory.mkdir(parents=True, exist_ok=True)
        existing_created = ""
        if self._manifest_path(theme_id).is_file():
            with contextlib.suppress(ValueError):
                existing_created = self.get_theme(theme_id).get("created_at", "")
        candidate = copy.deepcopy(value)
        candidate["id"] = theme_id
        candidate["created_at"] = existing_created or candidate.get("created_at") or _now()
        candidate["updated_at"] = _now()
        candidate["is_builtin"] = False
        normalized = normalize_theme(candidate, theme_root=directory, check_paths=True)
        payload = json.dumps(normalized, ensure_ascii=False, indent=2).encode("utf-8")
        if len(payload) > _MAX_MANIFEST_BYTES:
            raise ValueError("主题清单过大")
        temporary = directory / f".{THEME_MANIFEST}.{uuid.uuid4().hex}.tmp"
        with self._lock:
            try:
                with temporary.open("wb") as file:
                    file.write(payload)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temporary, self._manifest_path(theme_id))
            finally:
                temporary.unlink(missing_ok=True)
        return normalized

    def delete_theme(self, theme_id: str) -> None:
        if theme_id == DEFAULT_THEME_ID:
            raise ValueError("默认主题不可删除")
        directory = self._theme_dir(theme_id)
        with self._lock:
            if directory.exists():
                shutil.rmtree(directory)

    def duplicate_theme(self, theme_id: str, name: str | None = None) -> dict[str, Any]:
        source = self.get_theme(theme_id)
        new_id = self._unique_id(f"{theme_id}-copy" if theme_id != DEFAULT_THEME_ID else "custom-theme")
        target = self._theme_dir(new_id)
        if theme_id != DEFAULT_THEME_ID:
            source_dir = self._theme_dir(theme_id)
            assets = source_dir / "assets"
            if assets.is_dir():
                shutil.copytree(assets, target / "assets", dirs_exist_ok=True)
        source["id"] = new_id
        source["name"] = _string(name or f"{source['name']} 副本", "name", 80, allow_empty=False)
        source["created_at"] = ""
        source["updated_at"] = ""
        source["is_builtin"] = False
        return self.save_theme(source)

    def pick_asset(self, theme_id: str, role: str, mode: str, path: Path) -> dict[str, Any]:
        role = str(role).strip().lower()
        mode = str(mode).strip().lower()
        if role not in _EXTENSIONS_BY_ROLE or mode not in {"bundled", "path"}:
            raise ValueError("资源类型或保存方式无效")
        source = path.expanduser().resolve()
        if not source.is_file() or source.suffix.lower() not in _EXTENSIONS_BY_ROLE[role]:
            raise ValueError("资源文件类型不受支持")
        if source.stat().st_size > _MAX_ASSET_BYTES:
            raise ValueError("资源文件过大")
        selected = source
        if mode == "bundled":
            assets_dir = self._theme_dir(theme_id) / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{role}-{uuid.uuid4().hex}{source.suffix.lower()}"
            selected = assets_dir / filename
            temporary = selected.with_suffix(selected.suffix + ".part")
            try:
                shutil.copy2(source, temporary)
                os.replace(temporary, selected)
            finally:
                temporary.unlink(missing_ok=True)
            reference = {"mode": "bundled", "value": f"assets/{filename}"}
        else:
            reference = {"mode": "path", "value": str(source)}
        preview_token = uuid.uuid4().hex
        with self._lock:
            self._preview_paths[preview_token] = (selected, role)
            if len(self._preview_paths) > 64:
                self._preview_paths.pop(next(iter(self._preview_paths)))
        return {
            "source": reference,
            "preview_token": preview_token,
            "filename": source.name,
        }

    def resolve_preview(self, token: str) -> tuple[Path, str] | None:
        with self._lock:
            item = self._preview_paths.get(str(token))
        if not item:
            return None
        path, role = item
        return self._resolved_file(path, role)

    def resolve_asset(self, theme_id: str, role: str) -> tuple[Path, str] | None:
        role = str(role).strip().lower()
        if role not in {"background", "font"}:
            return None
        try:
            theme = self.get_theme(theme_id)
        except ValueError:
            return None
        source = theme["typography"]["source"] if role == "font" else theme["background"]["source"]
        if not source or source["mode"] == "url":
            return None
        asset_role = "font" if role == "font" else ("video" if theme["background"]["type"] == "video" else "image")
        if source["mode"] == "bundled":
            path = _safe_asset_path(self._theme_dir(theme_id), source["value"])
        else:
            path = Path(source["value"])
        return self._resolved_file(path, asset_role)

    @staticmethod
    def _resolved_file(path: Path, role: str) -> tuple[Path, str] | None:
        try:
            resolved = path.expanduser().resolve(strict=True)
            if not resolved.is_file() or resolved.suffix.lower() not in _EXTENSIONS_BY_ROLE[role]:
                return None
            content_type = _MIME_OVERRIDES.get(resolved.suffix.lower()) or mimetypes.guess_type(resolved.name)[0]
            return resolved, content_type or "application/octet-stream"
        except (OSError, ValueError):
            return None

    def import_theme(self, source_path: Path) -> dict[str, Any]:
        source = source_path.expanduser().resolve()
        if not source.is_file() or source.stat().st_size > _MAX_PACKAGE_BYTES:
            raise ValueError("主题文件不存在或过大")
        if zipfile.is_zipfile(source):
            return self._import_package(source)
        if source.suffix.lower() != ".json" or source.stat().st_size > _MAX_MANIFEST_BYTES:
            raise ValueError("仅支持 .lttheme 或主题 JSON")
        raw = json.loads(source.read_text(encoding="utf-8"))
        raw["id"] = self._unique_id(str(raw.get("id") or raw.get("name") or "imported-theme"))
        return self.save_theme(raw)

    def _import_package(self, source: Path) -> dict[str, Any]:
        staging = self.themes_dir / f".import-{uuid.uuid4().hex}"
        staging.mkdir(parents=True)
        try:
            with zipfile.ZipFile(source, "r") as archive:
                members = [item for item in archive.infolist() if not item.is_dir()]
                if len(members) > _MAX_PACKAGE_FILES or sum(item.file_size for item in members) > _MAX_PACKAGE_BYTES:
                    raise ValueError("主题包文件数量或解压大小超出限制")
                names = {item.filename for item in members}
                if THEME_MANIFEST not in names:
                    raise ValueError("主题包缺少 theme.json")
                for item in members:
                    relative = PurePosixPath(item.filename)
                    unix_mode = item.external_attr >> 16
                    if relative.is_absolute() or ".." in relative.parts or stat.S_ISLNK(unix_mode):
                        raise ValueError("主题包包含不安全路径")
                    if item.file_size > _MAX_ASSET_BYTES and item.filename != THEME_MANIFEST:
                        raise ValueError("主题包资源过大")
                    target = staging / Path(*relative.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(item, "r") as source_file, target.open("wb") as target_file:
                        shutil.copyfileobj(source_file, target_file)
            manifest_path = staging / THEME_MANIFEST
            if manifest_path.stat().st_size > _MAX_MANIFEST_BYTES:
                raise ValueError("主题清单过大")
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
            new_id = self._unique_id(str(raw.get("id") or raw.get("name") or "imported-theme"))
            raw["id"] = new_id
            raw["created_at"] = _now()
            raw["updated_at"] = _now()
            normalized = normalize_theme(raw, theme_root=staging, check_paths=True)
            manifest_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
            target = self._theme_dir(new_id)
            os.replace(staging, target)
            return normalized
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

    def export_theme(self, theme_id: str, destination: Path) -> Path:
        theme = self.get_theme(theme_id)
        destination = destination.expanduser().resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                archive.writestr(THEME_MANIFEST, json.dumps(theme, ensure_ascii=False, indent=2))
                if theme_id != DEFAULT_THEME_ID:
                    for role in ("background", "font"):
                        source = theme["typography"]["source"] if role == "font" else theme["background"]["source"]
                        if source and source["mode"] == "bundled":
                            asset = _safe_asset_path(self._theme_dir(theme_id), source["value"])
                            archive.write(asset, source["value"])
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return destination

    def _unique_id(self, value: str) -> str:
        base = re.sub(r"[^a-z0-9._-]+", "-", value.strip().lower()).strip(".-_")[:56] or "theme"
        if base == DEFAULT_THEME_ID:
            base = "custom-theme"
        candidate = base
        suffix = 2
        while self.exists(candidate):
            candidate = f"{base[:56]}-{suffix}"
            suffix += 1
        return candidate
