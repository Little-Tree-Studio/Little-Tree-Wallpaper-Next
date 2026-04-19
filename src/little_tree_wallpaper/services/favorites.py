from __future__ import annotations

import base64
import hashlib
import io
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Any, Literal
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

import orjson
from loguru import logger
from PIL import Image

try:
    import pillow_avif  # type: ignore[import-not-found]  # noqa: F401
except ImportError:  # pragma: no cover
    pillow_avif = None

from little_tree_wallpaper import __version__


EXPORT_PACKAGE_VERSION = 2
EXPORT_DATA_FILENAME = "favorites.json"
LOCALIZATION_NAMING_VERSION = 2
MAX_LOCALIZATION_PATH_LENGTH = 220
MAX_LOCALIZATION_FOLDER_LENGTH = 40
DEFAULT_LOCALIZATION_FILENAME_LENGTH = 110
MIN_LOCALIZATION_STEM_LENGTH = 24
MIN_LOCALIZATION_TITLE_LENGTH = 12


@dataclass(slots=True)
class FavoriteSource:
    type: str = "unknown"
    identifier: str = ""
    title: str = ""
    url: str | None = None
    preview_url: str | None = None
    local_path: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "identifier": self.identifier,
            "title": self.title,
            "url": self.url,
            "preview_url": self.preview_url,
            "local_path": self.local_path,
            "extra": dict(self.extra),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> FavoriteSource:
        payload = dict(data or {})
        return cls(
            type=str(payload.get("type", "unknown")),
            identifier=str(payload.get("identifier", "")),
            title=str(payload.get("title", "")),
            url=payload.get("url"),
            preview_url=payload.get("preview_url"),
            local_path=payload.get("local_path"),
            extra=dict(payload.get("extra") or {}),
        )


@dataclass(slots=True)
class FavoriteAIInfo:
    status: Literal["idle", "pending", "running", "completed", "failed"] = "idle"
    suggested_tags: list[str] = field(default_factory=list)
    suggested_folder_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    updated_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "suggested_tags": list(self.suggested_tags),
            "suggested_folder_id": self.suggested_folder_id,
            "metadata": dict(self.metadata),
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> FavoriteAIInfo:
        payload = dict(data or {})
        return cls(
            status=payload.get("status", "idle"),
            suggested_tags=list(payload.get("suggested_tags") or []),
            suggested_folder_id=payload.get("suggested_folder_id"),
            metadata=dict(payload.get("metadata") or {}),
            updated_at=payload.get("updated_at"),
        )


@dataclass(slots=True)
class FavoriteLocalizationInfo:
    status: Literal["absent", "pending", "completed", "failed"] = "absent"
    local_path: str | None = None
    folder_path: str | None = None
    updated_at: float | None = None
    message: str | None = None
    checksum: str | None = None
    file_size: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "local_path": self.local_path,
            "folder_path": self.folder_path,
            "updated_at": self.updated_at,
            "message": self.message,
            "checksum": self.checksum,
            "file_size": self.file_size,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> FavoriteLocalizationInfo:
        payload = dict(data or {})
        raw_size = payload.get("file_size")
        try:
            file_size = int(raw_size) if raw_size is not None else None
        except (TypeError, ValueError):
            file_size = None
        return cls(
            status=payload.get("status", "absent"),
            local_path=payload.get("local_path"),
            folder_path=payload.get("folder_path"),
            updated_at=payload.get("updated_at"),
            message=payload.get("message"),
            checksum=payload.get("checksum"),
            file_size=file_size,
        )


@dataclass(slots=True)
class FavoriteItem:
    id: str
    folder_id: str
    title: str
    description: str = ""
    tags: list[str] = field(default_factory=list)
    source: FavoriteSource = field(default_factory=FavoriteSource)
    preview_url: str | None = None
    local_path: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    ai: FavoriteAIInfo = field(default_factory=FavoriteAIInfo)
    localization: FavoriteLocalizationInfo = field(default_factory=FavoriteLocalizationInfo)
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "folder_id": self.folder_id,
            "title": self.title,
            "description": self.description,
            "tags": list(self.tags),
            "source": self.source.to_dict(),
            "preview_url": self.preview_url,
            "local_path": self.local_path,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "ai": self.ai.to_dict(),
            "localization": self.localization.to_dict(),
            "extra": dict(self.extra),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FavoriteItem:
        payload = dict(data or {})
        return cls(
            id=str(payload.get("id", "")),
            folder_id=str(payload.get("folder_id", "default")),
            title=str(payload.get("title", "未命名收藏")),
            description=str(payload.get("description", "")),
            tags=[str(tag) for tag in payload.get("tags") or []],
            source=FavoriteSource.from_dict(payload.get("source")),
            preview_url=payload.get("preview_url"),
            local_path=payload.get("local_path"),
            created_at=float(payload.get("created_at", time.time())),
            updated_at=float(payload.get("updated_at", time.time())),
            ai=FavoriteAIInfo.from_dict(payload.get("ai")),
            localization=FavoriteLocalizationInfo.from_dict(payload.get("localization")),
            extra=dict(payload.get("extra") or {}),
        )

    def touch(self) -> None:
        self.updated_at = time.time()


@dataclass(slots=True)
class FavoriteFolder:
    id: str
    name: str
    description: str = ""
    order: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "order": self.order,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FavoriteFolder:
        payload = dict(data or {})
        return cls(
            id=str(payload.get("id", "default")),
            name=str(payload.get("name", "收藏夹")),
            description=str(payload.get("description", "")),
            order=int(payload.get("order", 0)),
            created_at=float(payload.get("created_at", time.time())),
            updated_at=float(payload.get("updated_at", time.time())),
            metadata=dict(payload.get("metadata") or {}),
        )

    def touch(self) -> None:
        self.updated_at = time.time()


