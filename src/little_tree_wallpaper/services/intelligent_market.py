from __future__ import annotations

import asyncio
import base64
import io
import json
import mimetypes
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import aiohttp
import orjson
from loguru import logger
from aiohttp import ClientResponseError
from PIL import Image


DEFAULT_IM_REPO_OWNER = "IntelliMarkets"
DEFAULT_IM_REPO_NAME = "Wallpaper_API_Index"
DEFAULT_IM_REPO_BRANCH = "main"
_DEFAULT_TIMEOUT_SECONDS = 30
_HEALTH_CACHE_TTL_SECONDS = 1800
_HEALTH_CHECK_CONCURRENCY = 8
_HIDDEN_PARAM_PREFIX = "__param_"
_IMAGE_TITLE_HINTS = {"title", "标题", "名称", "name"}
_IMAGE_WIDTH_HINTS = {"width", "宽度", "画幅宽度"}
_IMAGE_HEIGHT_HINTS = {"height", "高度", "画幅高度"}
_IMAGE_DESCRIPTION_HINTS = {"description", "简介", "描述", "说明"}
_IMAGE_SOURCE_HINTS = {"source", "来源", "url", "地址"}


def _slugify_field_name(value: str) -> str:
    text = re.sub(r"\s+", "_", value.strip().lower())
    text = re.sub(r"[^a-z0-9_\u4e00-\u9fff]+", "_", text)
    return text.strip("_") or "field"


def _is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    return text in {"1", "true", "yes", "on", "y", "t"}


def _coerce_number(value: Any, *, integer: bool) -> int | float:
    if integer:
        return int(float(value))
    return float(value)


def _path_tokens(path: str) -> list[str | int | None]:
    if not path:
        return []
    tokens: list[str | int | None] = []
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
                tokens.append(None)
            elif raw_token.isdigit():
                tokens.append(int(raw_token))
            else:
                tokens.append(raw_token)
            index = end_index + 1
            continue
        next_index = index
        while next_index < len(path) and path[next_index] not in ".[":
            next_index += 1
        tokens.append(path[index:next_index])
        index = next_index
    return tokens


def _extract_path_values(payload: Any, path: str | None) -> list[Any]:
    if path is None:
        return []
    normalized_path = str(path).strip()
    if not normalized_path:
        return [payload]

    current: list[Any] = [payload]
    for token in _path_tokens(normalized_path):
        next_values: list[Any] = []
        for value in current:
            if token is None:
                if isinstance(value, list):
                    next_values.extend(value)
                elif isinstance(value, dict):
                    next_values.extend(value.values())
                continue
            if isinstance(token, int):
                if isinstance(value, list) and 0 <= token < len(value):
                    next_values.append(value[token])
                continue
            if isinstance(value, dict) and token in value:
                next_values.append(value[token])
        current = next_values
        if not current:
            break
    return current


def _flatten_scalar_values(values: list[Any]) -> list[Any]:
    flattened: list[Any] = []
    for value in values:
        if isinstance(value, list):
            flattened.extend(_flatten_scalar_values(value))
        else:
            flattened.append(value)
    return flattened


def _guess_extension(content_type: str | None, fallback: str = ".jpg") -> str:
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip())
        if guessed:
            return guessed
    return fallback


def _normalize_query_param_value(value: Any) -> Any:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return [_normalize_query_param_value(item) for item in value]
    return value


