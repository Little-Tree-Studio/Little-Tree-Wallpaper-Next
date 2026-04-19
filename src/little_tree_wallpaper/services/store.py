from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import aiohttp
import rtoml
from loguru import logger


DEFAULT_STORE_URL = "https://wallpaper.api.zsxiaoshu.cn"


@dataclass
class ResourceAuthor:
    name: str
    email: str | None = None
    url: str | None = None
    links: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ResourceAsset:
    name: str
    path: str | None = None
    url: str | None = None
    sha256: str | None = None
    size_bytes: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PluginMetadata:
    min_client_version: str | None = None
    max_client_version: str | None = None
    api_version: str | None = None
    entry: str | None = None
    dependencies: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ThemeMetadata:
    preview_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ResourceMetadata:
    type: Literal["plugin", "theme", "wallpaper_source"]
    id: str
    name: str
    version: str
    summary: str
    description_md: str

    protocol_version: int | None = None

    icon_url: str | None = None
    icon_path: str | None = None
    icon_data_uri: str | None = None
    icon_base64: str | None = None
    icon_mime: str | None = None

    download_url: str | None = None
    download_path: str | None = None
    assets: list[ResourceAsset] = field(default_factory=list)

    homepage_url: str | None = None
    repository_url: str | None = None
    license: str | None = None
    author: ResourceAuthor | None = None
    tags: list[str] = field(default_factory=list)
    changelog_url: str | None = None

    plugin: PluginMetadata | None = None
    theme: ThemeMetadata | None = None

    def get_icon(self) -> str | None:
        if self.icon_data_uri:
            return self.icon_data_uri
        if self.icon_url:
            return self.icon_url
        if self.icon_base64 and self.icon_mime:
            return f"data:{self.icon_mime};base64,{self.icon_base64}"
        return None

    def get_download_source(self) -> tuple[str | None, str]:
        if self.download_path:
            return (self.download_path, "path")
        if self.download_url:
            return (self.download_url, "url")
        if self.assets:
            asset = self.assets[0]
            if asset.path:
                return (asset.path, "path")
            if asset.url:
                return (asset.url, "url")
        return (None, "none")

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "type": self.type,
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "summary": self.summary,
            "description_md": self.description_md,
            "tags": self.tags,
        }
        if self.protocol_version is not None:
            result["protocol_version"] = self.protocol_version
        if self.author is not None:
            result["author"] = self.author.to_dict()
        if self.homepage_url:
            result["homepage_url"] = self.homepage_url
        if self.repository_url:
            result["repository_url"] = self.repository_url
        if self.license:
            result["license"] = self.license
        if self.changelog_url:
            result["changelog_url"] = self.changelog_url
        if self.plugin is not None:
            result["plugin"] = self.plugin.to_dict()
        if self.theme is not None:
            result["theme"] = self.theme.to_dict()
        icon = self.get_icon()
        if icon:
            result["icon_url"] = icon
        dl_source, dl_type = self.get_download_source()
        if dl_source:
            result["download_url"] = dl_source
            result["download_type"] = dl_type
        if self.assets:
            result["assets"] = [a.to_dict() for a in self.assets]
        return result


class StoreServiceError(Exception):
    pass


def _parse_author(data: dict) -> ResourceAuthor | None:
    author_data = data.get("author")
    if not author_data or not isinstance(author_data, dict):
        return None
    return ResourceAuthor(
        name=author_data.get("name", ""),
        email=author_data.get("email"),
        url=author_data.get("url"),
        links=author_data.get("links", {}),
    )


def _parse_assets(data: dict) -> list[ResourceAsset]:
    assets_data = data.get("assets", [])
    if not isinstance(assets_data, list):
        return []
    assets = []
    for asset_data in assets_data:
        if not isinstance(asset_data, dict):
            continue
        assets.append(
            ResourceAsset(
                name=asset_data.get("name", ""),
                path=asset_data.get("path"),
                url=asset_data.get("url"),
                sha256=asset_data.get("sha256"),
                size_bytes=asset_data.get("size_bytes"),
            )
        )
    return assets


def _parse_plugin_metadata(data: dict) -> PluginMetadata | None:
    plugin_data = data.get("plugin")
    if not plugin_data or not isinstance(plugin_data, dict):
        return None
    return PluginMetadata(
        min_client_version=plugin_data.get("min_client_version"),
        max_client_version=plugin_data.get("max_client_version"),
        api_version=plugin_data.get("api_version"),
        entry=plugin_data.get("entry"),
        dependencies=plugin_data.get("dependencies", []),
    )


def _parse_theme_metadata(data: dict) -> ThemeMetadata | None:
    theme_data = data.get("theme")
    if not theme_data or not isinstance(theme_data, dict):
        return None
    return ThemeMetadata(
        preview_url=theme_data.get("preview_url"),
    )


def parse_resource_metadata(data: dict) -> ResourceMetadata:
    return ResourceMetadata(
        type=data.get("type", "plugin"),
        id=data.get("id", ""),
        name=data.get("name", ""),
        version=data.get("version", "0.0.0"),
        summary=data.get("summary", ""),
        description_md=data.get("description_md", ""),
        protocol_version=data.get("protocol_version"),
        icon_url=data.get("icon_url"),
        icon_path=data.get("icon_path"),
        icon_data_uri=data.get("icon_data_uri"),
        icon_base64=data.get("icon_base64"),
        icon_mime=data.get("icon_mime"),
        download_url=data.get("download_url"),
        download_path=data.get("download_path"),
        assets=_parse_assets(data),
        homepage_url=data.get("homepage_url"),
        repository_url=data.get("repository_url"),
        license=data.get("license"),
        author=_parse_author(data),
        tags=data.get("tags", []),
        changelog_url=data.get("changelog_url"),
        plugin=_parse_plugin_metadata(data),
        theme=_parse_theme_metadata(data),
    )