@dataclass(slots=True)
class FavoriteCollection:
    version: int = 2
    folders: dict[str, FavoriteFolder] = field(default_factory=dict)
    items: dict[str, FavoriteItem] = field(default_factory=dict)
    folder_order: list[str] = field(default_factory=list)

    def ensure_default_folder(self) -> FavoriteFolder:
        folder = self.folders.get("default")
        if folder is None:
            folder = FavoriteFolder(
                id="default",
                name="默认收藏夹",
                description="系统自动创建的默认收藏夹",
                order=0,
            )
            self.folders[folder.id] = folder
        if "default" not in self.folder_order:
            self.folder_order.insert(0, "default")
        self.normalize_orders()
        return folder

    def normalize_orders(self) -> None:
        normalized: list[str] = []
        for folder_id in self.folder_order:
            if folder_id in self.folders and folder_id not in normalized:
                normalized.append(folder_id)
        for folder_id in self.folders:
            if folder_id not in normalized:
                normalized.append(folder_id)
        self.folder_order = normalized
        for index, folder_id in enumerate(self.folder_order):
            folder = self.folders.get(folder_id)
            if folder is not None:
                folder.order = index

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "folders": {folder_id: folder.to_dict() for folder_id, folder in self.folders.items()},
            "items": {item_id: item.to_dict() for item_id, item in self.items.items()},
            "folder_order": list(self.folder_order),
        }


