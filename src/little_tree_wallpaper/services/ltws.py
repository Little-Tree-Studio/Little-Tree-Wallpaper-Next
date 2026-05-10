from __future__ import annotations

import hashlib
import json
import re
import shutil
import tarfile
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

import requests
import rtoml
import yaml

from little_tree_wallpaper.display import get_primary_display_resolution
from little_tree_wallpaper.models import WallpaperItem
from little_tree_wallpaper.settings import SettingsStore


IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9_]+(?:\.[a-z0-9_]+)+$")
VARIABLE_PATTERN = re.compile(r"\{\{([^{}]+)\}\}")
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
OPENAPI_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


def _slugify_source_path(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9._-]+", "-", value.strip().lower())
    normalized = normalized.strip("-._")
    return normalized or "wallpaper-source"


def _slugify_category_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_-]+", "-", value.strip().lower())
    normalized = normalized.strip("-_")
    return normalized or "default"


def _stringify(value: Any) -> str:
    return str(value or "").strip()


def _coerce_int(value: Any, default: int, minimum: int | None = None) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        result = default
    if minimum is not None:
        result = max(minimum, result)
    return result


def _coerce_float(value: Any, default: float, minimum: float | None = None) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        result = default
    if minimum is not None:
        result = max(minimum, result)
    return result


def _normalize_string_list(raw_value: Any) -> list[str]:
    if isinstance(raw_value, str):
        values = re.split(r"[\r\n,]+", raw_value)
    elif isinstance(raw_value, list):
        values = raw_value
    else:
        values = []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = _stringify(item)
        if not text or text in seen:
            continue
        normalized.append(text)
        seen.add(text)
    return normalized


def _normalize_key_value_rows(raw_value: Any) -> dict[str, str]:
    if isinstance(raw_value, dict):
        return {
            _stringify(key): _stringify(value)
            for key, value in raw_value.items()
            if _stringify(key) and _stringify(value)
        }

    rows = raw_value if isinstance(raw_value, list) else []
    normalized: dict[str, str] = {}
    for item in rows:
        if not isinstance(item, dict):
            continue
        key = _stringify(item.get("key"))
        value = _stringify(item.get("value"))
        if key and value:
            normalized[key] = value
    return normalized


def _apicore_path_to_internal(path: str) -> str:
    if not path:
        return "/"
    tokens: list[str] = []
    index = 0
    while index < len(path):
        char = path[index]
        if char == ".":
            index += 1
            continue
        if char == "[":
            end_index = path.find("]", index)
            if end_index == -1:
                break
            raw_token = path[index + 1 : end_index].strip()
            if raw_token == "*":
                tokens.append("*")
            elif raw_token.isdigit():
                tokens.append(raw_token)
            elif ":" in raw_token:
                tokens.append(raw_token)
            else:
                tokens.append(raw_token)
            index = end_index + 1
            continue
        next_index = index
        while next_index < len(path) and path[next_index] not in ".[":
            next_index += 1
        token = path[index:next_index]
        if token:
            tokens.append(token)
        index = next_index
    return "/" + "/".join(tokens)


def _internal_path_to_apicore(path: str) -> str:
    if not path or path == "/":
        return "/"
    segments = [s for s in path.split("/") if s]
    result = ""
    for segment in segments:
        if segment == "*":
            result += "[*]"
        elif segment.isdigit():
            result += f"[{segment}]"
        elif ":" in segment:
            result += f"[{segment}]"
        else:
            if result:
                result += "."
            result += segment
    return result


