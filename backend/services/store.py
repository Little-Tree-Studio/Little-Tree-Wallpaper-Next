from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import requests
import rtoml
from loguru import logger

from backend.app_meta import VERSION
from backend.plugins.validation import PluginValidationError, compare_versions
from backend.services.download import sanitize_filename


class StoreServiceError(RuntimeError):
    """Raised when the remote resource store cannot be read or installed."""


class StoreService:
    """Read the official store protocol and install downloaded resources."""

    DEFAULT_BASE_URL = "https://wallpaper.api.zsxiaoshu.cn"
    RESOURCE_PATHS: dict[str, str] = {
        "theme": "theme",
        "wallpaper_source": "resources",
        "plugin": "plugins",
    }
    MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
    MIN_WALLPAPER_SOURCE_PROTOCOL_VERSION = 4

    def __init__(self, cache_dir: Path, settings_store: Any) -> None:
        self.cache_dir = cache_dir / "store_downloads"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.settings = settings_store

    def _base_url(self) -> str:
        use_custom = bool(self.settings.get("store.use_custom_source", False))
        configured = self.settings.get("store.custom_source_url", "") if use_custom else ""
        raw = str(configured or self.DEFAULT_BASE_URL).strip()
        parsed = urlparse(raw)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise StoreServiceError("商店源地址必须是 HTTP 或 HTTPS URL")
        return raw.rstrip("/") + "/"

    def _url(self, path: str) -> str:
        return urljoin(self._base_url(), str(path).lstrip("/"))

    def _get(self, url: str) -> requests.Response:
        try:
            response = requests.get(
                url,
                headers={"User-Agent": "LittleTreeWallpaperNext/2.0"},
                timeout=(10, 30),
            )
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            raise StoreServiceError(f"请求商店失败: {exc}") from exc

    @staticmethod
    def _parse_author(value: Any) -> dict[str, Any] | None:
        if isinstance(value, str):
            return {"name": value}
        if not isinstance(value, dict):
            return None
        return {
            "name": str(value.get("name") or "未知作者"),
            "email": value.get("email"),
            "url": value.get("url"),
            "links": value.get("links") if isinstance(value.get("links"), dict) else {},
        }

    def _resolve_resource_url(self, value: Any) -> str | None:
        if not isinstance(value, str) or not value.strip():
            return None
        return self._url(value.strip()) if not urlparse(value).scheme else value.strip()

    def _normalize(self, data: dict[str, Any], resource_type: str) -> dict[str, Any]:
        resource = dict(data)
        resource["type"] = resource.get("type") or resource_type
        resource["id"] = str(resource.get("id") or "")
        resource["name"] = str(resource.get("name") or resource["id"] or "未命名资源")
        resource["version"] = str(resource.get("version") or "0.0.0")
        resource["summary"] = str(resource.get("summary") or "")
        resource["description_md"] = str(resource.get("description_md") or "")
        resource["tags"] = [str(item) for item in resource.get("tags", []) if str(item).strip()]
        resource["author"] = self._parse_author(resource.get("author"))
        resource["icon_url"] = (
            resource.get("icon_data_uri")
            or self._resolve_resource_url(resource.get("icon_path"))
            or self._resolve_resource_url(resource.get("icon_url"))
        )
        resource["download_url"] = self._resolve_resource_url(resource.get("download_url"))
        resource["download_path"] = self._resolve_resource_url(resource.get("download_path"))
        assets = resource.get("assets") if isinstance(resource.get("assets"), list) else []
        resource["assets"] = [
            {**asset, "url": self._resolve_resource_url(asset.get("url") or asset.get("path"))}
            for asset in assets
            if isinstance(asset, dict)
        ]
        plugin_meta = resource.get("plugin") if isinstance(resource.get("plugin"), dict) else {}
        resource["plugin"] = plugin_meta
        # Bounds live in the [plugin] table; top-level keys are accepted as a
        # tolerant fallback for hand-written metadata.
        resource["min_client_version"] = str(
            plugin_meta.get("min_client_version") or resource.get("min_client_version") or ""
        ).strip()
        resource["max_client_version"] = str(
            plugin_meta.get("max_client_version") or resource.get("max_client_version") or ""
        ).strip()
        if resource.get("type") not in self.RESOURCE_PATHS:
            resource["type"] = resource_type
        return resource

    def _is_supported(self, resource: dict[str, Any]) -> bool:
        if resource.get("type") != "wallpaper_source":
            return True
        try:
            protocol_version = int(resource.get("protocol_version") or 0)
        except (TypeError, ValueError):
            return False
        return protocol_version >= self.MIN_WALLPAPER_SOURCE_PROTOCOL_VERSION

    def _check_plugin_compatibility(self, resource: dict[str, Any]) -> None:
        """Reject plugins whose supported client range excludes this build.

        ``min_client_version`` / ``max_client_version`` come from the store
        metadata's ``[plugin]`` table; an empty ``max_client_version`` means no
        upper bound. Bounds that cannot be parsed as versions are ignored with
        a warning instead of blocking the install.
        """
        minimum = resource.get("min_client_version")
        maximum = resource.get("max_client_version")
        for bound, violated_message, is_satisfied in (
            (
                minimum,
                f"该插件要求应用版本不低于 {minimum}，当前为 {VERSION}",
                lambda: compare_versions(VERSION, str(minimum)) >= 0,
            ),
            (
                maximum,
                f"该插件仅支持不超过 {maximum} 的应用版本，当前为 {VERSION}",
                lambda: compare_versions(VERSION, str(maximum)) <= 0,
            ),
        ):
            if not str(bound or "").strip():
                continue
            try:
                compatible = is_satisfied()
            except PluginValidationError as exc:
                logger.warning(
                    "Ignoring unparseable plugin client version bound {!r}: {}",
                    bound,
                    exc,
                )
                continue
            if not compatible:
                raise StoreServiceError(violated_message)

    def list_resources(self, resource_type: Literal["theme", "wallpaper_source", "plugin"]) -> list[dict[str, Any]]:
        remote_type = self.RESOURCE_PATHS[resource_type]
        try:
            index = self._get(self._url(f"{remote_type}/index.json")).json()
        except (ValueError, TypeError) as exc:
            raise StoreServiceError("商店索引不是有效 JSON") from exc
        if not isinstance(index, list):
            raise StoreServiceError("商店索引格式无效")

        resources: list[dict[str, Any]] = []
        for filename in index:
            if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9._/-]+", filename):
                continue
            try:
                response = self._get(self._url(f"{remote_type}/{filename}"))
                data = rtoml.loads(response.text)
                if isinstance(data, dict):
                    resource = self._normalize(data, resource_type)
                    if not self._is_supported(resource):
                        logger.warning(
                            "Skipping store metadata {}: wallpaper source protocol_version must be >= {}",
                            filename,
                            self.MIN_WALLPAPER_SOURCE_PROTOCOL_VERSION,
                        )
                        continue
                    resources.append(resource)
            except Exception as exc:
                logger.warning("Skipping store metadata {}: {}", filename, exc)
        return resources

    def _download_source(self, resource: dict[str, Any]) -> Path:
        source = resource.get("download_url") or resource.get("download_path")
        if not source:
            assets = resource.get("assets") or []
            source = assets[0].get("url") if assets and isinstance(assets[0], dict) else None
        if not isinstance(source, str) or not source:
            raise StoreServiceError("该资源没有提供下载地址")

        name = sanitize_filename(f"{resource.get('id', 'resource')}-{resource.get('version', 'latest')}")
        suffix = Path(urlparse(source).path).suffix or ".download"
        destination = self.cache_dir / f".{name}-{uuid.uuid4().hex}{suffix}"
        digest = hashlib.sha256()
        received = 0
        completed = False
        expected_hash = str(resource.get("sha256") or "").lower().strip()
        assets = resource.get("assets") or []
        if not expected_hash and assets and isinstance(assets[0], dict):
            expected_hash = str(assets[0].get("sha256") or "").lower().strip()

        try:
            with requests.get(
                source,
                headers={"User-Agent": "LittleTreeWallpaperNext/2.0"},
                timeout=(10, 120),
                stream=True,
            ) as response:
                response.raise_for_status()
                advertised = response.headers.get("Content-Length")
                if advertised and advertised.isdigit() and int(advertised) > self.MAX_DOWNLOAD_BYTES:
                    raise StoreServiceError("资源包超过允许的大小限制")
                with destination.open("wb") as output:
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        received += len(chunk)
                        if received > self.MAX_DOWNLOAD_BYTES:
                            raise StoreServiceError("资源包超过允许的大小限制")
                        digest.update(chunk)
                        output.write(chunk)
            if expected_hash and digest.hexdigest() != expected_hash:
                raise StoreServiceError("资源包 SHA-256 校验失败")
            if received == 0:
                raise StoreServiceError("资源包为空")
            completed = True
            return destination
        except requests.RequestException as exc:
            raise StoreServiceError(f"下载资源失败: {exc}") from exc
        except OSError as exc:
            raise StoreServiceError(f"保存资源包失败: {exc}") from exc
        finally:
            if destination.exists() and not completed:
                destination.unlink(missing_ok=True)

    def install(self, resource: dict[str, Any], api: Any) -> dict[str, Any]:
        normalized = self._normalize(resource, str(resource.get("type") or "plugin"))
        if not self._is_supported(normalized):
            raise StoreServiceError(
                f"壁纸源协议版本过低：仅支持 protocol_version >= {self.MIN_WALLPAPER_SOURCE_PROTOCOL_VERSION}"
            )
        if normalized["type"] == "plugin":
            self._check_plugin_compatibility(normalized)
        package = self._download_source(normalized)
        try:
            resource_type = normalized["type"]
            if resource_type == "theme":
                result = api.theme_service.import_theme(package)
            elif resource_type == "plugin":
                result = api.plugin_manager.install_package(package)
                if result.get("status") == "error" or result.get("state") == "error":
                    raise StoreServiceError(str(result.get("error") or "插件安装失败"))
            elif resource_type == "wallpaper_source":
                result = api.ltws_service.import_source(str(package))
            else:
                raise StoreServiceError(f"不支持安装资源类型: {resource_type}")
            logger.info("Installed store resource {} {}", normalized["id"], normalized["version"])
            return {"resource": normalized, "result": result}
        finally:
            package.unlink(missing_ok=True)