class FavoriteManager:
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self.file_path = self.root_dir / "favorites.json"
        self._lock = RLock()
        self._collection = FavoriteCollection()
        self.load()

    def load(self) -> None:
        with self._lock:
            if not self.file_path.exists():
                self._collection = FavoriteCollection()
                self._collection.ensure_default_folder()
                self.save()
                return
            try:
                payload = orjson.loads(self.file_path.read_bytes())
                self._collection = self._collection_from_payload(payload)
                self._collection.ensure_default_folder()
            except Exception as exc:
                logger.error("加载收藏数据失败: {}", exc)
                self._collection = FavoriteCollection()
                self._collection.ensure_default_folder()
                self.save()

    def save(self) -> None:
        with self._lock:
            self.root_dir.mkdir(parents=True, exist_ok=True)
            self.file_path.write_bytes(
                orjson.dumps(self._collection.to_dict(), option=orjson.OPT_INDENT_2)
            )

    def _collection_from_payload(self, payload: dict[str, Any]) -> FavoriteCollection:
        data = dict(payload or {})
        collection = FavoriteCollection(version=int(data.get("version", data.get("collection_version", 2))))

        raw_folders = data.get("folders") or {}
        if isinstance(raw_folders, list):
            for index, folder_payload in enumerate(raw_folders):
                if not isinstance(folder_payload, dict):
                    continue
                folder = FavoriteFolder(
                    id=str(folder_payload.get("id", f"folder-{index}")),
                    name=str(folder_payload.get("name", "收藏夹")),
                    description=str(folder_payload.get("description", "")),
                    order=index,
                )
                collection.folders[folder.id] = folder
        elif isinstance(raw_folders, dict):
            for folder_id, folder_payload in raw_folders.items():
                if isinstance(folder_payload, dict):
                    folder = FavoriteFolder.from_dict({**folder_payload, "id": str(folder_id)})
                    collection.folders[folder.id] = folder

        raw_items = data.get("items") or {}
        if isinstance(raw_items, list):
            for item_payload in raw_items:
                if isinstance(item_payload, dict):
                    item = self._migrate_legacy_item(item_payload)
                    collection.items[item.id] = item
        elif isinstance(raw_items, dict):
            for item_id, item_payload in raw_items.items():
                if isinstance(item_payload, dict):
                    item = FavoriteItem.from_dict({**item_payload, "id": str(item_id)})
                    if not item.source.identifier:
                        item.source.identifier = str(item.extra.get("source_id") or item.id)
                    if not item.source.title:
                        item.source.title = str(item.extra.get("source_name") or "收藏")
                    if not item.source.url:
                        item.source.url = item.local_path or item.localization.local_path
                    collection.items[item.id] = item

        raw_order = data.get("folder_order")
        if isinstance(raw_order, list):
            collection.folder_order = [str(folder_id) for folder_id in raw_order]
        else:
            collection.folder_order = sorted(
                collection.folders.keys(),
                key=lambda folder_id: collection.folders[folder_id].order,
            )

        collection.ensure_default_folder()
        for item in collection.items.values():
            if item.folder_id not in collection.folders:
                item.folder_id = "default"
            item.tags = self._normalize_tags(item.tags)
            item.source.extra = dict(item.source.extra)
            item.extra = dict(item.extra)
        return collection

    def _migrate_legacy_item(self, payload: dict[str, Any]) -> FavoriteItem:
        created_at = self._parse_timestamp(payload.get("created_at"))
        local_path = payload.get("local_path")
        preview_url = payload.get("preview_url")
        image_url = payload.get("image_url")
        metadata = dict(payload.get("metadata") or {})
        width = payload.get("width")
        height = payload.get("height")
        extra: dict[str, Any] = {
            "source_id": str(payload.get("source_id", payload.get("id", "favorite"))),
            "source_name": str(payload.get("source_name", "收藏")),
            "wallpaper_metadata": metadata,
        }
        if width is not None:
            extra["width"] = width
        if height is not None:
            extra["height"] = height
        if payload.get("localized"):
            extra["localized"] = True

        source = FavoriteSource(
            type="wallpaper",
            identifier=str(payload.get("source_id", payload.get("id", "favorite"))),
            title=str(payload.get("source_name", "收藏")),
            url=str(image_url) if image_url else None,
            preview_url=str(preview_url) if preview_url else None,
            local_path=str(local_path) if local_path else None,
            extra={},
        )
        localization = FavoriteLocalizationInfo()
        if local_path:
            localization.status = "completed"
            localization.local_path = str(local_path)
            localization.updated_at = created_at

        return FavoriteItem(
            id=str(payload.get("id", uuid.uuid4().hex)),
            folder_id=str(payload.get("folder_id", "default")),
            title=str(payload.get("title", "未命名收藏")),
            description=str(payload.get("description", "")),
            tags=self._normalize_tags(payload.get("tags") or []),
            source=source,
            preview_url=str(preview_url) if preview_url else None,
            local_path=str(local_path) if local_path else None,
            created_at=created_at,
            updated_at=created_at,
            localization=localization,
            extra=extra,
        )

    def _parse_timestamp(self, value: Any) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return time.time()
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            try:
                from datetime import datetime

                return datetime.fromisoformat(raw).timestamp()
            except ValueError:
                return time.time()
        return time.time()

    def _timestamp_to_iso(self, value: float | None) -> str | None:
        if value is None:
            return None
        from datetime import datetime, timezone

        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def _normalize_tags(self, tags: list[str] | tuple[str, ...] | set[str] | Any) -> list[str]:
        normalized: list[str] = []
        for tag in tags or []:
            value = str(tag).strip()
            if value and value not in normalized:
                normalized.append(value)
        return normalized

    def _resolve_folder_id(self, folder_id: str | None) -> str:
        if folder_id and folder_id in self._collection.folders:
            return folder_id
        self._collection.ensure_default_folder()
        return "default"

    def _folder_item_count(self, folder_id: str) -> int:
        return sum(1 for item in self._collection.items.values() if item.folder_id == folder_id)

    def _serialize_folder(self, folder: FavoriteFolder) -> dict[str, Any]:
        payload = folder.to_dict()
        payload["created_at"] = self._timestamp_to_iso(folder.created_at)
        payload["updated_at"] = self._timestamp_to_iso(folder.updated_at)
        payload["item_count"] = self._folder_item_count(folder.id)
        return payload

    def _extract_numeric(self, value: Any) -> int | None:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    def _looks_like_local_resource(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False
        candidate = value.strip()
        if not candidate:
            return False
        if candidate.startswith("file://"):
            return True
        if re.match(r"^[a-zA-Z]:[\\/]", candidate):
            return True
        if candidate.startswith("\\\\"):
            return True
        return Path(candidate).is_absolute()

    def _item_supports_localization(self, item: FavoriteItem) -> bool:
        if item.source.type == "local-file":
            return False
        candidates = [
            item.source.url,
            item.preview_url,
            item.source.preview_url,
        ]
        return any(candidate and not self._looks_like_local_resource(candidate) for candidate in candidates)

    def _local_favorite_id(self, path: Path) -> str:
        normalized = str(path.resolve()).lower()
        digest = hashlib.sha1(normalized.encode("utf-8", errors="ignore")).hexdigest()
        return f"local-{digest}"

    def _build_preview_data_url(self, image_path: Path) -> str | None:
        try:
            with Image.open(image_path) as image:
                preview = image.copy()
                preview.thumbnail((1280, 720))
                if preview.mode not in {"RGB", "L"}:
                    preview = preview.convert("RGB")

                buffer = io.BytesIO()
                preview.save(buffer, format="JPEG", quality=86, optimize=True)
                encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
                return f"data:image/jpeg;base64,{encoded}"
        except Exception as exc:
            logger.debug("build favorite preview failed: {}", exc)
            return None

    def _serialize_item(self, item: FavoriteItem) -> dict[str, Any]:
        metadata = dict(item.extra.get("wallpaper_metadata") or {})
        supports_localization = self._item_supports_localization(item)
        local_path = item.local_path or item.localization.local_path or item.source.local_path
        preview_data_url = None
        if local_path:
            preview_data_url = self._build_preview_data_url(Path(local_path))
        image_url = (
            item.local_path
            or item.localization.local_path
            or item.source.local_path
            or item.source.url
            or item.preview_url
            or item.source.preview_url
            or ""
        )
        preview_url = (
            item.local_path
            or item.localization.local_path
            or item.source.local_path
            or item.preview_url
            or item.source.preview_url
            or item.source.url
        )
        source_id = str(item.extra.get("source_id") or item.source.identifier or f"favorite:{item.id}")
        source_name = str(item.extra.get("source_name") or item.source.title or "收藏")
        width = self._extract_numeric(item.extra.get("width") or metadata.get("width"))
        height = self._extract_numeric(item.extra.get("height") or metadata.get("height"))
        return {
            "id": item.id,
            "folder_id": item.folder_id,
            "title": item.title,
            "description": item.description,
            "image_url": image_url,
            "preview_url": preview_data_url or preview_url,
            "width": width,
            "height": height,
            "source_id": source_id,
            "source_name": source_name,
            "created_at": self._timestamp_to_iso(item.created_at),
            "updated_at": self._timestamp_to_iso(item.updated_at),
            "local_path": local_path,
            "localized": item.localization.status == "completed",
            "is_local_source": not supports_localization,
            "can_localize": supports_localization,
            "localization_status": item.localization.status,
            "localization_updated_at": self._timestamp_to_iso(item.localization.updated_at),
            "localization_message": item.localization.message,
            "localization_file_size": item.localization.file_size,
            "tags": list(item.tags),
            "metadata": metadata,
        }

    def list_items(self, folder_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            self._collection.ensure_default_folder()
            items = list(self._collection.items.values())
            if folder_id and folder_id != "__all__":
                items = [item for item in items if item.folder_id == folder_id]
            items.sort(key=lambda item: item.updated_at, reverse=True)
            folders = [
                self._collection.folders[folder_id]
                for folder_id in self._collection.folder_order
                if folder_id in self._collection.folders
            ]
            return {
                "version": self._collection.version,
                "folder_order": list(self._collection.folder_order),
                "folders": [self._serialize_folder(folder) for folder in folders],
                "items": [self._serialize_item(item) for item in items],
            }

    def contains(self, wallpaper_id: str) -> bool:
        with self._lock:
            return str(wallpaper_id) in self._collection.items

    def toggle(self, wallpaper: dict[str, Any], folder_id: str = "default") -> dict[str, Any]:
        wallpaper_id = str(wallpaper.get("id", "")).strip()
        if not wallpaper_id:
            raise ValueError("缺少收藏项 id")
        with self._lock:
            if wallpaper_id in self._collection.items:
                del self._collection.items[wallpaper_id]
                self.save()
                return {"liked": False, "favorites": self.list_items()}

            resolved_folder_id = self._resolve_folder_id(folder_id)
            metadata = dict(wallpaper.get("metadata") or {})
            local_path = wallpaper.get("local_path")
            image_url = str(wallpaper.get("image_url", "")).strip() or None
            preview_url = wallpaper.get("preview_url")
            local_source = bool(local_path) or self._looks_like_local_resource(image_url) or self._looks_like_local_resource(preview_url)
            source = FavoriteSource(
                type="local-file" if local_source else "wallpaper",
                identifier=str(wallpaper.get("source_id", wallpaper_id)),
                title=str(wallpaper.get("source_name", "收藏")),
                url=image_url,
                preview_url=str(preview_url) if preview_url else None,
                local_path=str(local_path) if local_path else None,
                extra={},
            )

            item = FavoriteItem(
                id=wallpaper_id,
                folder_id=resolved_folder_id,
                title=str(wallpaper.get("title", "未命名收藏")),
                description=str(wallpaper.get("description", "")),
                source=source,
                preview_url=str(preview_url) if preview_url else None,
                local_path=str(local_path) if local_path else None,
                tags=self._normalize_tags(wallpaper.get("tags") or []),
                localization=FavoriteLocalizationInfo(),
                extra={
                    "source_id": str(wallpaper.get("source_id", wallpaper_id)),
                    "source_name": str(wallpaper.get("source_name", "收藏")),
                    "wallpaper_metadata": metadata,
                    "width": wallpaper.get("width"),
                    "height": wallpaper.get("height"),
                },
            )
            self._collection.items[item.id] = item
            self.save()
            return {"liked": True, "favorites": self.list_items()}

    def add_local_images(
        self,
        paths: list[str] | tuple[str, ...],
        folder_id: str = "default",
    ) -> tuple[int, dict[str, Any]]:
        added_count = 0
        with self._lock:
            resolved_folder_id = self._resolve_folder_id(folder_id)
            for raw_path in paths:
                source_path = Path(str(raw_path)).expanduser().resolve()
                if not source_path.exists() or not source_path.is_file():
                    continue
                item_id = self._local_favorite_id(source_path)
                if item_id in self._collection.items:
                    item = self._collection.items[item_id]
                    item.folder_id = resolved_folder_id
                    item.title = source_path.stem or item.title
                    item.local_path = str(source_path)
                    item.preview_url = str(source_path)
                    item.source.type = "local-file"
                    item.source.identifier = "local.file"
                    item.source.title = "本地图片"
                    item.source.url = str(source_path)
                    item.source.preview_url = str(source_path)
                    item.source.local_path = str(source_path)
                    item.localization = FavoriteLocalizationInfo()
                    item.touch()
                    continue

                item = FavoriteItem(
                    id=item_id,
                    folder_id=resolved_folder_id,
                    title=source_path.stem or source_path.name,
                    source=FavoriteSource(
                        type="local-file",
                        identifier="local.file",
                        title="本地图片",
                        url=str(source_path),
                        preview_url=str(source_path),
                        local_path=str(source_path),
                        extra={},
                    ),
                    preview_url=str(source_path),
                    local_path=str(source_path),
                    localization=FavoriteLocalizationInfo(),
                    extra={
                        "source_id": "local.file",
                        "source_name": "本地图片",
                        "wallpaper_metadata": {"local_source": True},
                    },
                )
                self._collection.items[item.id] = item
                added_count += 1

            if added_count or paths:
                self.save()
            return added_count, self.list_items()

    def create_folder(self, name: str, description: str = "") -> FavoriteFolder:
        normalized_name = name.strip() or "未命名收藏夹"
        with self._lock:
            folder = FavoriteFolder(
                id=uuid.uuid4().hex,
                name=normalized_name,
                description=description.strip(),
                order=len(self._collection.folder_order),
            )
            self._collection.folders[folder.id] = folder
            self._collection.folder_order.append(folder.id)
            self._collection.normalize_orders()
            self.save()
            return folder

    def rename_folder(self, folder_id: str, *, name: str | None = None, description: str | None = None) -> bool:
        with self._lock:
            folder = self._collection.folders.get(folder_id)
            if folder is None:
                return False
            if name is not None and name.strip():
                folder.name = name.strip()
            if description is not None:
                folder.description = description.strip()
            folder.touch()
            self.save()
            return True

    def delete_folder(self, folder_id: str, *, move_items_to: str | None = "default") -> bool:
        if folder_id == "default":
            return False
        with self._lock:
            if folder_id not in self._collection.folders:
                return False
            destination = self._resolve_folder_id(move_items_to)
            for item in self._collection.items.values():
                if item.folder_id == folder_id:
                    item.folder_id = destination
                    item.touch()
            del self._collection.folders[folder_id]
            self._collection.folder_order = [candidate for candidate in self._collection.folder_order if candidate != folder_id]
            self._collection.ensure_default_folder()
            self.save()
            return True

    def move_item(self, item_id: str, folder_id: str) -> bool:
        with self._lock:
            item = self._collection.items.get(item_id)
            if item is None:
                return False
            item.folder_id = self._resolve_folder_id(folder_id)
            item.touch()
            self.save()
            return True

    def get_item(self, item_id: str) -> FavoriteItem | None:
        with self._lock:
            item = self._collection.items.get(item_id)
            if item is None:
                return None
            return FavoriteItem.from_dict(item.to_dict())

    def reorder_folders(self, ordered_ids: list[str] | tuple[str, ...]) -> bool:
        with self._lock:
            unique_ids: list[str] = []
            for folder_id in ordered_ids:
                if folder_id in self._collection.folders and folder_id not in unique_ids:
                    unique_ids.append(folder_id)
            for folder_id in self._collection.folder_order:
                if folder_id not in unique_ids:
                    unique_ids.append(folder_id)
            self._collection.folder_order = unique_ids
            self._collection.normalize_orders()
            self.save()
            return True

    def localization_root(self) -> Path:
        root = (self.root_dir / "localized").resolve()
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _is_managed_localization_path(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.localization_root())
            return True
        except ValueError:
            return False

    def _sanitize_segment(self, value: str, fallback: str) -> str:
        normalized = re.sub(r"[\\/:*?\"<>|]+", "-", value.strip())
        normalized = re.sub(r"\s+", "-", normalized)
        sanitized = normalized.strip("-._")
        return sanitized or fallback

    def _truncate_segment(self, value: str, max_length: int, fallback: str) -> str:
        sanitized = self._sanitize_segment(value, fallback)
        if max_length <= 0:
            return fallback
        if len(sanitized) <= max_length:
            return sanitized
        if max_length <= 8:
            shortened = sanitized[:max_length].strip("-._")
            return shortened or fallback[:max_length]
        digest = hashlib.sha1(sanitized.encode("utf-8", errors="ignore")).hexdigest()[:8]
        head_length = max(1, max_length - len(digest) - 1)
        shortened = f"{sanitized[:head_length]}-{digest}".strip("-._")
        return shortened[:max_length].strip("-._") or fallback[:max_length]

    def _localization_source_segment(self, item: FavoriteItem) -> str:
        raw_source = str(
            item.extra.get("source_id")
            or item.source.identifier
            or item.source.title
            or "source"
        ).strip()
        if raw_source.startswith("builtin."):
            raw_source = raw_source[len("builtin.") :]
        return self._truncate_segment(raw_source or "source", 24, "source")

    def _localization_checksum_segment(self, checksum: str | None, item_id: str) -> str:
        normalized = (checksum or "").strip().lower()
        if normalized:
            return normalized[:8]
        return hashlib.sha1(item_id.encode("utf-8", errors="ignore")).hexdigest()[:8]

    def _localization_filename_budget(self, folder_segment: str, suffix: str) -> int:
        try:
            target_dir = (self.localization_root() / folder_segment).resolve()
        except OSError:
            target_dir = self.localization_root() / folder_segment
        available = MAX_LOCALIZATION_PATH_LENGTH - len(str(target_dir)) - 1
        return max(MIN_LOCALIZATION_STEM_LENGTH + len(suffix), min(DEFAULT_LOCALIZATION_FILENAME_LENGTH, available))

    def _localization_folder_segment(self, folder_id: str) -> str:
        folder = self._collection.folders.get(folder_id)
        base = folder.name if folder else folder_id
        return self._truncate_segment(
            base or folder_id or "folder",
            MAX_LOCALIZATION_FOLDER_LENGTH,
            folder_id or "folder",
        )

    def _localization_filename(
        self,
        item: FavoriteItem,
        source_path: Path | None,
        *,
        checksum: str | None = None,
        folder_segment: str | None = None,
    ) -> str:
        suffix = source_path.suffix if source_path and source_path.suffix else ".bin"
        suffix = suffix.lower()
        resolved_folder_segment = folder_segment or self._localization_folder_segment(item.folder_id)
        item_segment = self._truncate_segment(item.id[:8] or item.id or "favorite", 8, "favorite")
        source_segment = self._localization_source_segment(item)
        checksum_segment = self._localization_checksum_segment(
            checksum or item.localization.checksum,
            item.id,
        )
        filename_budget = self._localization_filename_budget(resolved_folder_segment, suffix)
        stem_budget = max(MIN_LOCALIZATION_STEM_LENGTH, filename_budget - len(suffix))
        reserved_stem = len(source_segment) + len(item_segment) + len(checksum_segment) + 6
        if stem_budget <= reserved_stem:
            return f"{item_segment}__{checksum_segment}{suffix}"

        title_seed = item.title or (source_path.stem if source_path else "favorite")
        if stem_budget < reserved_stem + MIN_LOCALIZATION_TITLE_LENGTH:
            source_budget = max(10, stem_budget - len(item_segment) - len(checksum_segment) - MIN_LOCALIZATION_TITLE_LENGTH - 6)
            source_segment = self._truncate_segment(source_segment, source_budget, "source")
            reserved_stem = len(source_segment) + len(item_segment) + len(checksum_segment) + 6

        title_budget = max(MIN_LOCALIZATION_TITLE_LENGTH, stem_budget - reserved_stem)
        title_segment = self._truncate_segment(title_seed, title_budget, item_segment)
        return f"{title_segment}__{source_segment}__{item_segment}__{checksum_segment}{suffix}"

    def _compute_file_checksum(self, path: Path) -> str:
        hasher = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                if chunk:
                    hasher.update(chunk)
        return hasher.hexdigest()

    def update_localization(
        self,
        item_id: str,
        *,
        status: Literal["absent", "pending", "completed", "failed"],
        local_path: str | None = None,
        folder_path: str | None = None,
        message: str | None = None,
        checksum: str | None = None,
        file_size: int | None = None,
    ) -> bool:
        with self._lock:
            item = self._collection.items.get(item_id)
            if item is None:
                return False
            item.localization.status = status
            item.localization.local_path = local_path
            item.localization.folder_path = folder_path
            item.localization.message = message
            item.localization.checksum = checksum
            item.localization.file_size = file_size
            item.localization.updated_at = time.time()
            if local_path:
                item.local_path = local_path
                item.source.local_path = local_path
            item.touch()
            self.save()
            return True

    def localize_item_from_file(self, item_id: str, source_path: str) -> Path | None:
        source = Path(source_path).expanduser().resolve()
        if not source.exists():
            return None
        checksum = None
        file_size = None
        try:
            checksum = self._compute_file_checksum(source)
        except OSError:
            checksum = None
        try:
            file_size = source.stat().st_size
        except OSError:
            file_size = None
        with self._lock:
            item = self._collection.items.get(item_id)
            if item is None:
                return None
            folder_segment = self._localization_folder_segment(item.folder_id)
            filename = self._localization_filename(
                item,
                source,
                checksum=checksum,
                folder_segment=folder_segment,
            )
            previous_localized_path = item.localization.local_path
        target_dir = self.localization_root() / folder_segment
        target_dir.mkdir(parents=True, exist_ok=True)
        destination = (target_dir / filename).resolve()
        try:
            same_destination = source == destination
            if not same_destination:
                should_copy = True
                if destination.exists() and checksum:
                    try:
                        should_copy = self._compute_file_checksum(destination) != checksum
                    except OSError:
                        should_copy = True
                if should_copy:
                    shutil.copy2(source, destination)
        except Exception as exc:
            logger.error("复制收藏资源失败: {}", exc)
            self.update_localization(
                item_id,
                status="failed",
                local_path=None,
                folder_path=folder_segment,
                message=str(exc),
            )
            return None
        if previous_localized_path:
            old_candidate = Path(previous_localized_path)
            if old_candidate != destination and old_candidate.exists() and self._is_managed_localization_path(old_candidate):
                try:
                    old_candidate.unlink()
                except OSError as exc:
                    logger.debug("skip stale localized favorite cleanup: {}", exc)
        self.update_localization(
            item_id,
            status="completed",
            local_path=str(destination),
            folder_path=folder_segment,
            checksum=checksum,
            file_size=file_size,
        )
        return destination

    def reset_localization(self, item_id: str, *, remove_file: bool = True) -> bool:
        with self._lock:
            item = self._collection.items.get(item_id)
            if item is None:
                return False
            localized_path = item.localization.local_path or item.local_path or item.source.local_path
            item.localization = FavoriteLocalizationInfo()
            if item.source.local_path and localized_path and item.source.local_path == localized_path:
                item.source.local_path = None
            if item.local_path and localized_path and item.local_path == localized_path:
                item.local_path = None
            item.touch()
            self.save()

        if remove_file and localized_path:
            candidate = Path(localized_path)
            if candidate.exists() and self._is_managed_localization_path(candidate):
                try:
                    candidate.unlink()
                except OSError as exc:
                    logger.warning("删除收藏本地化文件失败: {}", exc)
        return True

    def clear_managed_localizations(self) -> tuple[int, int, int]:
        root = self.localization_root()
        removed_files = 0
        freed_bytes = 0
        if root.exists():
            for candidate in root.rglob("*"):
                if not candidate.is_file():
                    continue
                removed_files += 1
                try:
                    freed_bytes += candidate.stat().st_size
                except OSError:
                    continue

        updated_items = 0
        with self._lock:
            for item in self._collection.items.values():
                localized_path = (
                    item.localization.local_path
                    or item.local_path
                    or item.source.local_path
                )
                if not localized_path:
                    continue
                try:
                    candidate = Path(localized_path).expanduser().resolve()
                except OSError:
                    continue
                if not self._is_managed_localization_path(candidate):
                    continue
                item.localization = FavoriteLocalizationInfo()
                if item.local_path and Path(item.local_path).expanduser().resolve() == candidate:
                    item.local_path = None
                if item.source.local_path and Path(item.source.local_path).expanduser().resolve() == candidate:
                    item.source.local_path = None
                item.touch()
                updated_items += 1

            if updated_items:
                self.save()

        if root.exists():
            for child in list(root.iterdir()):
                try:
                    if child.is_dir() and not child.is_symlink():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
                except FileNotFoundError:
                    continue
                except OSError as exc:
                    logger.warning("清理收藏本地化目录失败: {}", exc)
        root.mkdir(parents=True, exist_ok=True)
        return (removed_files, freed_bytes, updated_items)

    def replace_localization_file(
        self,
        old_path: str | Path,
        new_path: str | Path,
    ) -> bool:
        old_candidate = Path(old_path).expanduser().resolve()
        new_candidate = Path(new_path).expanduser().resolve()
        if not self._is_managed_localization_path(old_candidate):
            return False

        checksum = None
        file_size = None
        try:
            checksum = self._compute_file_checksum(new_candidate)
        except OSError:
            checksum = None
        try:
            file_size = new_candidate.stat().st_size
        except OSError:
            file_size = None

        updated = False
        with self._lock:
            for item in self._collection.items.values():
                localized_path = item.localization.local_path
                if not localized_path:
                    continue
                try:
                    resolved_localized_path = Path(localized_path).expanduser().resolve()
                except OSError:
                    continue
                if resolved_localized_path != old_candidate:
                    continue

                item.localization.status = "completed"
                item.localization.local_path = str(new_candidate)
                item.localization.checksum = checksum
                item.localization.file_size = file_size
                item.localization.updated_at = time.time()
                if item.local_path and Path(item.local_path).expanduser().resolve() == old_candidate:
                    item.local_path = str(new_candidate)
                if item.source.local_path and Path(item.source.local_path).expanduser().resolve() == old_candidate:
                    item.source.local_path = str(new_candidate)
                item.touch()
                updated = True

            if updated:
                self.save()
        return updated

    def _sanitize_import_item_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        sanitized = dict(payload or {})
        sanitized["local_path"] = None

        source_payload = dict(sanitized.get("source") or {})
        source_payload["local_path"] = None
        source_extra = dict(source_payload.get("extra") or {})
        source_extra.pop("original_path", None)
        source_extra.pop("imported_from", None)
        source_payload["extra"] = source_extra
        sanitized["source"] = source_payload

        localization_payload = dict(sanitized.get("localization") or {})
        folder_path = localization_payload.get("folder_path")
        if isinstance(folder_path, str):
            normalized_folder = folder_path.replace("\\", "/").strip("/")
            folder_obj = Path(normalized_folder)
            if folder_obj.is_absolute() or any(part == ".." for part in folder_obj.parts):
                localization_payload["folder_path"] = None
            else:
                localization_payload["folder_path"] = folder_obj.as_posix() or None
        else:
            localization_payload["folder_path"] = None

        local_path = localization_payload.get("local_path")
        if isinstance(local_path, str):
            normalized_local = local_path.replace("\\", "/").lstrip("/")
            local_obj = Path(normalized_local)
            if local_obj.is_absolute() or any(part == ".." for part in local_obj.parts):
                localization_payload["local_path"] = None
            else:
                localization_payload["local_path"] = local_obj.as_posix()
        else:
            localization_payload["local_path"] = None

        sanitized["localization"] = localization_payload
        extra_payload = dict(sanitized.get("extra") or {})
        extra_payload.pop("original_path", None)
        extra_payload.pop("imported_from", None)
        sanitized["extra"] = extra_payload
        sanitized["folder_id"] = str(sanitized.get("folder_id", "default"))
        sanitized["title"] = str(sanitized.get("title", "未命名收藏"))
        sanitized["description"] = str(sanitized.get("description", ""))
        return sanitized

    def _prepare_export(
        self,
        folder_ids: list[str] | tuple[str, ...] | None,
        include_assets: bool = True,
        *,
        item_ids: list[str] | tuple[str, ...] | None = None,
    ) -> tuple[dict[str, Any], list[tuple[Path, str]], int, int]:
        item_ids_set = {str(item_id) for item_id in item_ids} if item_ids else None
        with self._lock:
            if item_ids_set is None:
                if not folder_ids or "__all__" in folder_ids:
                    selected_folder_ids = list(self._collection.folders.keys())
                else:
                    selected_folder_ids = [folder_id for folder_id in folder_ids if folder_id in self._collection.folders]
                if not selected_folder_ids:
                    selected_folder_ids = ["default"]
                selected_folder_set = set(selected_folder_ids)
            else:
                selected_folder_ids = []
                selected_folder_set: set[str] = set()

            item_payload: dict[str, dict[str, Any]] = {}
            asset_plan: list[tuple[Path, str]] = []
            planned_assets: set[tuple[str, str]] = set()
            timestamp = time.time()

            for item_id, item in self._collection.items.items():
                if item_ids_set is not None:
                    if item_id not in item_ids_set:
                        continue
                elif item.folder_id not in selected_folder_set:
                    continue

                data = item.to_dict()
                folder_segment = self._localization_folder_segment(item.folder_id)
                data["local_path"] = None
                source_payload = dict(data.get("source") or {})
                source_payload["local_path"] = None
                data["source"] = source_payload
                localization_payload = dict(data.get("localization") or {})
                localization_payload["folder_path"] = folder_segment
                localization_payload.pop("message", None)
                localization_payload["local_path"] = None
                localization_payload.pop("checksum", None)
                localization_payload.pop("file_size", None)

                asset_source: Path | None = None
                if include_assets:
                    for candidate in (item.localization.local_path, item.local_path, item.source.local_path):
                        if candidate and Path(candidate).exists():
                            asset_source = Path(candidate)
                            break

                if include_assets and asset_source is not None:
                    asset_checksum = item.localization.checksum
                    if not asset_checksum:
                        try:
                            asset_checksum = self._compute_file_checksum(asset_source)
                        except OSError:
                            asset_checksum = None
                    filename = self._localization_filename(
                        item,
                        asset_source,
                        checksum=asset_checksum,
                        folder_segment=folder_segment,
                    )
                    relative_path = (Path("assets") / folder_segment / filename).as_posix()
                    localization_payload["local_path"] = relative_path
                    localization_payload["status"] = localization_payload.get("status") or "completed"
                    try:
                        localization_payload["checksum"] = asset_checksum or self._compute_file_checksum(asset_source)
                    except OSError:
                        localization_payload.pop("checksum", None)
                    try:
                        localization_payload["file_size"] = asset_source.stat().st_size
                    except OSError:
                        localization_payload.pop("file_size", None)
                    asset_key = (str(asset_source.resolve()), relative_path)
                    if asset_key not in planned_assets:
                        asset_plan.append((asset_source, relative_path))
                        planned_assets.add(asset_key)

                data["localization"] = localization_payload
                item_payload[item_id] = data
                selected_folder_set.add(item.folder_id)

            if item_ids_set is not None and not item_payload:
                raise ValueError("指定的收藏不存在或已被移除。")

            folder_payload = {
                folder_id: self._collection.folders[folder_id].to_dict()
                for folder_id in selected_folder_set
                if folder_id in self._collection.folders
            }
            order_payload = [folder_id for folder_id in self._collection.folder_order if folder_id in selected_folder_set]
            export_data = {
                "package_version": EXPORT_PACKAGE_VERSION,
                "app_version": __version__,
                "exported_at": timestamp,
                "include_assets": include_assets,
                "collection_version": self._collection.version,
                "folders": folder_payload,
                "items": item_payload,
                "folder_order": order_payload,
            }
            if selected_folder_set:
                export_data["selected_folders"] = sorted(selected_folder_set)
            if item_ids_set is not None:
                export_data["selected_items"] = sorted(item_ids_set)
            return export_data, asset_plan, len(folder_payload), len(item_payload)

    def _build_export_package(
        self,
        target_path: Path,
        export_data: dict[str, Any],
        asset_plan: list[tuple[Path, str]],
    ) -> Path:
        package_path = Path(target_path)
        if package_path.is_dir():
            package_path = package_path / "favorites.ltwfav"
        if package_path.suffix.lower() not in {".ltwfav", ".zip"}:
            package_path = package_path.with_suffix(".ltwfav")
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            for source, relative_path in asset_plan:
                destination = temp_root / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copy2(source, destination)
                except Exception as exc:
                    logger.warning("导出收藏资源失败: {}", exc)
            json_path = temp_root / EXPORT_DATA_FILENAME
            json_path.write_bytes(orjson.dumps(export_data, option=orjson.OPT_INDENT_2))
            package_path.parent.mkdir(parents=True, exist_ok=True)
            with ZipFile(package_path, "w", compression=ZIP_DEFLATED) as handle:
                for entry in temp_root.rglob("*"):
                    handle.write(entry, entry.relative_to(temp_root))
        return package_path

    def export_selection(
        self,
        target_path: Path,
        *,
        folder_ids: list[str] | tuple[str, ...] | None = None,
        item_ids: list[str] | tuple[str, ...] | None = None,
        include_assets: bool = True,
    ) -> dict[str, Any]:
        export_data, asset_plan, folder_count, item_count = self._prepare_export(
            folder_ids,
            include_assets=include_assets,
            item_ids=item_ids,
        )
        package_path = self._build_export_package(target_path, export_data, asset_plan)
        return {
            "saved_path": str(package_path),
            "folder_count": folder_count,
            "item_count": item_count,
            "include_assets": include_assets,
        }

    def import_folders(self, source_path: Path) -> tuple[int, int]:
        source_path = Path(source_path)
        if not source_path.exists():
            raise FileNotFoundError(str(source_path))
        source_descriptor = str(source_path.resolve())
        temp_dir = tempfile.TemporaryDirectory()
        temp_root = Path(temp_dir.name)
        try:
            if source_path.is_dir():
                for entry in source_path.rglob("*"):
                    destination = temp_root / entry.relative_to(source_path)
                    if entry.is_dir():
                        destination.mkdir(parents=True, exist_ok=True)
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(entry, destination)
                json_path = temp_root / EXPORT_DATA_FILENAME
            elif source_path.suffix.lower() == ".json":
                json_path = source_path
                temp_root = source_path.parent.resolve()
            else:
                try:
                    with ZipFile(source_path, "r") as handle:
                        handle.extractall(temp_root)
                except BadZipFile as exc:
                    raise ValueError("导入文件不是有效的收藏包") from exc
                json_path = temp_root / EXPORT_DATA_FILENAME

            fallback_path = temp_root / "favorites.json"
            if not json_path.exists() and fallback_path.exists():
                json_path = fallback_path
            if not json_path.exists():
                raise FileNotFoundError("导入包缺少 favorites.json")

            payload = orjson.loads(json_path.read_bytes())
            package_version = int(payload.get("package_version", 1))
            exported_at = payload.get("exported_at")
            include_assets_flag = bool(payload.get("include_assets", False))
            folders_data = dict(payload.get("folders") or {})
            items_data_raw = dict(payload.get("items") or {})

            sanitized_items: dict[str, dict[str, Any]] = {}
            for original_id, raw_item in items_data_raw.items():
                if isinstance(raw_item, dict):
                    sanitized_items[str(original_id)] = self._sanitize_import_item_payload(raw_item)

            assets_root = (temp_root / "assets").resolve()
            include_assets_flag = include_assets_flag or assets_root.exists()
            created_folders = 0
            imported_items = 0
            folder_mapping: dict[str, str] = {}
            item_mapping: dict[str, str] = {}

            with self._lock:
                for original_id, folder_payload in folders_data.items():
                    if not isinstance(folder_payload, dict):
                        continue
                    original_id_str = str(original_id)
                    target_id = None
                    for existing_id, existing_folder in self._collection.folders.items():
                        if existing_folder.name == folder_payload.get("name"):
                            target_id = existing_id
                            existing_folder.description = str(folder_payload.get("description", existing_folder.description))
                            existing_folder.metadata.update(dict(folder_payload.get("metadata") or {}))
                            existing_folder.touch()
                            break
                    if target_id is None:
                        target_id = uuid.uuid4().hex
                        new_folder = FavoriteFolder.from_dict(folder_payload)
                        new_folder.id = target_id
                        new_folder.created_at = time.time()
                        new_folder.updated_at = new_folder.created_at
                        self._collection.folders[target_id] = new_folder
                        self._collection.folder_order.append(target_id)
                        created_folders += 1
                    folder_mapping[original_id_str] = target_id

                for original_id, item_payload in sanitized_items.items():
                    source_folder_id = str(item_payload.get("folder_id", "default"))
                    target_folder_id = folder_mapping.get(source_folder_id, "default")
                    new_item = FavoriteItem.from_dict(item_payload)
                    new_item.id = uuid.uuid4().hex
                    new_item.folder_id = target_folder_id
                    now = time.time()
                    new_item.created_at = now
                    new_item.updated_at = now
                    new_item.localization = FavoriteLocalizationInfo()
                    new_item.local_path = None
                    new_item.extra["imported_from"] = {
                        "package_version": package_version,
                        "source": source_descriptor,
                        "include_assets": include_assets_flag,
                        "exported_at": exported_at,
                        "imported_at": now,
                    }
                    if not new_item.source.identifier:
                        new_item.source.identifier = str(new_item.extra.get("source_id") or original_id)
                    if not new_item.source.title:
                        new_item.source.title = str(new_item.extra.get("source_name") or "导入收藏")
                    self._collection.items[new_item.id] = new_item
                    item_mapping[original_id] = new_item.id
                    imported_items += 1

                self._collection.ensure_default_folder()
                self.save()

            temp_root_real = temp_root.resolve()
            for original_id, new_id in item_mapping.items():
                item_payload = sanitized_items.get(original_id) or {}
                localization_payload = dict(item_payload.get("localization") or {})
                relative_path = localization_payload.get("local_path")
                if not relative_path:
                    continue
                asset_candidate = (temp_root / str(relative_path)).resolve()
                try:
                    asset_candidate.relative_to(temp_root_real)
                except ValueError:
                    logger.warning("导入收藏时检测到不安全资源路径: {}", relative_path)
                    continue
                if asset_candidate.exists():
                    self.localize_item_from_file(new_id, str(asset_candidate))
                else:
                    logger.warning("导入收藏缺少资源文件: {}", relative_path)

            return created_folders, imported_items
        finally:
            temp_dir.cleanup()


__all__ = [
    "FavoriteAIInfo",
    "FavoriteCollection",
    "FavoriteFolder",
    "FavoriteItem",
    "FavoriteLocalizationInfo",
    "FavoriteManager",
    "FavoriteSource",
]