def _normalize_rule_rows(raw_value: Any) -> list[dict[str, Any]]:
    rows = raw_value if isinstance(raw_value, list) else []
    normalized: list[dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        path = _stringify(item.get("path"))
        if not path:
            continue
        rule: dict[str, Any] = {"path": path}
        regex = _stringify(item.get("regex"))
        if regex:
            rule["regex"] = regex
        for key in ("min_length", "max_length", "min", "max"):
            if item.get(key) in {None, ""}:
                continue
            if key in {"min_length", "max_length"}:
                rule[key] = _coerce_int(item.get(key), 0, 0)
            else:
                rule[key] = _coerce_float(item.get(key), 0.0)
        normalized.append(rule)
    return normalized


def _strip_empty_sections(document: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in document.items()
        if value not in (None, "", [], {})
    }


def _sanitize_identifier_segment(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", value.strip().lower())
    normalized = normalized.strip("_")
    return normalized or "source"


class LTWSService:
    def __init__(
        self,
        sources_dir: Path,
        cache_dir: Path,
        builtin_examples_dir: Path,
        settings: SettingsStore | None = None,
    ):
        self.sources_dir = sources_dir
        self.cache_dir = cache_dir / "ltws"
        self.builtin_examples_dir = builtin_examples_dir
        self.settings = settings
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def list_sources(self) -> list[dict[str, Any]]:
        results = []
        for source_path, source_kind in self._iter_source_directories():
            try:
                results.append(self._load_source_with_state(source_path, source_kind))
            except Exception as exc:
                state_key = source_path.name
                results.append(
                    {
                        "identifier": state_key,
                        "name": source_path.name,
                        "enabled": self._is_source_enabled(state_key),
                        "source_kind": source_kind,
                        "is_builtin": source_kind == "builtin",
                        "can_delete": source_kind == "custom",
                        "invalid": True,
                        "error": str(exc),
                    }
                )
        return results

    def set_source_enabled(self, source_id: str, enabled: bool) -> dict[str, Any]:
        source_path, source_kind, state_key = self._resolve_source_entry(source_id)
        disabled_ids = self._disabled_source_ids()
        if enabled:
            disabled_ids.discard(state_key)
            disabled_ids.discard(source_id)
        else:
            disabled_ids.add(state_key)
        self._save_disabled_source_ids(disabled_ids)
        return self._load_source_with_state(source_path, source_kind)

    def delete_source(self, source_id: str) -> dict[str, Any]:
        source_path, source_kind, state_key = self._resolve_source_entry(source_id)
        if source_kind != "custom":
            raise ValueError("内置壁纸源不支持删除")
        shutil.rmtree(source_path, ignore_errors=False)
        disabled_ids = self._disabled_source_ids()
        disabled_ids.discard(state_key)
        disabled_ids.discard(source_id)
        self._save_disabled_source_ids(disabled_ids)
        return {"deleted": True, "identifier": state_key}

    def import_source(self, import_path: str) -> dict[str, Any]:
        source = Path(import_path)
        if self._is_ltws_source_path(source):
            if source.is_file() and source.name.lower() == "source.toml":
                source = source.parent
            if source.suffix == ".ltws":
                destination = self.sources_dir / source.stem
                if destination.exists():
                    shutil.rmtree(destination)
                destination.mkdir(parents=True, exist_ok=True)
                with tarfile.open(source) as archive:
                    archive.extractall(destination)
                return self._load_source(destination)

            destination = self.sources_dir / source.name
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(source, destination)
            return self._load_source(destination)

        payload = self.import_source_as_payload(import_path)
        return self.create_source(payload)

    def import_source_as_payload(self, import_path: str) -> dict[str, Any]:
        source = Path(import_path)
        document = self._load_external_document(source)
        if self._is_openapi_document(document):
            return self._convert_openapi_to_payload(document, source)

        version = _stringify(document.get("APICORE_version"))
        if version in {"1.0", "2.0"}:
            return self._convert_apicore_to_payload(document, source, version)
        raise ValueError("不支持的导入格式，当前仅支持 LTWS、APICORE v1/v2 和 OpenAPI 3.2")

    def export_source(self, source_id: str, target_path: str) -> dict[str, Any]:
        source_path = self._find_source_path(source_id)
        target = Path(target_path)
        if target.suffix.lower() != ".ltws":
            target = target.with_suffix(".ltws")
        target.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(target, "w") as archive:
            for child in sorted(source_path.rglob("*")):
                archive.add(child, arcname=str(child.relative_to(source_path)))
        return {"saved_path": str(target)}

    def export_payload(
        self,
        payload: dict[str, Any],
        export_format: str,
        target_path: str,
        export_options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_format = _stringify(export_format).lower()
        target = Path(target_path)
        if normalized_format == "apicore_v1":
            document = self._convert_payload_to_apicore(payload, "1.0")
            saved_path = self._write_external_document(document, target, ".json")
        elif normalized_format == "apicore_v2":
            document = self._convert_payload_to_apicore(payload, "2.0")
            saved_path = self._write_external_document(document, target, ".json")
        elif normalized_format == "openapi_3_2":
            document = self._convert_payload_to_openapi(payload, export_options)
            saved_path = self._write_external_document(document, target, ".yaml")
        else:
            raise ValueError("不支持的导出格式，当前仅支持 APICORE v1/v2 和 OpenAPI 3.2")
        return {"saved_path": str(saved_path)}

    def create_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        source_payload = payload.get("source") or {}
        config_payload = payload.get("config") or {}
        categories_payload = payload.get("categories") or {}
        raw_api_payloads = payload.get("apis")
        if isinstance(raw_api_payloads, list) and raw_api_payloads:
            api_payloads = [item for item in raw_api_payloads if isinstance(item, dict)]
        else:
            legacy_api_payload = payload.get("api")
            api_payloads = [legacy_api_payload] if isinstance(legacy_api_payload, dict) else []

        identifier = str(source_payload.get("identifier") or "").strip()
        if not IDENTIFIER_PATTERN.match(identifier):
            raise ValueError("identifier 不符合 littletree_wallpaper_source_v3 规范")

        name = str(source_payload.get("name") or "").strip()
        if not name:
            raise ValueError("壁纸源名称不能为空")

        version = _stringify(source_payload.get("version") or "1.0.0") or "1.0.0"
        if not VERSION_PATTERN.match(version):
            raise ValueError("version 必须符合语义化版本格式，例如 1.0.0")

        if not api_payloads:
            raise ValueError("至少需要一个 API 配置")

        existing_identifiers = {
            str(item.get("identifier") or "") for item in self.list_sources()
        }
        if identifier in existing_identifiers:
            raise ValueError("壁纸源标识已存在，请更换 identifier")

        source_dir = self.sources_dir / _slugify_source_path(identifier.replace(".", "_"))
        if source_dir.exists():
            raise ValueError("壁纸源目录已存在，请更换 identifier")

        categories_document = self._build_created_categories_document(
            categories_payload=categories_payload,
            fallback_categories=source_payload.get("categories"),
            source_name=name,
        )
        categories = categories_document.get("categories", [])
        if not categories:
            raise ValueError("至少需要一个分类")
        category_ids = {str(item.get("id") or "") for item in categories if str(item.get("id") or "")}

        source_dir.mkdir(parents=True, exist_ok=False)
        try:
            api_dir = source_dir / "apis"
            api_dir.mkdir(parents=True, exist_ok=True)

            source_document = self._build_created_source_document(
                source_payload=source_payload,
                categories=categories,
            )
            config_document = self._build_created_config_document(
                source_payload=source_payload,
                config_payload=config_payload,
            )

            (source_dir / "source.toml").write_text(
                rtoml.dumps(source_document),
                encoding="utf-8",
            )
            (source_dir / "categories.toml").write_text(
                rtoml.dumps(categories_document),
                encoding="utf-8",
            )
            (source_dir / "config.toml").write_text(
                rtoml.dumps(config_document),
                encoding="utf-8",
            )

            used_api_filenames: set[str] = set()
            for api_payload in api_payloads:
                api_name = str(api_payload.get("name") or "").strip()
                if not api_name:
                    raise ValueError("至少需要一个 API 名称")

                request_payload = api_payload.get("request") or {}
                request_url = str(request_payload.get("url") or "").strip()
                response_payload = api_payload.get("response") or {}
                response_format = (
                    str(response_payload.get("format") or "json").strip() or "json"
                )
                response_type = (
                    str(response_payload.get("type") or "multi").strip() or "multi"
                )

                if response_format not in {"static_dict", "static_list"} and not request_url:
                    raise ValueError(f"API {api_name} 的请求地址不能为空")

                mapping_payload = api_payload.get("mapping") or {}
                item_mapping = mapping_payload.get("item_mapping") or {}
                if isinstance(item_mapping, list):
                    item_mapping = _normalize_key_value_rows(item_mapping)
                if not item_mapping and any(
                    _stringify(mapping_payload.get(key))
                    for key in (
                        "image_path",
                        "title_path",
                        "preview_path",
                        "width_path",
                        "height_path",
                        "description_path",
                    )
                ):
                    item_mapping = {
                        key: _stringify(value)
                        for key, value in {
                            "image": mapping_payload.get("image_path"),
                            "title": mapping_payload.get("title_path"),
                            "preview": mapping_payload.get("preview_path"),
                            "width": mapping_payload.get("width_path"),
                            "height": mapping_payload.get("height_path"),
                            "description": mapping_payload.get("description_path"),
                        }.items()
                        if _stringify(value)
                    }
                if response_format not in {"image_url", "image_raw", "static_dict", "static_list"} and not _stringify(item_mapping.get("image")):
                    raise ValueError(f"API {api_name} 的图片字段映射不能为空")

                api_categories = _normalize_string_list(api_payload.get("categories"))
                if not api_categories:
                    raise ValueError(f"API {api_name} 至少需要绑定一个分类")
                unknown_categories = [item for item in api_categories if item not in category_ids]
                if unknown_categories:
                    raise ValueError(f"API {api_name} 引用了未定义分类: {', '.join(unknown_categories)}")

                api_filename = _slugify_source_path(api_name).replace("-", "_") or "api"
                if api_filename in used_api_filenames:
                    raise ValueError("同一个壁纸源内存在重复的 API 名称")
                used_api_filenames.add(api_filename)

                api_document = self._build_created_api_document(
                    api_payload=api_payload,
                    response_format=response_format,
                    response_type=response_type,
                )
                (api_dir / f"{api_filename}.toml").write_text(
                    rtoml.dumps(api_document),
                    encoding="utf-8",
                )

            return self._load_source(source_dir)
        except Exception:
            shutil.rmtree(source_dir, ignore_errors=True)
            raise

    def execute_api(self, source_id: str, api_name: str, parameters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        parameters = parameters or {}
        if not self._is_source_enabled(source_id):
            raise ValueError("该壁纸源已禁用，请先启用后再执行")
        source_path = self._find_source_path(source_id)
        spec = self._load_source(source_path)
        api_spec = self._find_api_spec(spec, api_name)
        return self._execute_api_spec(
            source_id=source_id,
            spec=spec,
            api_spec=api_spec,
            parameters=parameters,
            visited=set(),
        )

    def _find_source_path(self, source_id: str) -> Path:
        source_path, _, _ = self._resolve_source_entry(source_id)
        return source_path

    def _iter_source_directories(self) -> list[tuple[Path, str]]:
        directories: list[tuple[Path, str]] = []
        example_root = self.builtin_examples_dir / "ltws"
        if example_root.exists():
            directories.extend(
                (path, "builtin")
                for path in sorted(example_root.iterdir())
                if path.is_dir()
            )
        if self.sources_dir.exists():
            directories.extend(
                (path, "custom")
                for path in sorted(self.sources_dir.iterdir())
                if path.is_dir()
            )
        return directories

    def _resolve_source_entry(self, source_id: str) -> tuple[Path, str, str]:
        normalized_source_id = _stringify(source_id)
        if not normalized_source_id:
            raise FileNotFoundError("未找到壁纸源")

        for source_path, source_kind in self._iter_source_directories():
            source_toml = source_path / "source.toml"
            if not source_toml.exists():
                if source_path.name == normalized_source_id:
                    return source_path, source_kind, source_path.name
                continue
            try:
                source_spec = rtoml.load(source_toml)
            except Exception:
                if source_path.name == normalized_source_id:
                    return source_path, source_kind, source_path.name
                continue

            identifier = _stringify(source_spec.get("identifier"))
            if normalized_source_id in {identifier, source_path.name}:
                return source_path, source_kind, identifier or source_path.name
        raise FileNotFoundError(f"未找到壁纸源: {source_id}")

    def _load_source_with_state(self, source_dir: Path, source_kind: str) -> dict[str, Any]:
        payload = self._load_source(source_dir)
        payload["enabled"] = self._is_source_enabled(payload.get("identifier"))
        payload["source_kind"] = source_kind
        payload["is_builtin"] = source_kind == "builtin"
        payload["can_delete"] = source_kind == "custom"
        return payload

    def _disabled_source_ids(self) -> set[str]:
        if self.settings is None:
            return set()
        raw_value = self.settings.get("wallpaper.sources.disabled_ids", [])
        values = raw_value if isinstance(raw_value, list) else []
        return {_stringify(value) for value in values if _stringify(value)}

    def _save_disabled_source_ids(self, disabled_ids: set[str]) -> None:
        if self.settings is None:
            return
        self.settings.set(
            "wallpaper.sources.disabled_ids",
            sorted(disabled_id for disabled_id in disabled_ids if disabled_id),
        )

    def _is_source_enabled(self, source_id: Any) -> bool:
        normalized_source_id = _stringify(source_id)
        if not normalized_source_id:
            return True
        return normalized_source_id not in self._disabled_source_ids()

    def _normalize_created_source_categories(self, raw_categories: Any) -> list[dict[str, str]]:
        values = raw_categories if isinstance(raw_categories, list) else []
        normalized: list[dict[str, str]] = []
        seen_ids: set[str] = set()
        for value in values:
            label = str(value or "").strip()
            if not label:
                continue
            category_id = _slugify_category_id(label)
            if category_id in seen_ids:
                continue
            normalized.append({"id": category_id, "name": label})
            seen_ids.add(category_id)

        if normalized:
            return normalized
        return [{"id": "default", "name": "默认分类"}]

    def _build_created_source_document(
        self,
        *,
        source_payload: dict[str, Any],
        categories: list[dict[str, str]],
    ) -> dict[str, Any]:
        document: dict[str, Any] = {
            "scheme": "littletree_wallpaper_source_v3",
            "identifier": str(source_payload.get("identifier") or "").strip(),
            "name": str(source_payload.get("name") or "").strip(),
            "version": str(source_payload.get("version") or "1.0.0").strip() or "1.0.0",
            "categories": "categories.toml",
            "apis": ["apis/*.toml"],
            "config": "config.toml",
            "description": str(source_payload.get("description") or "").strip(),
            "details": str(source_payload.get("details") or "").strip(),
            "logo": str(source_payload.get("logo") or "").strip(),
            "footer_text": str(source_payload.get("footer_text") or "").strip(),
        }
        merge_payload = source_payload.get("merge") or {}
        merge_document = {
            "enabled": bool(merge_payload.get("enabled", True)),
            "strategy": _stringify(merge_payload.get("strategy") or "same_id") or "same_id",
            "priority": _coerce_int(merge_payload.get("priority"), 120, 0),
            "metadata_source": _stringify(merge_payload.get("metadata_source") or "high_priority") or "high_priority",
            "allow_metadata_override": bool(merge_payload.get("allow_metadata_override", True)),
        }
        document["merge"] = merge_document
        if not document["description"]:
            document["description"] = f"{document['name']} 的自定义 LTWS 壁纸源"
        if not document["details"]:
            category_names = "、".join(item["name"] for item in categories)
            document["details"] = (
                f"# {document['name']}\n\n"
                f"通过可视化编辑器创建，默认分类包含：{category_names}。"
            )
        if not document["footer_text"]:
            document["footer_text"] = "Created with Little Tree Wallpaper Next"
        return _strip_empty_sections(document)

    def _build_created_categories_document(
        self,
        *,
        categories_payload: dict[str, Any],
        fallback_categories: Any,
        source_name: str,
    ) -> dict[str, Any]:
        raw_categories = categories_payload.get("categories")
        category_rows = raw_categories if isinstance(raw_categories, list) and raw_categories else self._normalize_created_source_categories(fallback_categories)
        categories: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for item in category_rows:
            if isinstance(item, dict):
                category_id = _slugify_category_id(_stringify(item.get("id") or item.get("name")))
                name = _stringify(item.get("name") or category_id)
                category = _stringify(item.get("category") or categories_payload.get("template", {}).get("category") or "自定义") or "自定义"
                subcategory = _stringify(item.get("subcategory") or source_name)
                subsubcategory = _stringify(item.get("subsubcategory"))
                icon = _stringify(item.get("icon"))
                description = _stringify(item.get("description"))
            else:
                name = _stringify(item)
                category_id = _slugify_category_id(name)
                category = "自定义"
                subcategory = source_name
                subsubcategory = ""
                icon = ""
                description = f"{source_name} · {name}"
            if not category_id or category_id in seen_ids:
                continue
            categories.append(
                _strip_empty_sections(
                    {
                        "id": category_id,
                        "name": name or category_id,
                        "category": category,
                        "subcategory": subcategory,
                        "subsubcategory": subsubcategory,
                        "icon": icon,
                        "description": description,
                    }
                )
            )
            seen_ids.add(category_id)

        template_payload = categories_payload.get("template") or {}
        template_document = _strip_empty_sections(
            {
                "icon": _stringify(template_payload.get("icon")),
                "category": _stringify(template_payload.get("category") or "自定义") or "自定义",
            }
        )

        category_groups: list[dict[str, Any]] = []
        for item in categories_payload.get("category_groups") or []:
            if not isinstance(item, dict):
                continue
            name = _stringify(item.get("name"))
            category_ids = [category_id for category_id in _normalize_string_list(item.get("category_ids")) if category_id in seen_ids]
            if name and category_ids:
                category_groups.append({"name": name, "category_ids": category_ids})
        if not category_groups and categories:
            category_groups.append(
                {
                    "name": "默认分组",
                    "category_ids": [item["id"] for item in categories],
                }
            )

        raw_level_icons = categories_payload.get("level_icons") or {}
        level_icons = {
            level: _normalize_key_value_rows(raw_level_icons.get(level))
            for level in ("category", "subcategory", "subsubcategory")
        }
        level_icons = {key: value for key, value in level_icons.items() if value}

        document: dict[str, Any] = {
            "template": template_document,
            "categories": categories,
            "category_groups": category_groups,
        }
        if level_icons:
            document["level_icons"] = level_icons
        return _strip_empty_sections(document)

    def _build_created_config_document(
        self,
        *,
        source_payload: dict[str, Any],
        config_payload: dict[str, Any],
    ) -> dict[str, Any]:
        request_payload = config_payload.get("request") or {}
        timeout_seconds = _coerce_int(
            request_payload.get("timeout_seconds", source_payload.get("timeout_seconds")),
            20,
            1,
        )
        request_document: dict[str, Any] = {
            "global_interval_seconds": _coerce_int(
                request_payload.get("global_interval_seconds", source_payload.get("global_interval_seconds")),
                1800,
                0,
            ),
            "timeout_seconds": timeout_seconds,
            "max_concurrent": _coerce_int(request_payload.get("max_concurrent"), 2, 1),
            "skip_ssl_verify": bool(request_payload.get("skip_ssl_verify", False)),
            "user_agent": _stringify(request_payload.get("user_agent") or "LittleTreeWallpaperNext/0.1.0"),
        }

        headers = _normalize_key_value_rows(request_payload.get("headers"))
        if headers:
            request_document["headers"] = headers

        retry_payload = request_payload.get("retry") or {}
        retry_document = _strip_empty_sections(
            {
                "max_attempts": _coerce_int(retry_payload.get("max_attempts"), 2, 1),
                "backoff_base": _coerce_float(retry_payload.get("backoff_base"), 1.5, 1.0),
                "initial_delay_ms": _coerce_int(retry_payload.get("initial_delay_ms"), 600, 0),
            }
        )
        if retry_document:
            request_document["retry"] = retry_document

        cache_payload = request_payload.get("cache") or {}
        cache_document = _strip_empty_sections(
            {
                "enabled": bool(cache_payload.get("enabled", True)),
                "default_ttl_seconds": _coerce_int(cache_payload.get("default_ttl_seconds"), 21600, 1),
                "max_memory_mb": _coerce_int(cache_payload.get("max_memory_mb"), 32, 1),
            }
        )
        if cache_document:
            request_document["cache"] = cache_document

        variables = _normalize_key_value_rows(request_payload.get("variables"))
        if not variables:
            variables = {
                "timestamp": "{{timestamp_ms}}",
                "date": "{{date_iso}}",
                "screen_width": "{{screen_width}}",
                "screen_height": "{{screen_height}}",
            }
        request_document["variables"] = variables
        return {"request": request_document}

    def _build_created_api_document(
        self,
        *,
        api_payload: dict[str, Any],
        response_format: str,
        response_type: str,
    ) -> dict[str, Any]:
        request_payload = api_payload.get("request") or {}
        response_payload = api_payload.get("response") or {}
        mapping_payload = api_payload.get("mapping") or {}
        validation_payload = api_payload.get("validation") or {}
        error_handling_payload = api_payload.get("error_handling") or {}
        cache_payload = api_payload.get("cache") or {}

        document: dict[str, Any] = {
            "name": str(api_payload.get("name") or "").strip(),
            "description": str(api_payload.get("description") or "").strip(),
            "logo": _stringify(api_payload.get("logo")),
            "categories": [
                str(item).strip()
                for item in (api_payload.get("categories") or [])
                if str(item).strip()
            ],
            "response": {
                "format": response_format,
                "type": response_type,
            },
        }

        request_document = _strip_empty_sections(
            {
                "url": str(request_payload.get("url") or "").strip(),
                "method": str(request_payload.get("method") or "GET").strip() or "GET",
                "timeout_seconds": _coerce_int(request_payload.get("timeout_seconds"), 20, 1),
                "interval_seconds": _coerce_int(request_payload.get("interval_seconds"), 0),
                "body": _stringify(request_payload.get("body")),
                "body_type": _stringify(request_payload.get("body_type") or "json") or "json",
            }
        )
        if request_document:
            document["request"] = request_document

        headers = self._normalize_created_headers(request_payload.get("headers"))
        if headers:
            document.setdefault("request", {})["headers"] = headers

        parameters = self._normalize_created_parameters(api_payload.get("parameters"))
        if parameters:
            document["parameters"] = parameters

        if response_format == "static_list":
            urls = _normalize_string_list(api_payload.get("static_list_urls"))
            document["static_list"] = {"urls": urls}
        elif response_format == "static_dict":
            items: list[dict[str, Any]] = []
            for item in api_payload.get("static_dict_items") or []:
                if not isinstance(item, dict):
                    continue
                normalized_item = _strip_empty_sections(
                    {
                        "image": _stringify(item.get("image")),
                        "title": _stringify(item.get("title")),
                        "preview": _stringify(item.get("preview")),
                        "description": _stringify(item.get("description")),
                        "width": _coerce_int(item.get("width"), 0, 0) if item.get("width") not in {None, ""} else None,
                        "height": _coerce_int(item.get("height"), 0, 0) if item.get("height") not in {None, ""} else None,
                    }
                )
                if normalized_item:
                    items.append(normalized_item)
            document["static_dict"] = {"items": items}
        elif response_format not in {"image_url", "image_raw"}:
            mapping_document: dict[str, Any] = {}
            items_path = _stringify(mapping_payload.get("items") or mapping_payload.get("items_path"))
            if response_type == "multi" and items_path:
                mapping_document["items"] = items_path

            item_mapping = mapping_payload.get("item_mapping") or {}
            if not item_mapping:
                item_mapping = {
                    key: str(value).strip()
                    for key, value in {
                        "image": mapping_payload.get("image_path"),
                        "title": mapping_payload.get("title_path"),
                        "preview": mapping_payload.get("preview_path"),
                        "width": mapping_payload.get("width_path"),
                        "height": mapping_payload.get("height_path"),
                        "description": mapping_payload.get("description_path"),
                    }.items()
                    if str(value or "").strip()
                }
            elif isinstance(item_mapping, list):
                item_mapping = _normalize_key_value_rows(item_mapping)
            mapping_document["item_mapping"] = item_mapping
            document["mapping"] = _strip_empty_sections(mapping_document)

        post_process = api_payload.get("post_process") or {}
        if not post_process:
            image_template = str(mapping_payload.get("image_template") or "").strip()
            post_process = {"image": image_template} if image_template else {}
        normalized_post_process = _normalize_key_value_rows(post_process)
        if normalized_post_process:
            document["post_process"] = normalized_post_process

        validation_document = self._build_created_validation_document(validation_payload)
        if validation_document:
            document["validation"] = validation_document

        error_handling_document = self._build_created_error_handling_document(
            error_handling_payload
        )
        if error_handling_document:
            document["error_handling"] = error_handling_document

        cache_enabled = cache_payload.get("enabled")
        if cache_enabled is True or cache_payload.get("ttl_seconds") not in {None, ""} or _stringify(cache_payload.get("key_template")):
            document["cache"] = {
                "enabled": bool(cache_payload.get("enabled", True)),
                "ttl_seconds": max(1, int(cache_payload.get("ttl_seconds") or 3600)),
                "key_template": str(cache_payload.get("key_template") or "").strip()
                or f"{_slugify_source_path(document['name']).replace('-', '_')}_{{date_iso}}",
            }

        return _strip_empty_sections(document)

    def _normalize_created_headers(self, raw_headers: Any) -> dict[str, str]:
        return _normalize_key_value_rows(raw_headers)

    def _normalize_created_parameters(self, raw_parameters: Any) -> list[dict[str, Any]]:
        values = raw_parameters if isinstance(raw_parameters, list) else []
        normalized: list[dict[str, Any]] = []
        for item in values:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            if not key:
                continue
            parameter: dict[str, Any] = {
                "key": key,
                "type": str(item.get("type") or "text").strip() or "text",
                "label": str(item.get("label") or key).strip() or key,
            }
            default_value = item.get("default")
            if default_value not in {None, ""}:
                parameter["default"] = default_value
            choices = [
                str(choice).strip()
                for choice in (item.get("choices") or [])
                if str(choice).strip()
            ]
            if choices:
                parameter["choices"] = choices
            description = _stringify(item.get("description"))
            placeholder = _stringify(item.get("placeholder"))
            if description:
                parameter["description"] = description
            if placeholder:
                parameter["placeholder"] = placeholder
            if item.get("hidden") is True:
                parameter["hidden"] = True
            if item.get("min_length") not in {None, ""}:
                parameter["min_length"] = _coerce_int(item.get("min_length"), 0, 0)
            if item.get("max_length") not in {None, ""}:
                parameter["max_length"] = _coerce_int(item.get("max_length"), 0, 0)
            normalized.append(_strip_empty_sections(parameter))
        return normalized

    def _build_created_validation_document(
        self, validation_payload: dict[str, Any]
    ) -> dict[str, Any]:
        required_fields = _normalize_string_list(validation_payload.get("required_fields"))
        if not required_fields:
            if bool(validation_payload.get("require_image", True)):
                required_fields.append("image")
            if bool(validation_payload.get("require_title", False)):
                required_fields.append("title")

        field_patterns = _normalize_rule_rows(validation_payload.get("field_patterns"))
        if not field_patterns:
            image_regex = str(validation_payload.get("image_regex") or "").strip()
            if image_regex:
                field_patterns.append({"path": "image", "regex": image_regex})
            title_max_length = validation_payload.get("title_max_length")
            if title_max_length not in {None, ""}:
                field_patterns.append(
                    {"path": "title", "max_length": int(title_max_length)}
                )

        quality_rules = _normalize_rule_rows(validation_payload.get("quality_rules"))
        return _strip_empty_sections(
            {
                "required_fields": required_fields,
                "field_patterns": field_patterns,
                "quality_rules": quality_rules,
            }
        )

    def _build_created_error_handling_document(
        self, error_handling_payload: dict[str, Any]
    ) -> dict[str, Any]:
        http_codes: list[dict[str, Any]] = []
        for item in error_handling_payload.get("http_codes") or []:
            if not isinstance(item, dict):
                continue
            code = item.get("code")
            if code in {None, ""}:
                continue
            http_codes.append(
                _strip_empty_sections(
                    {
                        "code": _coerce_int(code, 0, 100),
                        "message": _stringify(item.get("message")),
                        "retry_after": _coerce_int(item.get("retry_after"), 0, 0) if item.get("retry_after") not in {None, ""} else None,
                        "fallback": bool(item.get("fallback", False)) or None,
                    }
                )
            )

        return _strip_empty_sections(
            {
                "http_codes": http_codes,
                "on_empty_response": _stringify(error_handling_payload.get("on_empty_response")),
                "on_mapping_failed": _stringify(error_handling_payload.get("on_mapping_failed")),
                "fallback_to": _stringify(error_handling_payload.get("fallback_to")),
            }
        )

    def _load_source(self, source_dir: Path) -> dict[str, Any]:
        source_file = source_dir / "source.toml"
        if not source_file.exists():
            raise FileNotFoundError("缺少 source.toml")
        source_spec = rtoml.load(source_file)
        if source_spec.get("scheme") != "littletree_wallpaper_source_v3":
            raise ValueError("scheme 不合法")
        identifier = source_spec.get("identifier", "")
        if not IDENTIFIER_PATTERN.match(identifier):
            raise ValueError("identifier 不符合 littletree_wallpaper_source_v3 规范")

        categories_path = source_dir / source_spec["categories"]
        categories_spec = rtoml.load(categories_path)
        config_path = source_dir / source_spec.get("config", "config.toml")
        config_spec = rtoml.load(config_path) if config_path.exists() else {}
        api_specs = []
        for pattern in source_spec.get("apis", []):
            for api_path in sorted(source_dir.glob(pattern)):
                api_spec = rtoml.load(api_path)
                api_spec["_file_stem"] = api_path.stem
                api_specs.append(api_spec)

        return {
            "identifier": identifier,
            "name": source_spec["name"],
            "version": source_spec["version"],
            "description": source_spec.get("description", ""),
            "details": source_spec.get("details", ""),
            "logo": source_spec.get("logo", ""),
            "footer_text": source_spec.get("footer_text", ""),
            "categories": categories_spec.get("categories", []),
            "category_groups": categories_spec.get("category_groups", []),
            "config": config_spec,
            "apis": api_specs,
            "merge": source_spec.get("merge", {}),
        }

    def _render_template(self, template: str, variables: dict[str, Any]) -> str:
        return self._render_template_with_custom_values(template, variables, None)

    def _render_template_with_custom_values(
        self,
        template: str,
        variables: dict[str, Any],
        custom_variables: dict[str, Any] | None,
    ) -> str:
        screen = get_primary_display_resolution()
        screen_width = max(1, int(screen.get("width", 1920)))
        screen_height = max(1, int(screen.get("height", 1080)))
        builtin_values = {
            "timestamp_ms": str(int(datetime.utcnow().timestamp() * 1000)),
            "timestamp_s": str(int(datetime.utcnow().timestamp())),
            "date_iso": date.today().isoformat(),
            "date": date.today().isoformat(),
            "date_cn": date.today().strftime("%Y年%m月%d日"),
            "year": date.today().strftime("%Y"),
            "month": date.today().strftime("%m"),
            "day": date.today().strftime("%d"),
            "screen_width": str(screen_width),
            "screen_height": str(screen_height),
            "screen_ratio": str(screen_width / screen_height),
        }
        merged = {**builtin_values, **{key: str(value) for key, value in variables.items()}}
        if custom_variables:
            resolved_custom: dict[str, str] = {}
            for _ in range(2):
                current = {**merged, **resolved_custom}
                for key, value in custom_variables.items():
                    resolved_custom[key] = VARIABLE_PATTERN.sub(
                        lambda match: current.get(match.group(1), match.group(0)),
                        str(value),
                    )
            merged.update(resolved_custom)

        def replacer(match: re.Match[str]) -> str:
            expression = match.group(1)
            if expression.startswith("random_string:"):
                length = max(1, int(expression.split(":", 1)[1]))
                return hashlib.sha1(f"{datetime.utcnow().isoformat()}|{length}".encode("utf-8")).hexdigest()[:length]
            if expression.startswith("random_hex:"):
                length = max(1, int(expression.split(":", 1)[1]))
                return hashlib.md5(datetime.utcnow().isoformat().encode("utf-8")).hexdigest()[:length]
            if expression.startswith("random_int:"):
                _, start, end = expression.split(":")
                seed = int(datetime.utcnow().timestamp() * 1000)
                lower = int(start)
                upper = int(end)
                return str(lower + (seed % (upper - lower + 1)))
            return merged.get(expression, match.group(0))

        return VARIABLE_PATTERN.sub(replacer, template)

    def _map_response(
        self,
        source_name: str,
        source_id: str,
        api_name: str,
        api_spec: dict[str, Any],
        response_text: str,
        response_bytes: bytes,
    ) -> list[dict[str, Any]]:
        response_spec = api_spec.get("response", {})
        mapping_spec = api_spec.get("mapping", {})
        format_name = response_spec.get("format", "json")
        response_type = response_spec.get("type", "multi")

        if format_name == "image_url":
            return [self._apply_post_process(self._normalize_item({"image": response_text.strip(), "title": api_name}, source_id, source_name, api_name), api_spec)]
        if format_name == "image_raw":
            cache_name = hashlib.sha1(response_bytes).hexdigest() + ".jpg"
            image_path = self.cache_dir / cache_name
            image_path.write_bytes(response_bytes)
            return [self._apply_post_process(self._normalize_item({"image": str(image_path), "title": api_name}, source_id, source_name, api_name), api_spec)]

        if format_name == "toml":
            payload = rtoml.loads(response_text)
        else:
            payload = json.loads(response_text)

        if response_type == "single":
            mapped = self._map_item(mapping_spec, payload)
            return [self._apply_post_process(self._normalize_item(mapped, source_id, source_name, api_name), api_spec)]

        items_path = mapping_spec.get("items")
        raw_items = self._extract_path(payload, items_path) if items_path else payload
        if not isinstance(raw_items, list):
            raw_items = [raw_items]
        results = []
        error_handling = api_spec.get("error_handling", {})
        for raw_item in raw_items:
            try:
                mapped_item = self._map_item(mapping_spec.get("item_mapping", {}), raw_item)
                results.append(self._apply_post_process(self._normalize_item(mapped_item, source_id, source_name, api_name), api_spec))
            except Exception:
                if error_handling.get("on_mapping_failed") == "skip_item":
                    continue
                raise
        return results

    def _map_item(self, mapping_spec: dict[str, Any], item: Any) -> dict[str, Any]:
        mapped: dict[str, Any] = {}
        for key, path in mapping_spec.items():
            if key == "items":
                continue
            mapped[key] = self._extract_path(item, path)
        return mapped

    def _extract_path(self, payload: Any, path_spec: Any) -> Any:
        if isinstance(path_spec, list):
            for item in path_spec:
                resolved = self._extract_path(payload, item)
                if resolved not in {None, "", []}:
                    return resolved
            return None

        if not isinstance(path_spec, str) or not path_spec:
            return None

        if path_spec.startswith("/"):
            segments = [segment for segment in path_spec.split("/") if segment]
            return self._extract_pointer(payload, segments)

        current = payload
        for segment in path_spec.split("."):
            if isinstance(current, dict):
                current = current.get(segment)
            else:
                return None
        return current

    def _extract_pointer(self, payload: Any, segments: list[str]) -> Any:
        if not segments:
            return payload

        segment = segments[0]
        rest = segments[1:]

        if segment == "**":
            direct = self._extract_pointer(payload, rest)
            if direct not in {None, "", []}:
                return direct
            if isinstance(payload, dict):
                for value in payload.values():
                    deep = self._extract_pointer(value, segments)
                    if deep not in {None, "", []}:
                        return deep
            if isinstance(payload, list):
                for value in payload:
                    deep = self._extract_pointer(value, segments)
                    if deep not in {None, "", []}:
                        return deep
            return None

        if segment == "*":
            if isinstance(payload, list):
                results: list[Any] = []
                for value in payload:
                    result = self._extract_pointer(value, rest)
                    if isinstance(result, list):
                        results.extend(result)
                    elif result is not None:
                        results.append(result)
                return results
            if isinstance(payload, dict):
                for value in payload.values():
                    found = self._extract_pointer(value, rest)
                    if found not in {None, "", []}:
                        return found
            return None

        if isinstance(payload, list):
            slice_obj = self._parse_slice_segment(segment)
            if slice_obj is not None:
                results: list[Any] = []
                for value in payload[slice_obj]:
                    result = self._extract_pointer(value, rest)
                    if isinstance(result, list):
                        results.extend(result)
                    elif result is not None:
                        results.append(result)
                return results
            if segment.isdigit() and int(segment) < len(payload):
                return self._extract_pointer(payload[int(segment)], rest)
            return None
        if isinstance(payload, dict):
            return self._extract_pointer(payload.get(segment), rest)
        return None

    def _parse_slice_segment(self, segment: str) -> slice | None:
        if ":" not in segment:
            return None
        parts = segment.split(":")
        if len(parts) > 3:
            return None
        if not all(p.strip() == "" or p.strip().lstrip("-").isdigit() for p in parts):
            return None
        slice_parts: list[int | None] = []
        for p in parts:
            p = p.strip()
            slice_parts.append(int(p) if p else None)
        return slice(slice_parts[0], slice_parts[1], slice_parts[2] if len(slice_parts) > 2 else None)

    def _normalize_item(self, item: dict[str, Any], source_id: str, source_name: str, api_name: str) -> dict[str, Any]:
        image_url = item.get("image") or item.get("image_url") or ""
        preview_url = item.get("preview") or item.get("preview_url") or image_url
        wallpaper = WallpaperItem(
            id=item.get("id") or hashlib.sha1(f"{source_id}|{api_name}|{image_url}".encode("utf-8")).hexdigest(),
            source_id=source_id,
            source_name=source_name,
            title=item.get("title") or api_name,
            image_url=image_url,
            preview_url=preview_url,
            width=int(item["width"]) if item.get("width") not in {None, ""} else None,
            height=int(item["height"]) if item.get("height") not in {None, ""} else None,
            description=item.get("description", ""),
            metadata={key: value for key, value in item.items() if key not in {"id", "title", "image", "image_url", "preview", "preview_url", "width", "height", "description"}},
        )
        return wallpaper.to_dict()

    def _apply_post_process(self, item: dict[str, Any], api_spec: dict[str, Any]) -> dict[str, Any]:
        post_process = api_spec.get("post_process", {})
        if not post_process:
            return item
        result = dict(item)
        for key, template in post_process.items():
            current_variables = {**{field: str(value) for field, value in result.items() if value is not None}, **{field: str(value) for field, value in result.get("metadata", {}).items() if value is not None}}
            result[key if key != "image" else "image_url"] = self._render_template(template, current_variables)
            if key == "image":
                result["preview_url"] = result["image_url"]
        return result

    def _find_api_spec(self, spec: dict[str, Any], api_name: str) -> dict[str, Any]:
        for api in spec.get("apis", []):
            if api.get("name") == api_name or api.get("_file_stem") == api_name:
                return api
        raise ValueError(f"未找到 API: {api_name}")

    def _resolve_cache_spec(self, spec: dict[str, Any], api_spec: dict[str, Any]) -> dict[str, Any]:
        global_cache = (
            spec.get("config", {})
            .get("request", {})
            .get("cache", {})
        )
        api_cache = api_spec.get("cache", {})
        enabled = api_cache.get("enabled")
        if enabled is None:
            enabled = global_cache.get("enabled", False)
        ttl_seconds = api_cache.get("ttl_seconds")
        if ttl_seconds in {None, ""}:
            ttl_seconds = global_cache.get("default_ttl_seconds", 300)
        return {
            "enabled": bool(enabled),
            "ttl_seconds": _coerce_int(ttl_seconds, 300, 1),
            "key_template": _stringify(api_cache.get("key_template")),
        }

    def _match_http_code_rule(
        self, error_handling: dict[str, Any], status_code: int
    ) -> dict[str, Any] | None:
        for rule in error_handling.get("http_codes", []):
            if _coerce_int(rule.get("code"), 0) == status_code:
                return rule
        return None

    def _resolve_retry_delay(
        self,
        *,
        attempt: int,
        retry_spec: dict[str, Any],
        http_rule: dict[str, Any] | None,
        response: requests.Response | None,
    ) -> float:
        backoff_base = _coerce_float(retry_spec.get("backoff_base"), 1.5, 1.0)
        initial_delay_ms = _coerce_int(retry_spec.get("initial_delay_ms"), 0, 0)
        delay = (initial_delay_ms / 1000.0) * (backoff_base ** max(0, attempt - 1))
        retry_after = None
        if response is not None:
            retry_after_header = response.headers.get("Retry-After")
            if retry_after_header and retry_after_header.isdigit():
                retry_after = float(retry_after_header)
        if retry_after is None and http_rule and http_rule.get("retry_after") not in {None, ""}:
            retry_after = float(http_rule["retry_after"])
        if retry_after is not None:
            delay = max(delay, retry_after)
        return max(0.0, delay)

    def _resolve_fallback_api(
        self, spec: dict[str, Any], api_spec: dict[str, Any]
    ) -> dict[str, Any] | None:
        fallback_to = _stringify(api_spec.get("error_handling", {}).get("fallback_to"))
        if not fallback_to:
            return None
        for candidate in spec.get("apis", []):
            if candidate is api_spec:
                continue
            if candidate.get("_file_stem") == fallback_to or candidate.get("name") == fallback_to:
                return candidate
        return None

    def _request_response(
        self,
        *,
        request_spec: dict[str, Any],
        request_config: dict[str, Any],
        parameters: dict[str, Any],
        error_handling: dict[str, Any],
    ) -> requests.Response:
        custom_variables = request_config.get("variables") if isinstance(request_config.get("variables"), dict) else None
        headers = {
            **_normalize_key_value_rows(request_config.get("headers")),
            **_normalize_key_value_rows(request_spec.get("headers")),
        }
        headers = {
            key: self._render_template_with_custom_values(value, parameters, custom_variables)
            for key, value in headers.items()
        }
        user_agent = _stringify(request_config.get("user_agent"))
        if user_agent and "User-Agent" not in headers:
            headers["User-Agent"] = user_agent
        url = self._render_template_with_custom_values(
            request_spec.get("url", ""),
            parameters,
            custom_variables,
        )
        timeout_seconds = _coerce_int(
            request_spec.get("timeout_seconds", request_config.get("timeout_seconds")),
            20,
            1,
        )
        retry_spec = request_config.get("retry", {}) if isinstance(request_config.get("retry"), dict) else {}
        max_attempts = _coerce_int(retry_spec.get("max_attempts"), 1, 1)
        verify = not bool(request_config.get("skip_ssl_verify", False))

        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            response: requests.Response | None = None
            try:
                request_kwargs: dict[str, Any] = {
                    "method": request_spec.get("method", "GET"),
                    "url": url,
                    "headers": headers,
                    "timeout": timeout_seconds,
                    "verify": verify,
                }
                body_template = request_spec.get("body")
                if body_template not in {None, ""}:
                    rendered_body = self._render_template_with_custom_values(
                        str(body_template),
                        parameters,
                        custom_variables,
                    )
                    body_type = _stringify(request_spec.get("body_type") or "json").lower() or "json"
                    if body_type == "json":
                        try:
                            request_kwargs["json"] = json.loads(rendered_body)
                        except Exception:
                            request_kwargs["data"] = rendered_body.encode("utf-8")
                        headers.setdefault("Content-Type", "application/json")
                    elif body_type == "form":
                        try:
                            parsed_body = json.loads(rendered_body)
                            request_kwargs["data"] = parsed_body if isinstance(parsed_body, dict) else rendered_body
                        except Exception:
                            request_kwargs["data"] = rendered_body
                        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
                    else:
                        request_kwargs["data"] = rendered_body.encode("utf-8")
                response = requests.request(
                    **request_kwargs,
                )
                http_rule = self._match_http_code_rule(error_handling, response.status_code)
                if response.ok:
                    return response
                should_retry = response.status_code in {408, 429, 500, 502, 503, 504}
                if attempt < max_attempts and (should_retry or http_rule is not None):
                    time.sleep(
                        self._resolve_retry_delay(
                            attempt=attempt,
                            retry_spec=retry_spec,
                            http_rule=http_rule,
                            response=response,
                        )
                    )
                    continue
                response.raise_for_status()
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= max_attempts:
                    break
                time.sleep(
                    self._resolve_retry_delay(
                        attempt=attempt,
                        retry_spec=retry_spec,
                        http_rule=None,
                        response=response,
                    )
                )
        if last_error is not None:
            raise last_error
        raise RuntimeError("请求壁纸源失败")

    def _execute_api_spec(
        self,
        *,
        source_id: str,
        spec: dict[str, Any],
        api_spec: dict[str, Any],
        parameters: dict[str, Any],
        visited: set[str],
    ) -> list[dict[str, Any]]:
        api_visit_key = str(api_spec.get("_file_stem") or api_spec.get("name") or "")
        if api_visit_key in visited:
            raise RuntimeError(f"检测到 fallback 循环: {api_visit_key}")
        visited.add(api_visit_key)

        request_spec = api_spec.get("request", {})
        response_spec = api_spec.get("response", {})
        request_config = (
            spec.get("config", {})
            .get("request", {})
        )
        error_handling = api_spec.get("error_handling", {})

        cache_payload = self._load_cache(
            spec=spec,
            api_spec=api_spec,
            source_id=source_id,
            parameters=parameters,
        )
        if cache_payload is not None:
            return cache_payload

        try:
            if response_spec.get("format") == "static_dict":
                items = api_spec.get("static_dict", {}).get("items", [])
                mapped = [
                    self._apply_post_process(
                        self._normalize_item(item, source_id, spec["name"], api_spec.get("name", api_visit_key)),
                        api_spec,
                    )
                    for item in items
                ]
            elif response_spec.get("format") == "static_list":
                urls = api_spec.get("static_list", {}).get("urls", [])
                mapped = [
                    self._apply_post_process(
                        self._normalize_item(
                            {"image": url, "title": Path(url).name or api_spec.get("name", api_visit_key)},
                            source_id,
                            spec["name"],
                            api_spec.get("name", api_visit_key),
                        ),
                        api_spec,
                    )
                    for url in urls
                ]
            else:
                response = self._request_response(
                    request_spec=request_spec,
                    request_config=request_config,
                    parameters=parameters,
                    error_handling=error_handling,
                )
                mapped = self._map_response(
                    source_name=spec["name"],
                    source_id=source_id,
                    api_name=api_spec.get("name", api_visit_key),
                    api_spec=api_spec,
                    response_text=response.text,
                    response_bytes=response.content,
                )

            validated = self._validate_items(mapped, api_spec.get("validation", {}))
            if not validated and error_handling.get("on_empty_response") == "skip":
                return []
            self._save_cache(
                spec=spec,
                api_spec=api_spec,
                source_id=source_id,
                parameters=parameters,
                payload=validated,
            )
            return validated
        except Exception:
            fallback = self._resolve_fallback_api(spec, api_spec)
            if fallback is not None:
                return self._execute_api_spec(
                    source_id=source_id,
                    spec=spec,
                    api_spec=fallback,
                    parameters=parameters,
                    visited=visited,
                )
            raise

    def _validate_items(self, items: list[dict[str, Any]], validation: dict[str, Any]) -> list[dict[str, Any]]:
        if not validation:
            return items
        output = []
        for item in items:
            if any(not self._validation_field_value(item, field) for field in validation.get("required_fields", [])):
                continue
            failed = False
            for rule in validation.get("field_patterns", []):
                value = self._validation_field_value(item, rule.get("path"))
                if value is None:
                    continue
                text = str(value)
                regex = rule.get("regex")
                if regex and not re.search(regex, text):
                    failed = True
                    break
                if rule.get("min_length") is not None and len(text) < int(rule["min_length"]):
                    failed = True
                    break
                if rule.get("max_length") is not None and len(text) > int(rule["max_length"]):
                    failed = True
                    break
            if failed:
                continue
            for rule in validation.get("quality_rules", []):
                value = self._validation_field_value(item, rule.get("path"))
                if value is None:
                    continue
                numeric = float(value)
                if rule.get("min") is not None and numeric < float(rule["min"]):
                    failed = True
                    break
                if rule.get("max") is not None and numeric > float(rule["max"]):
                    failed = True
                    break
            if not failed:
                output.append(item)
        return output

    def _validation_field_value(self, item: dict[str, Any], path: Any) -> Any:
        key = _stringify(path)
        if not key:
            return None
        aliases = {
            "image": "image_url",
            "preview": "preview_url",
        }
        if key in item:
            return item.get(key)
        alias = aliases.get(key)
        if alias:
            return item.get(alias)
        metadata = item.get("metadata")
        if isinstance(metadata, dict) and key in metadata:
            return metadata.get(key)
        if "." in key or key.startswith("/"):
            return self._extract_path(item, key)
        return None

    def _cache_file(self, api_spec: dict[str, Any], source_id: str, parameters: dict[str, Any]) -> Path:
        cache_spec = api_spec.get("cache", {})
        if cache_spec.get("key_template"):
            key = self._render_template(cache_spec["key_template"], parameters)
        else:
            serialized = json.dumps({"source_id": source_id, "api": api_spec.get("name"), "params": parameters}, sort_keys=True)
            key = hashlib.sha1(serialized.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{key}.json"

    def _cache_file_for_spec(self, spec: dict[str, Any], api_spec: dict[str, Any], source_id: str, parameters: dict[str, Any]) -> Path:
        cache_spec = self._resolve_cache_spec(spec, api_spec)
        request_variables = (
            spec.get("config", {})
            .get("request", {})
            .get("variables", {})
        )
        if cache_spec.get("key_template"):
            key = self._render_template_with_custom_values(
                cache_spec["key_template"],
                parameters,
                request_variables if isinstance(request_variables, dict) else None,
            )
        else:
            serialized = json.dumps({"source_id": source_id, "api": api_spec.get("name"), "params": parameters}, sort_keys=True)
            key = hashlib.sha1(serialized.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{key}.json"

    def _load_cache(self, spec: dict[str, Any], api_spec: dict[str, Any], source_id: str, parameters: dict[str, Any]) -> list[dict[str, Any]] | None:
        cache_spec = self._resolve_cache_spec(spec, api_spec)
        if not cache_spec.get("enabled"):
            return None
        cache_file = self._cache_file_for_spec(spec, api_spec, source_id, parameters)
        if not cache_file.exists():
            return None
        ttl = int(cache_spec.get("ttl_seconds", 300))
        age_seconds = datetime.utcnow().timestamp() - cache_file.stat().st_mtime
        if age_seconds > ttl:
            return None
        return json.loads(cache_file.read_text(encoding="utf-8"))

    def _save_cache(self, spec: dict[str, Any], api_spec: dict[str, Any], source_id: str, parameters: dict[str, Any], payload: list[dict[str, Any]]) -> None:
        cache_spec = self._resolve_cache_spec(spec, api_spec)
        if not cache_spec.get("enabled"):
            return
        cache_file = self._cache_file_for_spec(spec, api_spec, source_id, parameters)
        cache_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _is_ltws_source_path(self, source: Path) -> bool:
        if source.suffix.lower() == ".ltws":
            return True
        if source.is_dir() and (source / "source.toml").exists():
            return True
        return source.is_file() and source.name.lower() == "source.toml"

    def _load_external_document(self, source: Path) -> dict[str, Any]:
        if not source.exists() or not source.is_file():
            raise FileNotFoundError(f"未找到导入文件: {source}")

        lower_name = source.name.lower()
        if lower_name.endswith((".yaml", ".yml", ".api.yaml", ".api.yml")):
            payload = yaml.safe_load(source.read_text(encoding="utf-8"))
        elif lower_name.endswith((".toml", ".api.toml")):
            payload = rtoml.load(source)
        else:
            payload = json.loads(source.read_text(encoding="utf-8"))

        if not isinstance(payload, dict):
            raise ValueError("导入文件内容必须是对象")
        return payload

    def _is_openapi_document(self, document: dict[str, Any]) -> bool:
        return _stringify(document.get("openapi")).startswith("3.")

    def _create_imported_source_payload(
        self,
        *,
        source_name: str,
        source: Path,
        description: str,
        logo: str,
        import_label: str,
        category_name: str,
        category_id: str,
    ) -> dict[str, Any]:
        identifier = self._build_unique_import_identifier(source_name or source.stem)
        return {
            "source": {
                "identifier": identifier,
                "name": source_name,
                "version": "1.0.0",
                "description": description or f"从 {import_label} 导入的壁纸源",
                "details": (
                    f"# {source_name}\n\n"
                    f"从 {import_label} 自动导入生成，可继续在 LTWS 编辑器中调整。"
                ),
                "logo": logo,
                "footer_text": f"Imported from {source.name}",
                "merge": {
                    "enabled": True,
                    "strategy": "same_id",
                    "priority": 120,
                    "metadata_source": "high_priority",
                    "allow_metadata_override": True,
                },
            },
            "categories": {
                "template": {
                    "icon": logo,
                    "category": "导入协议",
                },
                "categories": [
                    {
                        "id": category_id,
                        "name": category_name,
                        "category": "导入协议",
                        "subcategory": source_name,
                        "subsubcategory": "",
                        "icon": logo,
                        "description": f"{import_label} 自动导入分类",
                    }
                ],
                "category_groups": [
                    {
                        "name": "默认分组",
                        "category_ids": [category_id],
                    }
                ],
                "level_icons": {
                    "category": [],
                    "subcategory": [],
                    "subsubcategory": [],
                },
            },
        }

    def _build_unique_import_identifier(self, source_name: str) -> str:
        base_segment = _sanitize_identifier_segment(
            _slugify_source_path(source_name).replace("-", "_")
        )
        candidate = f"com.littletree.imported.{base_segment}"
        existing = {str(item.get("identifier") or "") for item in self.list_sources()}
        if candidate not in existing:
            return candidate
        suffix = 2
        while f"{candidate}_{suffix}" in existing:
            suffix += 1
        return f"{candidate}_{suffix}"

    def _convert_apicore_template(self, value: Any) -> str:
        text = _stringify(value)
        if not text:
            return ""
        return re.sub(
            r"\{\{\s*parameters\.([a-zA-Z0-9_]+)\s*\}\}",
            r"{{\1}}",
            text,
        )

    def _convert_apicore_parameters(self, raw_parameters: Any) -> list[dict[str, Any]]:
        rows = raw_parameters if isinstance(raw_parameters, list) else []
        converted: list[dict[str, Any]] = []
        for index, item in enumerate(rows):
            if not isinstance(item, dict):
                continue
            key_source = (
                item.get("name")
                or item.get("key")
                or item.get("friendly_name")
                or f"param_{index + 1}"
            )
            key = _slugify_source_path(_stringify(key_source)).replace("-", "_")
            source_type = _stringify(item.get("type") or "string").lower() or "string"
            parameter_type = {
                "enum": "choice",
                "string": "text",
                "integer": "number",
                "number": "number",
                "list": "list",
                "boolean": "boolean",
            }.get(source_type, "text")
            default_value = item.get("value")
            if source_type == "list" and isinstance(default_value, list):
                separator = _stringify(item.get("split_str")) or ","
                default_value = separator.join(str(value) for value in default_value)
            converted.append(
                {
                    "key": key,
                    "label": _stringify(item.get("friendly_name") or key),
                    "type": parameter_type,
                    "default": bool(default_value)
                    if source_type == "boolean"
                    else ("" if default_value is None else default_value),
                    "choices": [str(value) for value in (item.get("friendly_value") or [])],
                    "hidden": False,
                    "description": _stringify(item.get("tooltip")),
                    "placeholder": _stringify(item.get("placeholder")),
                    "min_length": None,
                    "max_length": None,
                }
            )
        return converted

    def _extract_template_variables(self, values: Any) -> set[str]:
        texts: list[str] = []
        if isinstance(values, str):
            texts = [values]
        elif isinstance(values, dict):
            texts = [str(value) for value in values.values()]
        elif isinstance(values, list):
            texts = [str(value) for value in values]

        keys: set[str] = set()
        for text in texts:
            for match in VARIABLE_PATTERN.finditer(text):
                expression = match.group(1).strip()
                if re.fullmatch(r"[a-zA-Z0-9_]+", expression):
                    keys.add(expression)
        return keys

    def _build_imported_request_payload(
        self,
        *,
        method: str,
        request_url: str,
        request_headers: dict[str, str],
        parameters: list[dict[str, Any]],
    ) -> dict[str, Any]:
        method_upper = method.upper() or "GET"
        payload: dict[str, Any] = {
            "url": request_url,
            "method": method_upper,
            "timeout_seconds": 20,
            "interval_seconds": 3600,
            "body": "",
            "body_type": "json",
        }
        available_keys = [
            str(item.get("key") or "") for item in parameters if str(item.get("key") or "")
        ]
        referenced_keys = self._extract_template_variables(request_url)
        referenced_keys.update(self._extract_template_variables(request_headers))
        missing_keys = [key for key in available_keys if key not in referenced_keys]

        if method_upper in {"GET", "HEAD", "DELETE", "OPTIONS"} and missing_keys:
            separator = "&" if "?" in request_url else "?"
            query_template = "&".join(f"{key}={{{{{key}}}}}" for key in missing_keys)
            payload["url"] = (
                f"{request_url}{separator}{query_template}" if query_template else request_url
            )
        elif missing_keys:
            payload["body"] = json.dumps(
                {key: f"{{{{{key}}}}}" for key in missing_keys},
                ensure_ascii=False,
                indent=2,
            )
        return payload

    def _derive_import_interval_seconds(self, rate_limit: Any) -> int:
        if not isinstance(rate_limit, dict):
            return 1800
        frequency = _coerce_int(rate_limit.get("frequency"), 0, 0)
        if frequency <= 0:
            return 1800
        unit_seconds = {
            "sec": 1,
            "min": 60,
            "hour": 3600,
            "day": 86400,
        }.get(_stringify(rate_limit.get("per") or "min"), 60)
        return max(1, unit_seconds // max(1, frequency))

    def _convert_apicore_handlers(self, handlers: Any) -> list[dict[str, Any]]:
        if not isinstance(handlers, dict):
            return []
        converted: list[dict[str, Any]] = []
        for code, rule in handlers.items():
            if code == "default" or not isinstance(rule, dict) or not str(code).isdigit():
                continue
            action = _stringify(rule.get("action"))
            converted.append(
                _strip_empty_sections(
                    {
                        "code": int(code),
                        "message": _stringify(rule.get("message")),
                        "retry_after": _coerce_int(rule.get("delay_ms"), 0, 0) // 1000
                        if action == "retry"
                        else None,
                        "fallback": True if action in {"warning", "error"} else None,
                    }
                )
            )
        return converted

    def _derive_list_mapping_path(self, path: str) -> tuple[str, str]:
        if not path:
            return "/", "/"
        internal_path = _apicore_path_to_internal(path)
        segments = [segment for segment in internal_path.split("/") if segment]
        if len(segments) <= 1:
            return internal_path, "/"
        return "/" + "/".join(segments[:-1]), segments[-1]

    def _trim_list_prefix(self, path: str, items_path: Any, image_path: str, is_list: bool) -> str:
        if not is_list or not isinstance(items_path, str) or not items_path:
            return _apicore_path_to_internal(path)
        internal_path = _apicore_path_to_internal(path)
        internal_items = items_path.lstrip("/")
        if internal_items and internal_path.startswith("/" + internal_items + "/"):
            return internal_path[len("/" + internal_items + "/"):]
        internal_image = _apicore_path_to_internal(image_path).lstrip("/")
        if internal_image and internal_path.startswith("/" + internal_image + "/"):
            return internal_path[len("/" + internal_image + "/"):]
        return internal_path

    def _guess_metadata_field(self, friendly_name: str) -> str | None:
        lowered = friendly_name.strip().lower()
        if any(token in lowered for token in ("title", "name", "标题", "名称")):
            return "title"
        if any(token in lowered for token in ("preview", "thumbnail", "thumb", "预览", "缩略")):
            return "preview"
        if any(token in lowered for token in ("description", "desc", "简介", "描述")):
            return "description"
        if any(token in lowered for token in ("width", "宽")):
            return "width"
        if any(token in lowered for token in ("height", "高")):
            return "height"
        return None

    def _convert_apicore_response(self, response: Any) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, str]]]:
        response_data = response if isinstance(response, dict) else {}
        image = response_data.get("image") if isinstance(response_data.get("image"), dict) else {}
        image_path = _stringify(image.get("path"))
        content_type = _stringify(image.get("content_type") or "URL").upper() or "URL"
        is_list = bool(image.get("is_list"))
        response_payload = {"format": "json", "type": "multi" if is_list else "single"}
        mapping_payload: dict[str, Any] = {"items": "", "item_mapping": []}

        if content_type == "BINARY" and not image_path and not bool(image.get("is_base64")):
            return {"format": "image_raw", "type": "single"}, mapping_payload, []
        if content_type == "URL" and not image_path:
            return {"format": "image_url", "type": "single"}, mapping_payload, []

        mapping_rows: list[dict[str, str]] = []
        if is_list:
            items_path, image_item_path = self._derive_list_mapping_path(image_path)
            mapping_payload["items"] = items_path
            mapping_rows.append({"key": "image", "value": image_item_path})
        else:
            mapping_rows.append({"key": "image", "value": _apicore_path_to_internal(image_path) or "/"})

        for group in response_data.get("others") or []:
            if not isinstance(group, dict):
                continue
            for item in group.get("data") or []:
                if not isinstance(item, dict):
                    continue
                friendly_name = _stringify(item.get("friendly_name"))
                path = _stringify(item.get("path"))
                if not path:
                    continue
                target_key = self._guess_metadata_field(friendly_name)
                normalized_path = self._trim_list_prefix(path, mapping_payload.get("items"), image_path, is_list)
                if target_key and target_key != "image" and all(row["key"] != target_key for row in mapping_rows):
                    mapping_rows.append({"key": target_key, "value": normalized_path})
                else:
                    metadata_key = _slugify_source_path(friendly_name or path).replace("-", "_")
                    if metadata_key != "image":
                        mapping_rows.append({"key": metadata_key, "value": normalized_path})

        mapping_payload["item_mapping"] = mapping_rows
        return response_payload, mapping_payload, []

    def _convert_apicore_to_payload(
        self,
        document: dict[str, Any],
        source: Path,
        version: str,
    ) -> dict[str, Any]:
        source_name = _stringify(document.get("friendly_name")) or source.stem
        category_id = _slugify_category_id(f"apicore_v{version[0]}_import")
        parameters = self._convert_apicore_parameters(document.get("parameters"))
        request_headers = {
            key: self._convert_apicore_template(value)
            for key, value in _normalize_key_value_rows(
                ((document.get("configs") or {}).get("request") or {}).get("headers")
            ).items()
        }
        request_payload = self._build_imported_request_payload(
            method=_stringify(document.get("func") or "GET").upper() or "GET",
            request_url=self._convert_apicore_template(_stringify(document.get("link"))),
            request_headers=request_headers,
            parameters=parameters,
        )
        timeout_ms = ((document.get("configs") or {}).get("request") or {}).get("timeout_ms")
        if timeout_ms not in {None, ""}:
            request_payload["timeout_seconds"] = max(1, int(timeout_ms) // 1000)

        response_payload, mapping_payload, post_process_payload = self._convert_apicore_response(document.get("response"))
        retry_config = ((document.get("configs") or {}).get("retry") or {}) if version == "2.0" else {}
        base_payload = self._create_imported_source_payload(
            source_name=source_name,
            source=source,
            description=_stringify(document.get("intro")),
            logo=_stringify(document.get("icon")),
            import_label=f"APICORE v{version[0]}",
            category_name=f"APICORE v{version[0]} 导入",
            category_id=category_id,
        )
        return {
            **base_payload,
            "config": {
                "request": {
                    "global_interval_seconds": self._derive_import_interval_seconds(
                        (document.get("configs") or {}).get("rate_limit")
                    ),
                    "timeout_seconds": request_payload.get("timeout_seconds", 20),
                    "max_concurrent": 2,
                    "skip_ssl_verify": False,
                    "user_agent": "LittleTreeWallpaperNext/0.1.0",
                    "headers": [],
                    "retry": {
                        "max_attempts": _coerce_int(retry_config.get("count"), 2, 1),
                        "backoff_base": 1.5,
                        "initial_delay_ms": _coerce_int(retry_config.get("delay_ms"), 600, 0),
                    },
                    "cache": {
                        "enabled": True,
                        "default_ttl_seconds": 21600,
                        "max_memory_mb": 32,
                    },
                    "variables": [
                        {"key": "timestamp", "value": "{{timestamp_ms}}"},
                        {"key": "date", "value": "{{date_iso}}"},
                    ],
                }
            },
            "apis": [
                {
                    "name": source_name,
                    "description": _stringify(document.get("intro")),
                    "logo": _stringify(document.get("icon")),
                    "categories": [category_id],
                    "parameters": parameters,
                    "request": {
                        **request_payload,
                        "headers": [{"key": key, "value": value} for key, value in request_headers.items()],
                    },
                    "response": response_payload,
                    "mapping": mapping_payload,
                    "post_process": post_process_payload,
                    "validation": {
                        "required_fields": ["image"],
                        "field_patterns": [],
                        "quality_rules": [],
                    },
                    "error_handling": {
                        "http_codes": self._convert_apicore_handlers(document.get("handlers")),
                        "on_empty_response": "skip",
                        "on_mapping_failed": "skip_item",
                        "fallback_to": "",
                    },
                    "cache": {
                        "enabled": True,
                        "ttl_seconds": 21600,
                        "key_template": "",
                    },
                    "static_list_urls": [],
                    "static_dict_items": [],
                }
            ],
        }

    def _resolve_openapi_server_url(self, document: dict[str, Any]) -> str:
        servers = document.get("servers") or []
        for server in servers:
            if isinstance(server, dict) and _stringify(server.get("url")):
                return _stringify(server.get("url"))
        return ""

    def _resolve_openapi_schema(self, document: dict[str, Any], schema: Any) -> Any:
        current = schema
        for _ in range(6):
            if not isinstance(current, dict):
                return current
            ref = _stringify(current.get("$ref"))
            if not ref.startswith("#/"):
                return current
            target: Any = document
            for segment in ref[2:].split("/"):
                if not isinstance(target, dict):
                    return current
                target = target.get(segment)
            current = target
        return current

    def _convert_openapi_schema_to_parameter(
        self,
        schema: Any,
        wire_name: str,
        description: Any,
        example: Any,
    ) -> dict[str, Any]:
        resolved = schema if isinstance(schema, dict) else {}
        schema_type = _stringify(resolved.get("type") or "string").lower() or "string"
        enum_values = resolved.get("enum") if isinstance(resolved.get("enum"), list) else []
        parameter_type = "choice" if enum_values else {
            "boolean": "boolean",
            "integer": "number",
            "number": "number",
            "array": "list",
        }.get(schema_type, "text")
        default_value = resolved.get("default", example)
        if schema_type == "array" and isinstance(default_value, list):
            default_value = ",".join(str(item) for item in default_value)
        return {
            "key": _slugify_source_path(wire_name).replace("-", "_"),
            "label": _stringify(resolved.get("title") or wire_name),
            "type": parameter_type,
            "default": bool(default_value)
            if schema_type == "boolean"
            else ("" if default_value is None else default_value),
            "choices": [str(item) for item in enum_values],
            "hidden": False,
            "description": _stringify(description or resolved.get("description")),
            "placeholder": "",
            "min_length": None,
            "max_length": None,
        }

    def _collect_openapi_parameters(self, document: dict[str, Any], *parameter_groups: Any) -> list[dict[str, Any]]:
        collected: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for group in parameter_groups:
            rows = group if isinstance(group, list) else []
            for item in rows:
                parameter = self._resolve_openapi_schema(document, item)
                if not isinstance(parameter, dict):
                    continue
                wire_name = _stringify(parameter.get("name"))
                location = _stringify(parameter.get("in") or "query")
                if not wire_name:
                    continue
                unique_key = (location, wire_name)
                if unique_key in seen:
                    continue
                seen.add(unique_key)
                schema = self._resolve_openapi_schema(document, parameter.get("schema") or {})
                collected.append(
                    {
                        **self._convert_openapi_schema_to_parameter(
                            schema,
                            wire_name,
                            parameter.get("description"),
                            parameter.get("example"),
                        ),
                        "_location": location,
                        "_wire_name": wire_name,
                    }
                )
        return collected

    def _convert_openapi_body_schema(self, schema: Any) -> tuple[list[dict[str, Any]], str]:
        resolved = schema if isinstance(schema, dict) else {}
        properties = resolved.get("properties") or {}
        if not isinstance(properties, dict):
            return [], ""
        parameters: list[dict[str, Any]] = []
        body_template: dict[str, Any] = {}
        for property_name, property_schema in properties.items():
            converted = self._convert_openapi_schema_to_parameter(
                property_schema,
                property_name,
                (property_schema or {}).get("description") if isinstance(property_schema, dict) else None,
                (property_schema or {}).get("example") if isinstance(property_schema, dict) else None,
            )
            parameters.append(converted)
            body_template[property_name] = f"{{{{{converted['key']}}}}}"
        return parameters, json.dumps(body_template, ensure_ascii=False, indent=2)

    def _convert_openapi_request_body(self, document: dict[str, Any], request_body: Any) -> tuple[list[dict[str, Any]], str, str]:
        payload = self._resolve_openapi_schema(document, request_body)
        if not isinstance(payload, dict):
            return [], "", "json"
        content = payload.get("content") or {}
        if not isinstance(content, dict):
            return [], "", "json"
        for content_type, media in content.items():
            if not isinstance(media, dict):
                continue
            schema = self._resolve_openapi_schema(document, media.get("schema") or {})
            parameters, template = self._convert_openapi_body_schema(schema)
            if parameters:
                return parameters, template, "json" if "json" in content_type else "form"
        return [], "", "json"

    def _combine_openapi_url(self, server_url: str, path_name: str) -> str:
        if server_url:
            return server_url.rstrip("/") + "/" + path_name.lstrip("/")
        return path_name

    def _build_openapi_item_mapping(self, document: dict[str, Any], schema: Any, prefix: str) -> list[dict[str, str]]:
        resolved = self._resolve_openapi_schema(document, schema)
        properties = resolved.get("properties") or {}
        if not isinstance(properties, dict):
            if _stringify(resolved.get("type")) == "string":
                return [{"key": "image", "value": "/"}]
            return []

        candidates = {
            "image": ("image", "image_url", "url", "src", "download_url", "large_image_url"),
            "title": ("title", "name", "label"),
            "preview": ("preview", "preview_url", "thumbnail", "thumb", "small_url"),
            "description": ("description", "desc", "caption", "alt"),
            "width": ("width",),
            "height": ("height",),
        }
        rows: list[dict[str, str]] = []
        for target_key, aliases in candidates.items():
            for property_name in properties.keys():
                if str(property_name).lower() not in aliases:
                    continue
                rows.append({"key": target_key, "value": prefix + property_name if prefix else property_name})
                break
        return rows

    def _build_openapi_json_response_mapping(self, document: dict[str, Any], schema: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        resolved = self._resolve_openapi_schema(document, schema)
        if not isinstance(resolved, dict):
            return {"format": "json", "type": "single"}, {"items": "", "item_mapping": [{"key": "image", "value": "/url"}]}

        if _stringify(resolved.get("type")) == "array":
            item_schema = self._resolve_openapi_schema(document, resolved.get("items") or {})
            return {
                "format": "json",
                "type": "multi",
            }, {
                "items": "",
                "item_mapping": self._build_openapi_item_mapping(document, item_schema, ""),
            }

        properties = resolved.get("properties") or {}
        if isinstance(properties, dict):
            direct_mapping = self._build_openapi_item_mapping(document, resolved, "")
            if any(row["key"] == "image" for row in direct_mapping):
                return {"format": "json", "type": "single"}, {"items": "", "item_mapping": direct_mapping}
            for property_name, property_schema in properties.items():
                nested_schema = self._resolve_openapi_schema(document, property_schema)
                if not isinstance(nested_schema, dict):
                    continue
                if _stringify(nested_schema.get("type")) == "array":
                    item_schema = self._resolve_openapi_schema(document, nested_schema.get("items") or {})
                    nested_mapping = self._build_openapi_item_mapping(document, item_schema, "")
                    if any(row["key"] == "image" for row in nested_mapping):
                        return {"format": "json", "type": "multi"}, {"items": "/" + property_name, "item_mapping": nested_mapping}
                nested_mapping = self._build_openapi_item_mapping(document, nested_schema, property_name + ".")
                if any(row["key"] == "image" for row in nested_mapping):
                    return {"format": "json", "type": "single"}, {"items": "", "item_mapping": nested_mapping}

        return {"format": "json", "type": "single"}, {"items": "", "item_mapping": [{"key": "image", "value": "/url"}]}

    def _convert_openapi_response(self, document: dict[str, Any], response: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]] | tuple[None, None]:
        content = response.get("content") or {}
        if not isinstance(content, dict):
            return None, None
        for content_type, media in content.items():
            if not isinstance(media, dict):
                continue
            schema = self._resolve_openapi_schema(document, media.get("schema") or {})
            if content_type.startswith("image/"):
                return {"format": "image_raw", "type": "single"}, {"items": "", "item_mapping": []}
            if "json" in content_type or content_type.endswith("+json"):
                return self._build_openapi_json_response_mapping(document, schema)
            if content_type.startswith("text/"):
                return {"format": "image_url", "type": "single"}, {"items": "", "item_mapping": []}
        return None, None

    def _select_openapi_response(self, operation: dict[str, Any]) -> dict[str, Any] | None:
        responses = operation.get("responses") or {}
        if not isinstance(responses, dict):
            return None
        for key in sorted(responses.keys()):
            if str(key).isdigit() and str(key).startswith("2") and isinstance(responses[key], dict):
                return responses[key]
        default_response = responses.get("default")
        return default_response if isinstance(default_response, dict) else None

    def _convert_openapi_operation(
        self,
        *,
        document: dict[str, Any],
        server_url: str,
        path_name: str,
        method: str,
        operation: dict[str, Any],
        common_parameters: Any,
        fallback_category_id: str,
    ) -> dict[str, Any] | None:
        response = self._select_openapi_response(operation)
        if response is None:
            return None
        response_payload, mapping_payload = self._convert_openapi_response(document, response)
        if response_payload is None:
            return None

        request_url = self._combine_openapi_url(server_url, path_name)
        parameters = self._collect_openapi_parameters(document, common_parameters, operation.get("parameters"))
        request_headers: list[dict[str, str]] = []
        query_parameters: list[tuple[str, str]] = []
        for parameter in parameters:
            key = str(parameter.get("key") or "")
            location = str(parameter.pop("_location", "query"))
            wire_name = str(parameter.pop("_wire_name", key))
            if location == "path":
                request_url = request_url.replace("{" + wire_name + "}", f"{{{{{key}}}}}")
            elif location == "header":
                request_headers.append({"key": wire_name, "value": f"{{{{{key}}}}}"})
            else:
                query_parameters.append((wire_name, key))

        if query_parameters:
            separator = "&" if "?" in request_url else "?"
            request_url = request_url + separator + "&".join(
                f"{name}={{{{{key}}}}}" for name, key in query_parameters
            )

        body_parameters, body_template, body_type = self._convert_openapi_request_body(document, operation.get("requestBody"))
        parameters.extend(body_parameters)
        api_name = _stringify(
            operation.get("summary") or operation.get("operationId") or f"{method.upper()} {path_name}"
        )
        tags = [str(item).strip() for item in (operation.get("tags") or []) if str(item).strip()]
        api_categories = [_slugify_category_id(tag) for tag in tags] or [fallback_category_id]
        return {
            "name": api_name,
            "description": _stringify(operation.get("description")),
            "logo": "",
            "categories": api_categories,
            "parameters": parameters,
            "request": {
                "url": request_url,
                "method": method.upper(),
                "timeout_seconds": 20,
                "interval_seconds": 3600,
                "headers": request_headers,
                "body": body_template,
                "body_type": body_type,
            },
            "response": response_payload,
            "mapping": mapping_payload,
            "post_process": [],
            "validation": {
                "required_fields": ["image"],
                "field_patterns": [],
                "quality_rules": [],
            },
            "error_handling": {
                "http_codes": [],
                "on_empty_response": "skip",
                "on_mapping_failed": "skip_item",
                "fallback_to": "",
            },
            "cache": {
                "enabled": True,
                "ttl_seconds": 21600,
                "key_template": "",
            },
            "static_list_urls": [],
            "static_dict_items": [],
        }

    def _convert_openapi_to_payload(self, document: dict[str, Any], source: Path) -> dict[str, Any]:
        info = document.get("info") or {}
        source_name = _stringify(info.get("title")) or source.stem
        category_id = _slugify_category_id("openapi_import")
        base_payload = self._create_imported_source_payload(
            source_name=source_name,
            source=source,
            description=_stringify(info.get("description")),
            logo="",
            import_label="OpenAPI 3",
            category_name="OpenAPI 导入",
            category_id=category_id,
        )
        server_url = self._resolve_openapi_server_url(document)
        apis: list[dict[str, Any]] = []
        tag_categories: dict[str, str] = {}
        for path_name, path_item in (document.get("paths") or {}).items():
            if not isinstance(path_item, dict):
                continue
            common_parameters = path_item.get("parameters") or []
            for method in OPENAPI_METHODS:
                operation = path_item.get(method)
                if not isinstance(operation, dict):
                    continue
                for tag in [str(item).strip() for item in (operation.get("tags") or []) if str(item).strip()]:
                    tag_categories[_slugify_category_id(tag)] = tag
                api_payload = self._convert_openapi_operation(
                    document=document,
                    server_url=server_url,
                    path_name=path_name,
                    method=method,
                    operation=operation,
                    common_parameters=common_parameters,
                    fallback_category_id=category_id,
                )
                if api_payload is not None:
                    apis.append(api_payload)

        if not apis:
            raise ValueError("OpenAPI 文件中未找到可导入的操作")

        if tag_categories:
            existing_categories = base_payload["categories"]["categories"]
            existing_groups = base_payload["categories"]["category_groups"]
            for tag_id, tag_name in tag_categories.items():
                if any(category["id"] == tag_id for category in existing_categories):
                    continue
                existing_categories.append(
                    {
                        "id": tag_id,
                        "name": tag_name,
                        "category": "导入协议",
                        "subcategory": source_name,
                        "subsubcategory": "",
                        "icon": "",
                        "description": f"OpenAPI 标签：{tag_name}",
                    }
                )
            if existing_groups:
                existing_groups[0]["category_ids"] = [category["id"] for category in existing_categories]

        return {
            **base_payload,
            "config": {
                "request": {
                    "global_interval_seconds": 1800,
                    "timeout_seconds": 20,
                    "max_concurrent": 2,
                    "skip_ssl_verify": False,
                    "user_agent": "LittleTreeWallpaperNext/0.1.0",
                    "headers": [],
                    "retry": {
                        "max_attempts": 2,
                        "backoff_base": 1.5,
                        "initial_delay_ms": 600,
                    },
                    "cache": {
                        "enabled": True,
                        "default_ttl_seconds": 21600,
                        "max_memory_mb": 32,
                    },
                    "variables": [
                        {"key": "timestamp", "value": "{{timestamp_ms}}"},
                        {"key": "date", "value": "{{date_iso}}"},
                    ],
                }
            },
            "apis": apis,
        }

    def _write_external_document(
        self,
        document: dict[str, Any],
        target: Path,
        default_suffix: str,
    ) -> Path:
        suffix = target.suffix.lower()
        if not suffix:
            target = target.with_suffix(default_suffix)
            suffix = default_suffix
        target.parent.mkdir(parents=True, exist_ok=True)
        if suffix in {".yaml", ".yml"}:
            target.write_text(
                yaml.safe_dump(document, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
        elif suffix == ".toml":
            target.write_text(rtoml.dumps(document), encoding="utf-8")
        else:
            target.write_text(
                json.dumps(document, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return target

    def _select_export_api(self, payload: dict[str, Any], export_format: str) -> dict[str, Any]:
        apis = payload.get("apis") if isinstance(payload.get("apis"), list) else []
        if not apis:
            raise ValueError("导出前至少需要一个 API 配置")
        if export_format.startswith("apicore") and len(apis) != 1:
            raise ValueError("APICORE 导出要求草稿中只能保留一个 API")
        api = apis[0]
        if not isinstance(api, dict):
            raise ValueError("导出前至少需要一个有效的 API 配置")
        return api

    def _mapping_lookup(self, mapping_payload: dict[str, Any], key: str) -> str:
        return _stringify(_normalize_key_value_rows(mapping_payload.get("item_mapping")).get(key))

    def _join_mapping_path(self, prefix: Any, path: Any) -> str:
        normalized_prefix = _stringify(prefix)
        normalized_path = _stringify(path)
        if normalized_prefix in {"", "/"}:
            return _internal_path_to_apicore(normalized_path)
        prefix_apicore = _internal_path_to_apicore(normalized_prefix)
        path_apicore = _internal_path_to_apicore(normalized_path)
        if not path_apicore or path_apicore == "/":
            return prefix_apicore or "/"
        return f"{prefix_apicore}.{path_apicore}" if prefix_apicore and prefix_apicore != "/" else path_apicore

    def _convert_payload_parameter_to_apicore(
        self,
        parameter: dict[str, Any],
    ) -> dict[str, Any]:
        parameter_type = _stringify(parameter.get("type") or "text")
        exported_type = {
            "text": "string",
            "choice": "enum",
            "boolean": "boolean",
            "number": "number",
            "list": "list",
        }.get(parameter_type, "string")
        default_value = parameter.get("default")
        exported = {
            "name": _stringify(parameter.get("key")),
            "friendly_name": _stringify(parameter.get("label") or parameter.get("key")),
            "type": exported_type,
            "value": default_value if default_value not in {None, ""} else None,
            "friendly_value": parameter.get("choices") or [],
            "tooltip": _stringify(parameter.get("description")),
            "placeholder": _stringify(parameter.get("placeholder")),
            "split_str": "," if exported_type == "list" else None,
        }
        return _strip_empty_sections(exported)

    def _convert_payload_to_apicore_response(self, api_payload: dict[str, Any]) -> dict[str, Any]:
        response_payload = api_payload.get("response") or {}
        mapping_payload = api_payload.get("mapping") or {}
        response_format = _stringify(response_payload.get("format") or "json")
        response_type = _stringify(response_payload.get("type") or "single")
        if response_format in {"static_list", "static_dict"}:
            raise ValueError("APICORE 导出暂不支持 static_list 或 static_dict 响应")

        content_type = "URL"
        image_path = ""
        is_list = response_type == "multi"
        if response_format == "image_raw":
            content_type = "BINARY"
            is_list = False
        elif response_format == "image_url":
            content_type = "URL"
            is_list = False
        else:
            items_path = mapping_payload.get("items") if is_list else ""
            image_mapping = self._mapping_lookup(mapping_payload, "image")
            if not image_mapping:
                raise ValueError("APICORE 导出需要 image 映射字段")
            image_path = self._join_mapping_path(items_path, image_mapping)

        metadata_rows: list[dict[str, Any]] = []
        for key, path in _normalize_key_value_rows(mapping_payload.get("item_mapping")).items():
            if key == "image":
                continue
            metadata_rows.append(
                {
                    "friendly_name": key,
                    "path": self._join_mapping_path(mapping_payload.get("items") if is_list else "", path),
                }
            )

        return _strip_empty_sections(
            {
                "image": {
                    "content_type": content_type,
                    "path": image_path,
                    "is_list": is_list,
                    "is_base64": False,
                },
                "others": [
                    {
                        "friendly_name": "metadata",
                        "data": metadata_rows,
                    }
                ]
                if metadata_rows
                else [],
            }
        )

    def _interval_seconds_to_rate_limit(self, interval_seconds: Any) -> dict[str, Any] | None:
        seconds = _coerce_int(interval_seconds, 0, 0)
        if seconds <= 0:
            return None
        for unit_name, unit_seconds in (("sec", 1), ("min", 60), ("hour", 3600), ("day", 86400)):
            if unit_seconds >= seconds and unit_seconds % seconds == 0:
                return {
                    "frequency": max(1, unit_seconds // seconds),
                    "per": unit_name,
                }
        return {
            "frequency": 1,
            "per": "day",
        }

    def _convert_payload_to_apicore_handlers(self, api_payload: dict[str, Any]) -> dict[str, Any]:
        handlers: dict[str, Any] = {}
        error_handling = api_payload.get("error_handling") or {}
        for row in error_handling.get("http_codes") or []:
            if not isinstance(row, dict):
                continue
            code = _coerce_int(row.get("code"), 0, 0)
            if code <= 0:
                continue
            retry_after = _coerce_int(row.get("retry_after"), 0, 0)
            action = "retry" if retry_after > 0 else ("warning" if row.get("fallback") else "error")
            handlers[str(code)] = _strip_empty_sections(
                {
                    "action": action,
                    "message": _stringify(row.get("message")),
                    "delay_ms": retry_after * 1000 if retry_after > 0 else None,
                }
            )
        return handlers

    def _convert_payload_to_apicore(
        self,
        payload: dict[str, Any],
        version: str,
    ) -> dict[str, Any]:
        source_payload = payload.get("source") or {}
        config_payload = ((payload.get("config") or {}).get("request") or {})
        api_payload = self._select_export_api(payload, f"apicore_v{version[0]}")
        request_payload = api_payload.get("request") or {}
        parameters = api_payload.get("parameters") or []
        if _stringify(api_payload.get("response", {}).get("format")) in {"static_list", "static_dict"}:
            raise ValueError("APICORE 导出暂不支持 static_list 或 static_dict 响应")

        document: dict[str, Any] = {
            "friendly_name": _stringify(source_payload.get("name") or api_payload.get("name")),
            "intro": _stringify(source_payload.get("description") or source_payload.get("details") or api_payload.get("description")),
            "icon": _stringify(source_payload.get("logo") or api_payload.get("logo")),
            "link": _stringify(request_payload.get("url")),
            "func": _stringify(request_payload.get("method") or "GET").upper() or "GET",
            "APICORE_version": version,
            "parameters": [
                self._convert_payload_parameter_to_apicore(parameter)
                for parameter in parameters
                if isinstance(parameter, dict) and _stringify(parameter.get("key"))
            ],
            "response": self._convert_payload_to_apicore_response(api_payload),
        }

        if version == "2.0":
            headers = {
                **_normalize_key_value_rows(config_payload.get("headers")),
                **_normalize_key_value_rows(request_payload.get("headers")),
            }
            retry_payload = config_payload.get("retry") or {}
            api_interval = request_payload.get("interval_seconds") or config_payload.get("global_interval_seconds")
            document["configs"] = _strip_empty_sections(
                {
                    "request": {
                        "headers": headers,
                        "timeout_ms": _coerce_int(request_payload.get("timeout_seconds") or config_payload.get("timeout_seconds"), 20, 1) * 1000,
                    },
                    "retry": {
                        "count": _coerce_int(retry_payload.get("max_attempts"), 1, 1),
                        "delay_ms": _coerce_int(retry_payload.get("initial_delay_ms"), 0, 0),
                    },
                    "rate_limit": self._interval_seconds_to_rate_limit(api_interval),
                }
            )
            handlers = self._convert_payload_to_apicore_handlers(api_payload)
            if handlers:
                document["handlers"] = handlers

        return _strip_empty_sections(document)

    def _convert_creator_parameter_to_openapi_schema(self, parameter: dict[str, Any]) -> dict[str, Any]:
        parameter_type = _stringify(parameter.get("type") or "text")
        schema: dict[str, Any]
        if parameter_type == "boolean":
            schema = {"type": "boolean"}
        elif parameter_type == "number":
            schema = {"type": "number"}
        elif parameter_type == "list":
            schema = {"type": "array", "items": {"type": "string"}}
        else:
            schema = {"type": "string"}
        choices = [str(item) for item in (parameter.get("choices") or []) if str(item).strip()]
        if choices:
            schema["enum"] = choices
        default_value = parameter.get("default")
        if default_value not in {None, ""}:
            schema["default"] = default_value
        min_length = parameter.get("min_length")
        if min_length not in {None, ""}:
            schema["minLength"] = _coerce_int(min_length, 0, 0)
        max_length = parameter.get("max_length")
        if max_length not in {None, ""}:
            schema["maxLength"] = _coerce_int(max_length, 0, 0)
        description = _stringify(parameter.get("description"))
        if description:
            schema["description"] = description
        return schema

    def _infer_openapi_response_property(self, key: str) -> dict[str, Any]:
        if key in {"width", "height"}:
            return {"type": "number"}
        return {"type": "string"}

    def _build_openapi_response_content(self, api_payload: dict[str, Any]) -> dict[str, Any]:
        response_payload = api_payload.get("response") or {}
        mapping_payload = api_payload.get("mapping") or {}
        response_format = _stringify(response_payload.get("format") or "json")
        response_type = _stringify(response_payload.get("type") or "single")
        if response_format == "image_raw":
            return {
                "image/*": {
                    "schema": {"type": "string", "format": "binary"},
                }
            }
        if response_format == "image_url":
            return {
                "text/plain": {
                    "schema": {"type": "string"},
                }
            }
        if response_format in {"static_list", "static_dict"}:
            raise ValueError("OpenAPI 导出暂不支持 static_list 或 static_dict 响应")

        properties: dict[str, Any] = {}
        for key, _ in _normalize_key_value_rows(mapping_payload.get("item_mapping")).items():
            properties[key] = self._infer_openapi_response_property(key)
        if not properties:
            properties["image"] = {"type": "string"}
        object_schema = {
            "type": "object",
            "properties": properties,
        }
        content_type = "application/toml" if response_format == "toml" else "application/json"
        return {
            content_type: {
                "schema": object_schema if response_type == "single" else {"type": "array", "items": object_schema},
            }
        }

    def _split_openapi_export_url(
        self,
        request_url: str,
        fallback_name: str,
    ) -> tuple[str, str, str]:
        normalized = _stringify(request_url)
        if not normalized:
            raise ValueError(f"API {fallback_name} 的请求地址不能为空")
        parsed = urlsplit(normalized)
        if parsed.scheme and parsed.netloc:
            server_url = f"{parsed.scheme}://{parsed.netloc}"
            path = parsed.path or "/"
            return server_url, path, parsed.query
        if "?" in normalized:
            path, query = normalized.split("?", 1)
            return "", path or "/", query
        return "", normalized or "/", ""

    def _normalize_openapi_export_options(self, export_options: dict[str, Any] | None) -> tuple[list[str], dict[str, list[str]]]:
        payload = export_options if isinstance(export_options, dict) else {}
        openapi_payload = payload.get("openapi") if isinstance(payload.get("openapi"), dict) else payload
        servers = [
            str(item).strip()
            for item in (openapi_payload.get("servers") or [])
            if str(item).strip()
        ]
        tag_overrides: dict[str, list[str]] = {}
        raw_tag_overrides = openapi_payload.get("tags_by_api")
        if isinstance(raw_tag_overrides, dict):
            for api_name, raw_tags in raw_tag_overrides.items():
                normalized_name = _stringify(api_name)
                if not normalized_name:
                    continue
                tag_overrides[normalized_name] = _normalize_string_list(raw_tags)
        return servers, tag_overrides

    def _convert_payload_to_openapi(self, payload: dict[str, Any], export_options: dict[str, Any] | None = None) -> dict[str, Any]:
        source_payload = payload.get("source") or {}
        categories_payload = ((payload.get("categories") or {}).get("categories") or [])
        category_name_map = {
            str(item.get("id") or ""): str(item.get("name") or str(item.get("id") or ""))
            for item in categories_payload
            if isinstance(item, dict) and str(item.get("id") or "")
        }
        global_servers, tag_overrides = self._normalize_openapi_export_options(export_options)
        paths: dict[str, Any] = {}
        for api_payload in payload.get("apis") or []:
            if not isinstance(api_payload, dict):
                continue
            api_name = _stringify(api_payload.get("name") or "API")
            request_payload = api_payload.get("request") or {}
            server_url, raw_path, raw_query = self._split_openapi_export_url(
                _stringify(request_payload.get("url")),
                api_name,
            )
            path_template = re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", r"{\1}", raw_path or "/")
            method = _stringify(request_payload.get("method") or "GET").lower() or "get"
            if method not in OPENAPI_METHODS:
                raise ValueError(f"OpenAPI 导出暂不支持 {method.upper()} 请求方法")
            if path_template not in paths:
                paths[path_template] = {}
            if method in paths[path_template]:
                raise ValueError(f"OpenAPI 导出中存在重复的操作: {method.upper()} {path_template}")

            header_templates = _normalize_key_value_rows(request_payload.get("headers"))
            body_template = _stringify(request_payload.get("body"))
            query_bindings: dict[str, str] = {}
            for item in [part for part in raw_query.split("&") if part.strip()]:
                key, _, value = item.partition("=")
                match = re.fullmatch(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", value.strip())
                if key and match:
                    query_bindings[match.group(1)] = key

            parameters_payload = api_payload.get("parameters") or []
            parameters: list[dict[str, Any]] = []
            body_properties: dict[str, Any] = {}
            required_body_fields: list[str] = []
            for parameter in parameters_payload:
                if not isinstance(parameter, dict):
                    continue
                key = _stringify(parameter.get("key"))
                if not key:
                    continue
                token_pattern = re.compile(r"\{\{\s*" + re.escape(key) + r"\s*\}\}")
                schema = self._convert_creator_parameter_to_openapi_schema(parameter)
                description = _stringify(parameter.get("description"))
                name = key
                location = "query"
                if token_pattern.search(raw_path):
                    location = "path"
                else:
                    header_name = next((header for header, value in header_templates.items() if token_pattern.search(value)), "")
                    if header_name:
                        location = "header"
                        name = header_name
                    elif key in query_bindings:
                        location = "query"
                        name = query_bindings[key]
                    elif token_pattern.search(body_template):
                        location = "body"
                    elif method not in {"get", "head", "delete", "options"} and body_template:
                        location = "body"

                if location == "body":
                    body_properties[key] = schema
                    required_body_fields.append(key)
                    continue
                parameters.append(
                    _strip_empty_sections(
                        {
                            "name": name,
                            "in": location,
                            "required": True if location == "path" else False,
                            "description": description,
                            "schema": schema,
                        }
                    )
                )

            operation: dict[str, Any] = {
                "summary": api_name,
                "description": _stringify(api_payload.get("description")),
                "operationId": _slugify_source_path(api_name).replace("-", "_"),
                "tags": tag_overrides.get(api_name) or [
                    category_name_map.get(category_id, category_id)
                    for category_id in _normalize_string_list(api_payload.get("categories"))
                ],
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": self._build_openapi_response_content(api_payload),
                    }
                },
                "x-ltws-mapping": api_payload.get("mapping") or {},
                "x-ltws-post-process": api_payload.get("post_process") or [],
                "x-ltws-validation": api_payload.get("validation") or {},
                "x-ltws-error-handling": api_payload.get("error_handling") or {},
                "x-ltws-cache": api_payload.get("cache") or {},
            }
            if global_servers:
                pass
            elif server_url:
                operation["servers"] = [{"url": server_url}]
            if parameters:
                operation["parameters"] = parameters
            if body_properties:
                operation["requestBody"] = {
                    "required": True,
                    "content": {
                        "application/json" if _stringify(request_payload.get("body_type") or "json") == "json" else "application/x-www-form-urlencoded": {
                            "schema": {
                                "type": "object",
                                "properties": body_properties,
                                "required": required_body_fields,
                            },
                            "example": json.loads(body_template)
                            if body_template.strip().startswith("{") and body_template.strip().endswith("}")
                            else None,
                        }
                    },
                }
                media_type = next(iter(operation["requestBody"]["content"].values()))
                if media_type.get("example") is None:
                    media_type.pop("example", None)

            paths[path_template][method] = _strip_empty_sections(operation)

        if not paths:
            raise ValueError("导出前至少需要一个 API 配置")

        description_lines = [
            _stringify(source_payload.get("description")),
            _stringify(source_payload.get("details")),
        ]
        return _strip_empty_sections(
            {
                "openapi": "3.2.0",
                "info": {
                    "title": _stringify(source_payload.get("name") or "Wallpaper Source API"),
                    "version": _stringify(source_payload.get("version") or "1.0.0"),
                    "description": "\n\n".join([line for line in description_lines if line]),
                },
                "servers": [{"url": server} for server in global_servers],
                "paths": paths,
                "x-ltws-source": {
                    "identifier": _stringify(source_payload.get("identifier")),
                    "logo": _stringify(source_payload.get("logo")),
                    "footer_text": _stringify(source_payload.get("footer_text")),
                },
            }
        )
