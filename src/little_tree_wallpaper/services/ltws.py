from __future__ import annotations

import hashlib
import json
import re
import shutil
import tarfile
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
import rtoml

from little_tree_wallpaper.display import get_primary_display_resolution
from little_tree_wallpaper.models import WallpaperItem


IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9_]+(?:\.[a-z0-9_]+)+$")
VARIABLE_PATTERN = re.compile(r"\{\{([^{}]+)\}\}")


class LTWSService:
    def __init__(self, sources_dir: Path, cache_dir: Path, builtin_examples_dir: Path):
        self.sources_dir = sources_dir
        self.cache_dir = cache_dir / "ltws"
        self.builtin_examples_dir = builtin_examples_dir
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def list_sources(self) -> list[dict[str, Any]]:
        source_paths = []
        example_root = self.builtin_examples_dir / "ltws"
        if example_root.exists():
            source_paths.extend(path for path in example_root.iterdir() if path.is_dir())
        source_paths.extend(path for path in self.sources_dir.iterdir() if path.is_dir())

        results = []
        for source_path in source_paths:
            try:
                results.append(self._load_source(source_path))
            except Exception as exc:
                results.append(
                    {
                        "identifier": source_path.name,
                        "name": source_path.name,
                        "invalid": True,
                        "error": str(exc),
                    }
                )
        return results

    def import_source(self, import_path: str) -> dict[str, Any]:
        source = Path(import_path)
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

    def execute_api(self, source_id: str, api_name: str, parameters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        parameters = parameters or {}
        source_path = self._find_source_path(source_id)
        spec = self._load_source(source_path)
        api_spec = next(api for api in spec["apis"] if api["name"] == api_name)
        request_spec = api_spec.get("request", {})
        response_spec = api_spec.get("response", {})

        cache_payload = self._load_cache(api_spec=api_spec, source_id=source_id, parameters=parameters)
        if cache_payload is not None:
            return cache_payload

        if response_spec.get("format") == "static_dict":
            items = api_spec.get("static_dict", {}).get("items", [])
            mapped = [self._normalize_item(item, source_id, spec["name"], api_name) for item in items]
        elif response_spec.get("format") == "static_list":
            urls = api_spec.get("static_list", {}).get("urls", [])
            mapped = [
                self._normalize_item({"image": url, "title": Path(url).name or api_name}, source_id, spec["name"], api_name)
                for url in urls
            ]
        else:
            url = self._render_template(request_spec.get("url", ""), parameters)
            response = requests.request(
                method=request_spec.get("method", "GET"),
                url=url,
                headers=request_spec.get("headers", {}),
                timeout=request_spec.get("timeout_seconds", spec.get("config", {}).get("request", {}).get("timeout_seconds", 20)),
            )
            response.raise_for_status()
            mapped = self._map_response(
                source_name=spec["name"],
                source_id=source_id,
                api_name=api_name,
                api_spec=api_spec,
                response_text=response.text,
                response_bytes=response.content,
            )

        validated = self._validate_items(mapped, api_spec.get("validation", {}))
        self._save_cache(api_spec=api_spec, source_id=source_id, parameters=parameters, payload=validated)
        return validated

    def _find_source_path(self, source_id: str) -> Path:
        for path in [self.builtin_examples_dir / "ltws", self.sources_dir]:
            if not path.exists():
                continue
            for child in path.iterdir():
                source_toml = child / "source.toml"
                if source_toml.exists():
                    try:
                        source_spec = rtoml.load(source_toml)
                        if source_spec.get("identifier") == source_id:
                            return child
                    except Exception:
                        continue
        raise FileNotFoundError(f"未找到壁纸源: {source_id}")

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
            api_specs.extend(rtoml.load(api_path) for api_path in sorted(source_dir.glob(pattern)))

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
            return [self._normalize_item({"image": response_text.strip(), "title": api_name}, source_id, source_name, api_name)]
        if format_name == "image_raw":
            cache_name = hashlib.sha1(response_bytes).hexdigest() + ".jpg"
            image_path = self.cache_dir / cache_name
            image_path.write_bytes(response_bytes)
            return [self._normalize_item({"image": str(image_path), "title": api_name}, source_id, source_name, api_name)]

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
        for raw_item in raw_items:
            mapped_item = self._map_item(mapping_spec.get("item_mapping", {}), raw_item)
            results.append(self._apply_post_process(self._normalize_item(mapped_item, source_id, source_name, api_name), api_spec))
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
                return self._extract_pointer(payload[0], rest) if payload else None
            if isinstance(payload, dict):
                for value in payload.values():
                    found = self._extract_pointer(value, rest)
                    if found not in {None, "", []}:
                        return found
            return None

        if isinstance(payload, list):
            if segment.isdigit() and int(segment) < len(payload):
                return self._extract_pointer(payload[int(segment)], rest)
            return None
        if isinstance(payload, dict):
            return self._extract_pointer(payload.get(segment), rest)
        return None

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

    def _validate_items(self, items: list[dict[str, Any]], validation: dict[str, Any]) -> list[dict[str, Any]]:
        if not validation:
            return items
        output = []
        for item in items:
            if any(not item.get(field) for field in validation.get("required_fields", [])):
                continue
            failed = False
            for rule in validation.get("field_patterns", []):
                value = item.get(rule.get("path"))
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
                value = item.get(rule.get("path"))
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

    def _cache_file(self, api_spec: dict[str, Any], source_id: str, parameters: dict[str, Any]) -> Path:
        cache_spec = api_spec.get("cache", {})
        if cache_spec.get("key_template"):
            key = self._render_template(cache_spec["key_template"], parameters)
        else:
            serialized = json.dumps({"source_id": source_id, "api": api_spec.get("name"), "params": parameters}, sort_keys=True)
            key = hashlib.sha1(serialized.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{key}.json"

    def _load_cache(self, api_spec: dict[str, Any], source_id: str, parameters: dict[str, Any]) -> list[dict[str, Any]] | None:
        cache_spec = api_spec.get("cache", {})
        if not cache_spec.get("enabled"):
            return None
        cache_file = self._cache_file(api_spec, source_id, parameters)
        if not cache_file.exists():
            return None
        ttl = int(cache_spec.get("ttl_seconds", 300))
        age_seconds = datetime.utcnow().timestamp() - cache_file.stat().st_mtime
        if age_seconds > ttl:
            return None
        return json.loads(cache_file.read_text(encoding="utf-8"))

    def _save_cache(self, api_spec: dict[str, Any], source_id: str, parameters: dict[str, Any], payload: list[dict[str, Any]]) -> None:
        cache_spec = api_spec.get("cache", {})
        if not cache_spec.get("enabled"):
            return
        cache_file = self._cache_file(api_spec, source_id, parameters)
        cache_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
