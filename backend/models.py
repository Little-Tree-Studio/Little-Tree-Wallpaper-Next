from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class WallpaperItem:
    id: str
    source_id: str
    source_name: str
    title: str
    image_url: str
    preview_url: str | None = None
    width: int | None = None
    height: int | None = None
    description: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class FavoriteItem:
    id: str
    folder_id: str
    title: str
    image_url: str
    preview_url: str | None
    source_id: str
    source_name: str
    created_at: str
    local_path: str | None = None
    localized: bool = False
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_wallpaper(cls, wallpaper: WallpaperItem, folder_id: str = "default") -> "FavoriteItem":
        return cls(
            id=wallpaper.id,
            folder_id=folder_id,
            title=wallpaper.title,
            image_url=wallpaper.image_url,
            preview_url=wallpaper.preview_url,
            source_id=wallpaper.source_id,
            source_name=wallpaper.source_name,
            created_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
            metadata=wallpaper.metadata,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class HistoryItem:
    id: str
    title: str
    image_url: str
    preview_url: str | None
    source_id: str
    source_name: str
    applied_at: str
    local_path: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class PluginRuntimeInfo:
    identifier: str
    name: str
    version: str
    description: str
    enabled: bool
    permissions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