class IntelligentMarketService:
    def __init__(
        self,
        cache_dir: Path,
        settings_store: Any,
        repo_owner: str = DEFAULT_IM_REPO_OWNER,
        repo_name: str = DEFAULT_IM_REPO_NAME,
        repo_branch: str = DEFAULT_IM_REPO_BRANCH,
    ):
        self._cache_dir = cache_dir / "intelligent_market"
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._settings = settings_store
        self._repo_owner = repo_owner
        self._repo_name = repo_name
        self._repo_branch = repo_branch
        self._sources_cache: dict[str, dict[str, Any]] = {}
        self._sources_cache_timestamp = 0.0
        self._health_cache: dict[str, dict[str, Any]] = {}

    @property
    def cache_dir(self) -> Path:
        return self._cache_dir

    def list_sources(self, *, force: bool = False) -> list[dict[str, Any]]:
        try:
            return asyncio.run(self._list_sources_async(force=force))
        except Exception as exc:
            logger.error("list intelligent market sources failed: {}", exc)
            if self._sources_cache and not force:
                return list(self._sources_cache.values())
            raise RuntimeError(self._format_source_list_error(exc)) from exc

    def check_sources_health(
        self,
        source_ids: list[str] | None = None,
        *,
        force: bool = False,
    ) -> list[dict[str, Any]]:
        try:
            return asyncio.run(
                self._check_sources_health_async(source_ids=source_ids, force=force)
            )
        except Exception as exc:
            logger.error("check intelligent market health failed: {}", exc)
            return []

    def execute_source(
        self,
        source_id: str,
        parameters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        try:
            return asyncio.run(
                self._execute_source_async(source_id=source_id, parameters=parameters or {})
            )
        except Exception as exc:
            logger.exception("execute intelligent market source failed")
            raise RuntimeError(str(exc)) from exc

    async def _list_sources_async(self, *, force: bool = False) -> list[dict[str, Any]]:
        if (
            not force
            and self._sources_cache
            and (time.time() - self._sources_cache_timestamp) < 600
        ):
            return list(self._sources_cache.values())

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=_DEFAULT_TIMEOUT_SECONDS),
            headers={"User-Agent": "LittleTreeWallpaperNext/2.0"},
        ) as session:
            tree_payload = await self._fetch_market_tree(session)
            json_paths = self._extract_json_paths(tree_payload)

            configs = await asyncio.gather(
                *(self._fetch_source_config(session, path) for path in json_paths),
                return_exceptions=True,
            )

            sources: list[dict[str, Any]] = []
            cache: dict[str, dict[str, Any]] = {}
            for path, config in zip(json_paths, configs, strict=False):
                if isinstance(config, Exception):
                    logger.warning("skip intelligent market source {}: {}", path, config)
                    continue
                if not isinstance(config, dict):
                    continue
                source = self._normalize_source(path, config)
                sources.append(source)
                cache[source["id"]] = source

        sources.sort(key=lambda item: (item["category"], item["friendly_name"].lower()))
        self._sources_cache = cache
        self._sources_cache_timestamp = time.time()
        return sources

    async def _check_sources_health_async(
        self,
        *,
        source_ids: list[str] | None,
        force: bool,
    ) -> list[dict[str, Any]]:
        if not self._sources_cache:
            await self._list_sources_async(force=False)

        targets: list[dict[str, Any]]
        if source_ids:
            wanted_ids = {str(source_id) for source_id in source_ids}
            targets = [
                self._sources_cache[source_id]
                for source_id in wanted_ids
                if source_id in self._sources_cache
            ]
        else:
            targets = list(self._sources_cache.values())

        if not targets:
            return []

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=_DEFAULT_TIMEOUT_SECONDS),
            headers={"User-Agent": "LittleTreeWallpaperNext/2.0"},
        ) as session:
            results = await self._apply_health_statuses(
                session,
                sources=targets,
                force=force,
            )

        updates: list[dict[str, Any]] = []
        for source_id, result in results.items():
            cached_source = self._sources_cache.get(source_id)
            if cached_source is not None:
                cached_source.update(result)
            updates.append({"id": source_id, **result})

        return updates

    async def _execute_source_async(
        self,
        *,
        source_id: str,
        parameters: dict[str, Any],
    ) -> list[dict[str, Any]]:
        source = self._sources_cache.get(source_id)
        if source is None:
            await self._list_sources_async(force=False)
            source = self._sources_cache.get(source_id)
        if source is None:
            raise ValueError("未找到指定的 Intelligent Market 图片源")

        request_info = self._build_request(source, parameters)
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=_DEFAULT_TIMEOUT_SECONDS),
            headers={"User-Agent": "LittleTreeWallpaperNext/2.0"},
        ) as session:
            async with session.request(
                request_info["method"],
                request_info["url"],
                params=request_info["query"],
                json=request_info["json"],
            ) as response:
                response.raise_for_status()
                binary_content = await response.read()
                content_type = response.headers.get("Content-Type", "")

            items = self._parse_response(
                source=source,
                request_info=request_info,
                binary_content=binary_content,
                content_type=content_type,
            )
            return await self._localize_remote_items(
                session,
                source=source,
                request_info=request_info,
                items=items,
            )

    async def _localize_remote_items(
        self,
        session: aiohttp.ClientSession,
        *,
        source: dict[str, Any],
        request_info: dict[str, Any],
        items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        localized_items: list[dict[str, Any]] = []
        referer = str(request_info.get("preview_url") or request_info.get("url") or "").strip()
        for item in items:
            image_url = str(item.get("image_url") or "").strip()
            metadata = dict(item.get("metadata") or {})
            if referer and "referer" not in metadata:
                metadata["referer"] = referer

            if not re.match(r"^https?://", image_url, flags=re.IGNORECASE):
                item["metadata"] = metadata
                localized_items.append(item)
                continue

            cached_path = await self._cache_remote_image(
                session,
            source=source,
                image_url=image_url,
                referer=referer,
            )
            if cached_path is not None:
                metadata.setdefault("original_url", image_url)
                item = {
                    **item,
                    "image_url": str(cached_path),
                    "preview_url": str(cached_path),
                    "metadata": metadata,
                }
            else:
                item["metadata"] = metadata
            localized_items.append(item)
        return localized_items

    async def _cache_remote_image(
        self,
        session: aiohttp.ClientSession,
        *,
        source: dict[str, Any],
        image_url: str,
        referer: str,
    ) -> Path | None:
        headers = {"User-Agent": "LittleTreeWallpaperNext/2.0"}
        if referer:
            headers["Referer"] = referer
        try:
            async with session.get(image_url, headers=headers, allow_redirects=True) as response:
                response.raise_for_status()
                data = await response.read()
                if not data:
                    return None
                return self._save_image_bytes(
                    source_id=str(source.get("id") or "intelligent_market"),
                    data=data,
                    content_type=response.headers.get("Content-Type"),
                )
        except Exception as exc:
            logger.warning(
                "cache intelligent market image failed {} via {}: {}",
                source.get("id"),
                image_url,
                exc,
            )
            return None

    async def _fetch_source_config(
        self, session: aiohttp.ClientSession, relative_path: str
    ) -> dict[str, Any]:
        last_error: Exception | None = None
        for raw_url in self._build_raw_candidates(relative_path):
            try:
                async with session.get(raw_url) as response:
                    response.raise_for_status()
                    return await response.json(content_type=None)
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "fetch intelligent market config failed {} via {}: {}",
                    relative_path,
                    raw_url,
                    exc,
                )
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"未找到可用的 Intelligent Market 配置地址: {relative_path}")

    async def _fetch_market_tree(self, session: aiohttp.ClientSession) -> Any:
        last_error: Exception | None = None
        for tree_url in self._build_tree_candidates():
            try:
                async with session.get(tree_url) as response:
                    response.raise_for_status()
                    return await response.json(content_type=None)
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "fetch intelligent market tree failed via {}: {}",
                    tree_url,
                    exc,
                )
        if last_error is not None:
            raise last_error
        raise RuntimeError("未找到可用的 Intelligent Market 目录索引地址")

    def _extract_json_paths(self, tree_payload: Any) -> list[str]:
        if isinstance(tree_payload, dict) and isinstance(tree_payload.get("tree"), list):
            return [
                str(item.get("path") or "")
                for item in tree_payload.get("tree", [])
                if item.get("type") == "blob"
                and str(item.get("path") or "").endswith(".api.json")
                and "/" in str(item.get("path") or "")
            ]

        if isinstance(tree_payload, dict) and isinstance(tree_payload.get("files"), list):
            return [
                str(item.get("name") or "").lstrip("/")
                for item in tree_payload.get("files", [])
                if str(item.get("name") or "").endswith(".api.json")
                and "/" in str(item.get("name") or "")
            ]

        raise RuntimeError("无法解析 Intelligent Market 目录索引")

    def _format_source_list_error(self, exc: Exception) -> str:
        if isinstance(exc, ClientResponseError) and exc.status == 403:
            message = str(exc.message or "")
            if "rate limit" in message.lower():
                return "Intelligent Market 列表加载失败：GitHub API 触发限流，且镜像回退也未成功。请切换到 jsDelivr 或稍后重试。"
        return f"Intelligent Market 列表加载失败：{exc}"

    def _normalize_source(self, relative_path: str, config: dict[str, Any]) -> dict[str, Any]:
        category = relative_path.split("/", 1)[0]
        parameters = []
        for index, param in enumerate(config.get("parameters") or []):
            if not isinstance(param, dict):
                continue
            param_name = str(param.get("name") or "").strip() or None
            param_type = str(param.get("type") or "string").strip().lower() or "string"
            raw_value = param.get("value")
            options = raw_value if param_type == "enum" and isinstance(raw_value, list) else None
            default_value = self._parameter_default_value(param)
            parameters.append(
                {
                    "key": param_name or f"{_HIDDEN_PARAM_PREFIX}{index}",
                    "name": param_name,
                    "type": param_type,
                    "required": bool(param.get("required", False)),
                    "friendly_name": str(param.get("friendly_name") or "").strip(),
                    "default_value": default_value,
                    "options": options,
                    "friendly_options": list(param.get("friendly_value") or [])
                    if isinstance(param.get("friendly_value"), list)
                    else [],
                    "min_value": param.get("min_value"),
                    "max_value": param.get("max_value"),
                    "split_str": param.get("split_str"),
                    "enabled": bool(param.get("enable", True)),
                }
            )

        return {
            "id": relative_path,
            "category": category,
            "file_path": relative_path,
            "friendly_name": str(config.get("friendly_name") or Path(relative_path).stem),
            "intro": str(config.get("intro") or "").strip(),
            "icon": str(config.get("icon") or "").strip() or None,
            "link": str(config.get("link") or "").strip(),
            "method": str(config.get("func") or "GET").strip().upper(),
            "api_core_version": str(config.get("APICORE_version") or "1.0"),
            "parameters": parameters,
            "raw_url": self._build_raw_candidates(relative_path)[0],
            "html_url": (
                f"https://github.com/{self._repo_owner}/{self._repo_name}/blob/"
                f"{self._repo_branch}/{relative_path}"
            ),
            "response": config.get("response") or {},
            "health_status": "unknown",
            "health_message": "等待预检",
            "health_checked_at": None,
            "health_status_code": None,
            "health_probe_url": None,
        }

    async def _apply_health_statuses(
        self,
        session: aiohttp.ClientSession,
        *,
        sources: list[dict[str, Any]],
        force: bool,
    ) -> dict[str, dict[str, Any]]:
        semaphore = asyncio.Semaphore(_HEALTH_CHECK_CONCURRENCY)
        updates: dict[str, dict[str, Any]] = {}

        async def _check(source: dict[str, Any]) -> None:
            async with semaphore:
                result = await self._resolve_health_status(
                    session,
                    source=source,
                    force=force,
                )
                source.update(result)
                updates[str(source.get("id") or "")] = result

        await asyncio.gather(*(_check(source) for source in sources))
        return updates

    async def _resolve_health_status(
        self,
        session: aiohttp.ClientSession,
        *,
        source: dict[str, Any],
        force: bool,
    ) -> dict[str, Any]:
        source_id = str(source.get("id") or "")
        now = time.time()
        cached = self._health_cache.get(source_id)
        if (
            not force
            and cached is not None
            and (now - float(cached.get("_timestamp", 0.0))) < _HEALTH_CACHE_TTL_SECONDS
        ):
            return {
                key: value for key, value in cached.items() if not key.startswith("_")
            }

        try:
            probe_request = self._build_health_probe_request(source)
        except ValueError as exc:
            result = {
                "health_status": "unknown",
                "health_message": str(exc),
                "health_checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "health_status_code": None,
                "health_probe_url": None,
            }
            self._health_cache[source_id] = {**result, "_timestamp": now}
            return result

        result = await self._probe_source(session, source=source, request=probe_request)
        self._health_cache[source_id] = {**result, "_timestamp": now}
        return result

    def _build_health_probe_request(self, source: dict[str, Any]) -> dict[str, Any]:
        try:
            request_info = self._build_request(source, {})
        except ValueError:
            missing_defaults = []
            for param in source.get("parameters") or []:
                if not bool(param.get("required", False)):
                    continue
                default_value = self._normalize_parameter_value(param, None)
                if _is_empty_value(default_value):
                    missing_defaults.append(
                        str(param.get("friendly_name") or param.get("name") or param.get("key") or "参数")
                    )
            if missing_defaults:
                raise ValueError(
                    "需手动填写必填参数后才能检测"
                )
            raise
        return request_info

    async def _probe_source(
        self,
        session: aiohttp.ClientSession,
        *,
        source: dict[str, Any],
        request: dict[str, Any],
    ) -> dict[str, Any]:
        health_checked_at = time.strftime("%Y-%m-%d %H:%M:%S")
        probe_url = request.get("preview_url")
        method = str(request.get("method") or "GET").upper()

        async def _attempt(probe_method: str) -> tuple[int | None, str | None]:
            try:
                async with session.request(
                    probe_method,
                    str(request.get("url") or ""),
                    params=request.get("query"),
                    json=request.get("json") if probe_method == method else None,
                    allow_redirects=True,
                ) as response:
                    status = response.status
                    if 200 <= status < 400:
                        return status, None
                    return status, f"HTTP {status}"
            except Exception as exc:
                return None, str(exc)

        attempts = ["HEAD"] if method in {"GET", "HEAD"} else []
        if method not in attempts:
            attempts.append(method)
        elif method == "GET":
            attempts.append("GET")

        last_status: int | None = None
        last_error: str | None = None
        for probe_method in attempts:
            status, error = await _attempt(probe_method)
            if status is not None and 200 <= status < 400:
                return {
                    "health_status": "healthy",
                    "health_message": "接口预检通过",
                    "health_checked_at": health_checked_at,
                    "health_status_code": status,
                    "health_probe_url": probe_url,
                }
            if status in {401, 403}:
                return {
                    "health_status": "unknown",
                    "health_message": error or "需要鉴权或被上游拦截",
                    "health_checked_at": health_checked_at,
                    "health_status_code": status,
                    "health_probe_url": probe_url,
                }
            last_status = status
            last_error = error

        return {
            "health_status": "unhealthy",
            "health_message": last_error or "接口预检失败",
            "health_checked_at": health_checked_at,
            "health_status_code": last_status,
            "health_probe_url": probe_url,
        }

    def _parameter_default_value(self, param: dict[str, Any]) -> Any:
        param_type = str(param.get("type") or "string").strip().lower()
        raw_value = param.get("value")
        if param_type == "enum" and isinstance(raw_value, list):
            return raw_value[0] if raw_value else None
        return raw_value

    def _build_request(
        self, source: dict[str, Any], overrides: dict[str, Any]
    ) -> dict[str, Any]:
        path_segments: list[str] = []
        named_parameters: dict[str, Any] = {}
        normalized_values: dict[str, Any] = {}

        for param in source.get("parameters") or []:
            key = str(param.get("key") or "")
            name = str(param.get("name") or "").strip()
            raw_override = overrides.get(key)
            if raw_override is None and name:
                raw_override = overrides.get(name)
            value = self._normalize_parameter_value(param, raw_override)
            if _is_empty_value(value):
                if bool(param.get("required", False)):
                    friendly_name = str(param.get("friendly_name") or name or key or "参数")
                    raise ValueError(f"参数“{friendly_name}”不能为空")
                continue
            normalized_values[key] = value
            if name:
                named_parameters[name] = value
            else:
                if isinstance(value, list):
                    path_segments.extend(str(item) for item in value if not _is_empty_value(item))
                else:
                    path_segments.append(str(value))

        base_url = str(source.get("link") or "").strip()
        if not base_url:
            raise ValueError("图片源缺少请求地址")

        if path_segments:
            suffix = "/".join(quote(segment, safe="" ) for segment in path_segments)
            base_url = f"{base_url.rstrip('/')}/{suffix}"

        method = str(source.get("method") or "GET").upper()
        query: dict[str, Any] | None = None
        json_payload: dict[str, Any] | None = None
        if method in {"GET", "DELETE", "HEAD", "OPTIONS"}:
            query = (
                {
                    key: _normalize_query_param_value(value)
                    for key, value in named_parameters.items()
                }
                or None
            )
        else:
            json_payload = named_parameters or None

        preview_url = base_url
        if query:
            preview_url = f"{base_url}?{urlencode(query, doseq=True)}"

        return {
            "method": method,
            "url": base_url,
            "query": query,
            "json": json_payload,
            "normalized_values": normalized_values,
            "preview_url": preview_url,
        }

    def _normalize_parameter_value(self, param: dict[str, Any], override: Any) -> Any:
        param_type = str(param.get("type") or "string").strip().lower()
        value = override if override is not None else param.get("default_value")

        if param_type == "enum":
            options = list(param.get("options") or [])
            if override is None:
                return value
            for option in options:
                if str(option) == str(override):
                    return option
            return override

        if param_type == "boolean":
            return _coerce_bool(value)

        if param_type in {"integer", "number"}:
            if _is_empty_value(value):
                return None
            return _coerce_number(value, integer=param_type == "integer")

        if param_type == "list":
            if value is None:
                return []
            if isinstance(value, list):
                return [item for item in value if not _is_empty_value(item)]
            split_str = str(param.get("split_str") or "").strip()
            if split_str:
                return [
                    item.strip()
                    for item in str(value).split(split_str)
                    if item.strip()
                ]
            return [
                item.strip()
                for item in re.split(r"[\r\n,]+", str(value))
                if item.strip()
            ]

        if value is None:
            return None
        return str(value)

    def _parse_response(
        self,
        *,
        source: dict[str, Any],
        request_info: dict[str, Any],
        binary_content: bytes,
        content_type: str,
    ) -> list[dict[str, Any]]:
        response_spec = source.get("response") or {}
        image_spec = response_spec.get("image") or {}
        image_content_type = str(image_spec.get("content_type") or "URL").upper()

        if image_content_type == "BINARY":
            saved_path = self._save_image_bytes(source_id=source["id"], data=binary_content, content_type=content_type)
            return [
                self._build_wallpaper_item(
                    source=source,
                    image_value=str(saved_path),
                    index=0,
                    title=source["friendly_name"],
                    width=None,
                    height=None,
                    description=source.get("intro") or "",
                    metadata={
                        "request_url": request_info["preview_url"],
                        "category": source["category"],
                        "file_path": source["file_path"],
                    },
                )
            ]

        payload: Any
        text_content = binary_content.decode("utf-8", errors="replace")
        if image_content_type == "URL" and not str(image_spec.get("path") or "").strip():
            payload = text_content.strip()
        else:
            payload = self._parse_payload(text_content)

        if image_content_type == "BASE64":
            image_values = self._resolve_image_values(payload, image_spec)
            items: list[dict[str, Any]] = []
            for index, image_value in enumerate(image_values):
                raw_bytes = base64.b64decode(str(image_value))
                saved_path = self._save_image_bytes(
                    source_id=source["id"],
                    data=raw_bytes,
                    content_type=content_type,
                )
                items.append(
                    self._build_wallpaper_item(
                        source=source,
                        image_value=str(saved_path),
                        index=index,
                        title=None,
                        width=None,
                        height=None,
                        description=source.get("intro") or "",
                        metadata={
                            "request_url": request_info["preview_url"],
                            "category": source["category"],
                            "file_path": source["file_path"],
                        },
                    )
                )
            return items

        image_values = self._resolve_image_values(payload, image_spec)
        if not image_values:
            return []

        item_context = self._extract_other_fields(
            payload=payload,
            image_count=len(image_values),
            others=response_spec.get("others") or [],
        )

        results: list[dict[str, Any]] = []
        for index, image_value in enumerate(image_values):
            context = item_context[index] if index < len(item_context) else {}
            title = self._pick_title(context, source["friendly_name"], index)
            width = self._pick_dimension(context, width=True)
            height = self._pick_dimension(context, width=False)
            description = self._pick_description(context, source.get("intro") or "")
            metadata = {
                "request_url": request_info["preview_url"],
                "category": source["category"],
                "file_path": source["file_path"],
                "details": context,
            }
            source_link = self._pick_source_link(context)
            if source_link:
                metadata["original_url"] = source_link
            results.append(
                self._build_wallpaper_item(
                    source=source,
                    image_value=str(image_value),
                    index=index,
                    title=title,
                    width=width,
                    height=height,
                    description=description,
                    metadata=metadata,
                )
            )
        return results

    def _parse_payload(self, text_content: str) -> Any:
        normalized = text_content.strip()
        if not normalized:
            return {}
        try:
            return orjson.loads(normalized)
        except Exception:
            return json.loads(normalized)

    def _resolve_image_values(
        self, payload: Any, image_spec: dict[str, Any]
    ) -> list[Any]:
        path = str(image_spec.get("path") or "").strip()
        is_list = bool(image_spec.get("is_list", False))
        if isinstance(payload, str) and not path:
            return [payload] if payload else []
        values = _flatten_scalar_values(_extract_path_values(payload, path))
        if not is_list and values:
            return [values[0]]
        return [value for value in values if not _is_empty_value(value)]

    def _extract_other_fields(
        self,
        *,
        payload: Any,
        image_count: int,
        others: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        contexts = [dict() for _ in range(max(1, image_count))]
        for group in others:
            if not isinstance(group, dict):
                continue
            group_name = str(group.get("friendly_name") or "详情").strip() or "详情"
            for field in group.get("data") or []:
                if not isinstance(field, dict):
                    continue
                label = str(field.get("friendly_name") or field.get("path") or "字段").strip() or "字段"
                field_key = _slugify_field_name(label)
                values = _flatten_scalar_values(
                    _extract_path_values(payload, str(field.get("path") or "").strip())
                )
                one_to_one = bool(field.get("one-to-one-mapping", False))
                if one_to_one or len(values) == image_count:
                    for index in range(min(len(values), len(contexts))):
                        contexts[index][field_key] = {
                            "label": label,
                            "group": group_name,
                            "value": values[index],
                        }
                elif len(values) == 1:
                    for context in contexts:
                        context[field_key] = {
                            "label": label,
                            "group": group_name,
                            "value": values[0],
                        }
                elif values:
                    for context in contexts:
                        context[field_key] = {
                            "label": label,
                            "group": group_name,
                            "value": values,
                        }
        return contexts

    def _pick_title(
        self, context: dict[str, Any], fallback_name: str, index: int
    ) -> str:
        for entry in context.values():
            label = str(entry.get("label") or "").strip().lower()
            if label in _IMAGE_TITLE_HINTS:
                value = entry.get("value")
                if not _is_empty_value(value):
                    return str(value)
        suffix = f" #{index + 1}" if index > 0 else ""
        return f"{fallback_name}{suffix}"

    def _pick_dimension(self, context: dict[str, Any], *, width: bool) -> int | None:
        hints = _IMAGE_WIDTH_HINTS if width else _IMAGE_HEIGHT_HINTS
        for entry in context.values():
            label = str(entry.get("label") or "").strip().lower()
            if label in hints:
                try:
                    return int(float(entry.get("value")))
                except Exception:
                    return None
        return None

    def _pick_description(self, context: dict[str, Any], fallback: str) -> str:
        for entry in context.values():
            label = str(entry.get("label") or "").strip().lower()
            if label in _IMAGE_DESCRIPTION_HINTS:
                value = entry.get("value")
                if not _is_empty_value(value):
                    return str(value)
        return fallback

    def _pick_source_link(self, context: dict[str, Any]) -> str | None:
        for entry in context.values():
            label = str(entry.get("label") or "").strip().lower()
            if label in _IMAGE_SOURCE_HINTS:
                value = entry.get("value")
                if not _is_empty_value(value):
                    return str(value)
        return None

    def _build_wallpaper_item(
        self,
        *,
        source: dict[str, Any],
        image_value: str,
        index: int,
        title: str | None,
        width: int | None,
        height: int | None,
        description: str,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_title = title or source["friendly_name"]
        item_id = f"im:{source['id']}:{index}:{abs(hash(image_value))}"
        preview_value = self._build_preview_value(image_value)
        return {
            "id": item_id,
            "source_id": "intelligent_market",
            "source_name": source["friendly_name"],
            "title": normalized_title,
            "image_url": image_value,
            "preview_url": preview_value,
            "width": width,
            "height": height,
            "description": description,
            "metadata": metadata,
        }

    def _build_preview_value(self, image_value: str) -> str:
        raw = str(image_value or "").strip()
        if not raw:
            return raw
        candidate = Path(raw)
        if candidate.is_file():
            return self._build_preview_data_url(candidate) or raw
        return raw

    def _build_preview_data_url(self, image_path: Path) -> str | None:
        try:
            with Image.open(image_path) as image:
                preview = image.copy()
                preview.thumbnail((960, 540))
                if preview.mode not in {"RGB", "L"}:
                    preview = preview.convert("RGB")

                buffer = io.BytesIO()
                preview.save(buffer, format="JPEG", quality=82, optimize=True)
                encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
                return f"data:image/jpeg;base64,{encoded}"
        except Exception as exc:
            logger.debug("build intelligent market preview failed: {}", exc)
            return None

    def _save_image_bytes(
        self, *, source_id: str, data: bytes, content_type: str | None
    ) -> Path:
        source_slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", source_id)
        directory = self._cache_dir / source_slug
        directory.mkdir(parents=True, exist_ok=True)
        extension = _guess_extension(content_type)
        target = directory / f"{int(time.time() * 1000)}{extension}"
        target.write_bytes(data)
        return target

    def _build_raw_candidates(self, relative_path: str) -> list[str]:
        raw_github = (
            f"https://raw.githubusercontent.com/{self._repo_owner}/"
            f"{self._repo_name}/{self._repo_branch}/{relative_path}"
        )
        cdn_url = (
            f"https://cdn.jsdelivr.net/gh/{self._repo_owner}/"
            f"{self._repo_name}@{self._repo_branch}/{relative_path}"
        )
        ghproxy_url = f"https://gh-proxy.com/{raw_github}"
        preference = str(self._settings.get("im.mirror_preference", "auto") or "auto")
        if preference == "github":
            return [raw_github, cdn_url, ghproxy_url]
        if preference == "jsdelivr":
            return [cdn_url, raw_github, ghproxy_url]
        if preference == "ghproxy":
            return [ghproxy_url, raw_github, cdn_url]
        return [raw_github, cdn_url, ghproxy_url]

    def _build_tree_candidates(self) -> list[str]:
        github_api = (
            f"https://api.github.com/repos/{self._repo_owner}/{self._repo_name}"
            f"/git/trees/{self._repo_branch}?recursive=1"
        )
        jsdelivr_flat = (
            f"https://data.jsdelivr.com/v1/package/gh/{self._repo_owner}/"
            f"{self._repo_name}@{self._repo_branch}/flat"
        )
        ghproxy_api = f"https://gh-proxy.com/{github_api}"
        preference = str(self._settings.get("im.mirror_preference", "auto") or "auto")
        if preference == "github":
            return [github_api, jsdelivr_flat, ghproxy_api]
        if preference == "jsdelivr":
            return [jsdelivr_flat, github_api, ghproxy_api]
        if preference == "ghproxy":
            return [ghproxy_api, jsdelivr_flat, github_api]
        return [github_api, jsdelivr_flat, ghproxy_api]