async def _fetch_json(url: str, timeout_seconds: int = 12) -> Any:
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=timeout_seconds)
    ) as session:
        async with session.get(url) as response:
            response.raise_for_status()
            return await response.json(content_type=None)


async def _fetch_toml(url: str, timeout_seconds: int = 12) -> dict:
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=timeout_seconds)
    ) as session:
        async with session.get(url) as response:
            response.raise_for_status()
            content = await response.text()
            return rtoml.loads(content)


async def _list_resources_async(
    base_url: str,
    resource_type: Literal["theme", "resources", "plugins"],
) -> list[str]:
    url = f"{base_url.rstrip('/')}/{resource_type}/index.json"
    return await _fetch_json(url)


async def _get_resource_metadata_async(
    base_url: str,
    resource_type: Literal["theme", "resources", "plugins"],
    filename: str,
) -> ResourceMetadata:
    url = f"{base_url.rstrip('/')}/{resource_type}/{filename}"
    try:
        data = await _fetch_toml(url)
    except Exception:
        data = await _fetch_json(url)
    return parse_resource_metadata(data)


async def _get_all_resources_async(
    base_url: str,
    resource_type: Literal["theme", "resources", "plugins"],
) -> list[ResourceMetadata]:
    filenames = await _list_resources_async(base_url, resource_type)
    tasks = [
        _get_resource_metadata_async(base_url, resource_type, filename)
        for filename in filenames
    ]
    results: list[ResourceMetadata] = []
    for coro in asyncio.as_completed(tasks):
        try:
            metadata = await coro
            results.append(metadata)
        except Exception as exc:
            logger.error("store resource metadata fetch failed: {}", exc)
    return results


class StoreService:
    def list_resources(
        self, base_url: str | None = DEFAULT_STORE_URL
    ) -> dict[str, Any]:
        normalized_base_url = (
            base_url or DEFAULT_STORE_URL
        ).strip() or DEFAULT_STORE_URL
        candidates = [
            f"{normalized_base_url.rstrip('/')}/index.json",
            f"{normalized_base_url.rstrip('/')}/store/index.json",
            f"{normalized_base_url.rstrip('/')}/api/index.json",
        ]
        for url in candidates:
            try:
                payload = asyncio.run(_fetch_json(url))
                return {
                    "base_url": normalized_base_url,
                    "payload": payload,
                    "source_url": url,
                }
            except Exception:
                continue

        return {
            "base_url": normalized_base_url,
            "source_url": "mock://fallback",
            "payload": {
                "themes": [
                    {
                        "id": "aurora-paper",
                        "name": "Aurora Paper",
                        "description": "暖色纸感主题",
                        "type": "theme",
                    }
                ],
                "wallpaper_sources": [
                    {
                        "id": "builtin.bing_daily",
                        "name": "Bing 每日壁纸",
                        "description": "官方内置每日壁纸源",
                        "type": "wallpaper_source",
                    }
                ],
                "plugins": [
                    {
                        "id": "example.generator",
                        "name": "示例生成插件",
                        "description": "AI 生成页挂载示例",
                        "type": "plugin",
                    }
                ],
            },
        }

    def list_store_resources(
        self,
        resource_type: Literal["theme", "resources", "plugins"],
        base_url: str | None = DEFAULT_STORE_URL,
    ) -> list[dict[str, Any]]:
        normalized_base_url = (
            base_url or DEFAULT_STORE_URL
        ).strip() or DEFAULT_STORE_URL
        try:
            resources = asyncio.run(
                _get_all_resources_async(normalized_base_url, resource_type)
            )
            results = []
            for metadata in resources:
                result = metadata.to_dict()
                if (
                    metadata.icon_path
                    and not metadata.icon_data_uri
                    and not metadata.icon_url
                ):
                    result["icon_url"] = (
                        f"{normalized_base_url.rstrip('/')}/{metadata.icon_path}"
                    )
                dl_source, dl_type = metadata.get_download_source()
                if dl_type == "path" and dl_source:
                    result["download_url"] = (
                        f"{normalized_base_url.rstrip('/')}/{dl_source}"
                    )
                results.append(result)
            return results
        except Exception as exc:
            logger.error("list_store_resources failed: {}", exc)
            return []

    def get_store_resource(
        self,
        resource_type: Literal["theme", "resources", "plugins"],
        filename: str,
        base_url: str | None = DEFAULT_STORE_URL,
    ) -> dict[str, Any] | None:
        normalized_base_url = (
            base_url or DEFAULT_STORE_URL
        ).strip() or DEFAULT_STORE_URL
        try:
            metadata = asyncio.run(
                _get_resource_metadata_async(
                    normalized_base_url, resource_type, filename
                )
            )
            result = metadata.to_dict()
            if (
                metadata.icon_path
                and not metadata.icon_data_uri
                and not metadata.icon_url
            ):
                result["icon_url"] = (
                    f"{normalized_base_url.rstrip('/')}/{metadata.icon_path}"
                )
            dl_source, dl_type = metadata.get_download_source()
            if dl_type == "path" and dl_source:
                result["download_url"] = (
                    f"{normalized_base_url.rstrip('/')}/{dl_source}"
                )
            return result
        except Exception as exc:
            logger.error("get_store_resource failed: {}", exc)
            return None
