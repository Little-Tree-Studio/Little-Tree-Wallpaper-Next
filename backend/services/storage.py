from __future__ import annotations

import contextlib
import json
import os
import shutil
import sys
import threading
import uuid
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from loguru import logger

from backend.paths import BASE_DIR, get_cache_dir, get_config_dir, get_data_dir

IMAGE_EXTENSIONS = {
    ".avif",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}


class StorageService:
    _compressed_size_getter: Any | None = None

    def __init__(
        self,
        settings_store: Any,
        downloads_dir: Callable[[], Path],
        favorites_path: Callable[[], Path],
        protected_paths: Callable[[], set[Path]],
    ) -> None:
        self.store = settings_store
        self._downloads_dir = downloads_dir
        self._favorites_path = favorites_path
        self._protected_paths = protected_paths
        self._maintenance_lock = threading.Lock()
        self._operation_lock = threading.RLock()
        self._maintenance_started = False
        self._manifest_path = get_data_dir() / "storage_downloads.json"
        self.remember_current_download_root()
        self._adopt_default_downloads()

    @staticmethod
    def _normalized(path: Path | str) -> Path:
        return Path(os.path.normcase(os.path.abspath(str(path))))

    @staticmethod
    def _scan_files(paths: Iterable[Path], excluded_dirs: set[Path] | None = None) -> tuple[int, int]:
        size, count, _ = StorageService._scan_files_by_disk(paths, excluded_dirs)
        return size, count

    @staticmethod
    def _scan_files_by_disk(
        paths: Iterable[Path], excluded_dirs: set[Path] | None = None
    ) -> tuple[int, int, dict[str, int]]:
        excluded = {StorageService._normalized(path) for path in (excluded_dirs or set())}
        size = 0
        count = 0
        disk_bytes: dict[str, int] = {}
        mount_cache: dict[Path, str] = {}

        def add_file(path: Path) -> None:
            nonlocal size, count
            allocated = StorageService._allocated_size(path)
            parent = path.parent
            disk = mount_cache.get(parent)
            if disk is None:
                disk = str(StorageService._disk_root(path))
                mount_cache[parent] = disk
            size += allocated
            count += 1
            disk_bytes[disk] = disk_bytes.get(disk, 0) + allocated

        for root in paths:
            if not root.exists():
                continue
            if root.is_file():
                with contextlib.suppress(OSError):
                    add_file(root)
                continue
            for current, dirs, files in os.walk(root, followlinks=False):
                current_path = StorageService._normalized(current)
                dirs[:] = [
                    name
                    for name in dirs
                    if not (Path(current, name).is_symlink() or StorageService._normalized(Path(current, name)) in excluded)
                ]
                if current_path in excluded:
                    dirs[:] = []
                    continue
                for name in files:
                    path = Path(current, name)
                    if path.is_symlink():
                        continue
                    with contextlib.suppress(OSError):
                        add_file(path)
        return size, count, disk_bytes

    @staticmethod
    def _allocated_size(path: Path) -> int:
        stat = path.stat()
        blocks = getattr(stat, "st_blocks", 0)
        if blocks:
            return int(blocks) * 512
        if os.name == "nt":
            with contextlib.suppress(Exception):
                import ctypes

                get_compressed_size = StorageService._compressed_size_getter
                if get_compressed_size is None:
                    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                    get_compressed_size = kernel32.GetCompressedFileSizeW
                    get_compressed_size.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]
                    get_compressed_size.restype = ctypes.c_ulong
                    StorageService._compressed_size_getter = get_compressed_size
                high = ctypes.c_ulong(0)
                ctypes.set_last_error(0)
                low = get_compressed_size(str(path), ctypes.byref(high))
                if low != 0xFFFFFFFF or ctypes.get_last_error() == 0:
                    return (int(high.value) << 32) | int(low)
        return int(stat.st_size)

    def _application_paths(self) -> list[Path]:
        if getattr(sys, "frozen", False):
            return [Path(sys.executable)]
        return [BASE_DIR / "backend", BASE_DIR / "frontend" / "dist", BASE_DIR / "assets"]

    def _is_default_download_root(self) -> bool:
        current = self._normalized(self._downloads_dir().expanduser().resolve(strict=False))
        default = self._normalized((get_data_dir() / "downloads").resolve(strict=False))
        return current == default

    @staticmethod
    def _file_identity(path: Path) -> dict[str, int]:
        stat = path.stat()
        return {
            "device": int(stat.st_dev),
            "inode": int(stat.st_ino),
            "size": int(stat.st_size),
            "mtime_ns": int(stat.st_mtime_ns),
        }

    def _read_download_manifest(self, *, strict: bool) -> dict[Path, dict[str, int]]:
        if not self._manifest_path.exists():
            return {}
        try:
            payload = json.loads(self._manifest_path.read_text(encoding="utf-8"))
            raw_files = payload.get("files", []) if isinstance(payload, dict) else []
            if not isinstance(raw_files, list):
                raise ValueError("invalid download manifest")
            result: dict[Path, dict[str, int]] = {}
            for item in raw_files:
                if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                    raise ValueError("invalid download manifest entry")
                identity = item.get("identity")
                if not isinstance(identity, dict) or not all(
                    isinstance(identity.get(key), int) for key in ("device", "inode", "size", "mtime_ns")
                ):
                    raise ValueError("invalid download identity")
                result[self._normalized(item["path"])] = {
                    key: int(identity[key]) for key in ("device", "inode", "size", "mtime_ns")
                }
            return result
        except Exception as exc:
            if strict:
                raise RuntimeError("下载文件清单损坏，已停止可能删除文件的操作") from exc
            logger.warning("Failed to read download manifest: {}", exc)
            return {}

    def _read_download_roots(self, *, strict: bool) -> set[Path]:
        if not self._manifest_path.exists():
            return set()
        try:
            payload = json.loads(self._manifest_path.read_text(encoding="utf-8"))
            raw_roots = payload.get("roots", []) if isinstance(payload, dict) else []
            if not isinstance(raw_roots, list) or not all(isinstance(root, str) for root in raw_roots):
                raise ValueError("invalid download roots")
            return {self._normalized(Path(root).expanduser().resolve(strict=False)) for root in raw_roots}
        except Exception as exc:
            if strict:
                raise RuntimeError("下载目录清单损坏，已停止可能删除文件的操作") from exc
            logger.warning("Failed to read download roots: {}", exc)
            return set()

    def _write_download_manifest(
        self, files: dict[Path, dict[str, int]], roots: set[Path] | None = None
    ) -> None:
        self._manifest_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._manifest_path.with_name(self._manifest_path.name + ".tmp")
        if roots is None:
            approved_roots = self._read_download_roots(strict=False)
            approved_roots.add(self._normalized(self._downloads_dir().expanduser().resolve(strict=False)))
        else:
            approved_roots = set(roots)
        temporary.write_text(
            json.dumps(
                {
                    "roots": sorted(str(root) for root in approved_roots),
                    "files": [
                        {"path": str(path), "identity": identity}
                        for path, identity in sorted(files.items(), key=lambda item: str(item[0]))
                    ]
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        os.replace(temporary, self._manifest_path)

    def register_download(self, path: Path) -> None:
        with self._operation_lock:
            files = self._read_download_manifest(strict=True)
            files[self._normalized(path)] = self._file_identity(path)
            self._write_download_manifest(files)

    def remember_current_download_root(self) -> None:
        try:
            current_root = self._normalized(self._downloads_dir().expanduser().resolve(strict=False))
            files = {
                path: identity
                for path, identity in self._read_download_manifest(strict=True).items()
                if self._is_file_inside(self._normalized(path.resolve(strict=False)), current_root)
            }
            self._write_download_manifest(files, {current_root})
        except Exception as exc:
            logger.warning("Failed to remember download root: {}", exc)

    def _adopt_default_downloads(self) -> None:
        if not self._is_default_download_root():
            return
        try:
            files = self._read_download_manifest(strict=True)
            root = self._downloads_dir()
            if root.exists():
                for path in root.rglob("*"):
                    if path.is_file() and not path.is_symlink() and not path.name.endswith(".part"):
                        normalized = self._normalized(path)
                        if normalized not in files:
                            files[normalized] = self._file_identity(path)
            self._write_download_manifest(files)
        except Exception as exc:
            logger.warning("Failed to adopt existing downloads: {}", exc)

    def _managed_download_files(self, *, strict: bool) -> list[Path]:
        approved_roots = self._approved_download_roots(strict=strict)
        result: list[Path] = []
        for path, expected_identity in self._read_download_manifest(strict=strict).items():
            try:
                resolved_path = self._normalized(path.resolve(strict=True))
            except OSError:
                continue
            if not any(self._is_file_inside(resolved_path, root) for root in approved_roots):
                if strict:
                    raise RuntimeError("下载文件清单包含未批准位置，已停止操作")
                continue
            if not path.is_file() or path.is_symlink():
                continue
            try:
                if self._file_identity(path) == expected_identity:
                    result.append(path)
            except OSError:
                continue
        return result

    def _approved_download_roots(self, *, strict: bool) -> set[Path]:
        roots = {self._normalized(self._downloads_dir().expanduser().resolve(strict=False))}
        approved: set[Path] = set()
        for root in roots:
            try:
                self.validate_download_directory(root)
                approved.add(self._normalized(root))
            except ValueError:
                if strict:
                    raise RuntimeError("下载目录清单包含不安全位置，已停止操作") from None
        return approved

    @staticmethod
    def _deduplicate_roots(roots: Iterable[Path]) -> list[Path]:
        result: list[Path] = []
        for root in sorted(set(roots), key=lambda path: len(path.parts)):
            if not any(StorageService._is_file_inside(root, existing) for existing in result):
                result.append(root)
        return result

    @contextlib.contextmanager
    def download_operation(self) -> Iterator[None]:
        with self._operation_lock:
            yield

    @staticmethod
    def available_destination(path: Path) -> Path:
        if not path.exists():
            return path
        for index in range(2, 10000):
            candidate = path.with_name(f"{path.stem} ({index}){path.suffix}")
            if not candidate.exists():
                return candidate
        raise RuntimeError(f"无法为 {path.name} 生成不冲突的文件名")

    def prepare_download_migration(
        self,
        target_root: Path,
        progress: Callable[[int, int, str], None] | None = None,
    ) -> list[tuple[Path, Path]]:
        source_root = self._normalized(self._downloads_dir().expanduser().resolve(strict=False))
        target_root = self._normalized(target_root.expanduser().resolve(strict=False))
        if self._is_file_inside(target_root, source_root) or self._is_file_inside(source_root, target_root):
            raise ValueError("新旧下载目录不能互相包含")
        copied: list[tuple[Path, Path]] = []
        sources = self._managed_download_files(strict=True)
        total = max(1, len(sources)) + 3
        if progress:
            progress(0, total, "正在准备下载文件")
        try:
            for index, source in enumerate(sources, start=1):
                resolved_source = self._normalized(source.resolve(strict=True))
                if not self._is_file_inside(resolved_source, source_root):
                    continue
                destination = self.available_destination(target_root / source.name)
                target_root.mkdir(parents=True, exist_ok=True)
                descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                try:
                    with source.open("rb") as source_file, os.fdopen(descriptor, "wb") as target_file:
                        shutil.copyfileobj(source_file, target_file, length=1024 * 1024)
                        target_file.flush()
                        os.fsync(target_file.fileno())
                    shutil.copystat(source, destination)
                    if source.stat().st_size != destination.stat().st_size:
                        raise OSError("迁移后的文件大小不一致")
                    copied.append((source, destination))
                    if progress:
                        progress(index, total, f"正在复制 {source.name}")
                except Exception:
                    with contextlib.suppress(OSError):
                        destination.unlink()
                    raise
        except Exception as exc:
            self.discard_prepared_downloads(copied)
            raise RuntimeError("下载迁移复制失败，原文件未被修改") from exc
        return copied

    def commit_download_migration(
        self,
        copied: list[tuple[Path, Path]],
        target_root: Path,
        source_root: Path,
        preserve_sources: set[Path] | None = None,
    ) -> int:
        manifest = {
            self._normalized(destination): self._file_identity(destination)
            for _, destination in copied
        }
        target_root = self._normalized(target_root.expanduser().resolve(strict=False))
        source_root = self._normalized(source_root.expanduser().resolve(strict=False))
        self._write_download_manifest(manifest, {target_root})
        preserved = {self._normalized(path) for path in (preserve_sources or set())}
        undeleted = 0
        for source, _ in copied:
            if self._normalized(source) in preserved:
                undeleted += 1
                continue
            try:
                source.unlink()
            except OSError:
                undeleted += 1
                continue
            parent = source.parent
            while parent != source_root.parent:
                with contextlib.suppress(OSError):
                    parent.rmdir()
                if parent == source_root:
                    break
                parent = parent.parent
        return undeleted

    @staticmethod
    def discard_prepared_downloads(copied: list[tuple[Path, Path]]) -> None:
        for _, destination in reversed(copied):
            with contextlib.suppress(OSError):
                destination.unlink()

    def _category_specs(self) -> list[dict[str, Any]]:
        cache_dir = get_cache_dir()
        data_dir = get_data_dir()
        config_dir = get_config_dir()
        downloads_dir = self._downloads_dir()
        managed_download_paths = self._managed_download_files(strict=False)
        normalized_downloads_dir = self._normalized(downloads_dir.expanduser().resolve(strict=False))
        config_files = [
            config_dir / "config.json",
            data_dir / "wallpaper_history.json",
            self._manifest_path,
        ]
        exports = list(data_dir.glob("*.ltfav")) if data_dir.exists() else []
        return [
            {
                "id": "application",
                "title": "应用本体",
                "description": "程序文件和内置资源",
                "paths": self._application_paths(),
                "excluded_dirs": {
                    BASE_DIR / "backend" / ".venv",
                    BASE_DIR / "backend" / ".ruff_cache",
                    BASE_DIR / "backend" / "__pycache__",
                },
                "action": "none",
            },
            {
                "id": "downloads",
                "title": "下载内容",
                "description": "已下载的壁纸和图片",
                "paths": [normalized_downloads_dir],
                "reclaimable_paths": managed_download_paths,
                "primary_path": downloads_dir,
                "additional_paths": [],
                "action": "risk",
                "optimize_supported": True,
            },
            {
                "id": "cache",
                "title": "缓存",
                "description": "可重新获取的接口与图片缓存",
                "paths": [cache_dir],
                "excluded_dirs": {cache_dir / "logs", cache_dir / "crash_reports"},
                "action": "safe",
            },
            {
                "id": "logs",
                "title": "日志",
                "description": "运行和错误诊断记录",
                "paths": [cache_dir / "logs"],
                "action": "confirm",
            },
            {
                "id": "crash_reports",
                "title": "异常报告",
                "description": "异常退出时生成的诊断报告",
                "paths": [cache_dir / "crash_reports"],
                "action": "confirm",
            },
            {
                "id": "sources",
                "title": "壁纸源数据",
                "description": "安装的自定义壁纸源",
                "paths": [data_dir / "wallpaper_sources"],
                "action": "none",
            },
            {
                "id": "favorites",
                "title": "收藏",
                "description": "收藏夹、标签和收藏项目索引",
                "paths": [self._favorites_path()],
                "action": "none",
            },
            {
                "id": "settings",
                "title": "配置数据",
                "description": "设置、历史记录和导出文件",
                "paths": [*config_files, *exports],
                "action": "none",
            },
        ]

    @staticmethod
    def _disk_root(path: Path) -> Path:
        candidate = path
        while not candidate.exists() and candidate != candidate.parent:
            candidate = candidate.parent
        with contextlib.suppress(OSError):
            candidate = candidate.resolve()
        while candidate != candidate.parent and not os.path.ismount(candidate):
            candidate = candidate.parent
        if os.path.ismount(candidate):
            return candidate
        return Path(candidate.anchor or candidate)

    def get_overview(self) -> dict[str, Any]:
        with self._operation_lock:
            return self._get_overview_unlocked()

    def _get_overview_unlocked(self) -> dict[str, Any]:
        specs = self._category_specs()

        def scan(spec: dict[str, Any]) -> dict[str, Any]:
            size, count, disk_bytes = self._scan_files_by_disk(spec["paths"], spec.get("excluded_dirs"))
            reclaimable_bytes = 0
            if spec["action"] != "none":
                reclaimable_paths = spec.get("reclaimable_paths", spec["paths"])
                reclaimable_bytes, _ = self._scan_files(reclaimable_paths, spec.get("excluded_dirs"))
            primary_path = spec.get("primary_path") or spec["paths"][0]
            disk_root = self._disk_root(primary_path)
            return {
                "id": spec["id"],
                "title": spec["title"],
                "description": spec["description"],
                "path": str(primary_path),
                "disk": str(disk_root),
                "disk_bytes": disk_bytes,
                "additional_paths": spec.get("additional_paths", []),
                "size_bytes": size,
                "file_count": count,
                "reclaimable_bytes": reclaimable_bytes,
                "action": spec["action"],
                "optimize_supported": bool(spec.get("optimize_supported")),
            }

        with ThreadPoolExecutor(max_workers=min(6, len(specs)), thread_name_prefix="storage-scan") as pool:
            items = list(pool.map(scan, specs))

        disks: dict[str, dict[str, Any]] = {}
        for item in items:
            for disk, allocated_bytes in item["disk_bytes"].items():
                if disk not in disks:
                    try:
                        usage = shutil.disk_usage(disk)
                        disks[disk] = {
                            "id": disk,
                            "path": disk,
                            "kind": "disk" if os.name == "nt" else "mount",
                            "total_bytes": usage.total,
                            "free_bytes": usage.free,
                            "used_bytes": usage.used,
                            "reserved_bytes": max(0, usage.total - usage.used - usage.free),
                            "app_bytes": 0,
                            "is_system": False,
                            "item_ids": [],
                        }
                    except OSError:
                        disks[disk] = {
                            "id": disk,
                            "path": disk,
                            "kind": "disk" if os.name == "nt" else "mount",
                            "total_bytes": 0,
                            "free_bytes": 0,
                            "used_bytes": 0,
                            "reserved_bytes": 0,
                            "app_bytes": 0,
                            "is_system": False,
                            "item_ids": [],
                        }
                disks[disk]["app_bytes"] += allocated_bytes
                if item["id"] == "application":
                    disks[disk]["is_system"] = True
                if item["id"] not in disks[disk]["item_ids"]:
                    disks[disk]["item_ids"].append(item["id"])

        for disk in disks.values():
            disk["other_used_bytes"] = max(0, disk["used_bytes"] - disk["app_bytes"])

        capabilities = self.get_compression_capabilities()
        return {
            "download_directory": str(self._downloads_dir()),
            "default_download_directory": str(get_data_dir() / "downloads"),
            "default_favorites_directory": str(get_data_dir()),
            "total_bytes": sum(item["size_bytes"] for item in items),
            "reclaimable_bytes": sum(item["reclaimable_bytes"] for item in items),
            "items": items,
            "disks": sorted(disks.values(), key=lambda disk: (not disk["is_system"], disk["path"])),
            "compression": capabilities,
        }

    @staticmethod
    def get_compression_capabilities() -> list[dict[str, Any]]:
        try:
            from PIL import Image

            Image.init()
            save_formats = set(Image.SAVE)
        except Exception:
            save_formats = set()
        return [
            {"id": "avif", "title": "AVIF", "extension": ".avif", "available": "AVIF" in save_formats},
            {"id": "jxl", "title": "JPEG XL", "extension": ".jxl", "available": "JXL" in save_formats},
        ]

    def _protected(self) -> set[Path]:
        return {self._normalized(path) for path in self._protected_paths() if str(path)}

    @staticmethod
    def _is_file_inside(path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    def _clear_directory(
        self,
        root: Path,
        protected: set[Path] | None = None,
        *,
        refresh_protected: bool = False,
    ) -> dict[str, int]:
        if root.is_symlink():
            return {"removed": 0, "skipped": 1, "failed": 0}
        normalized_root = self._normalized(root)
        protected_paths = protected or set()
        removed = 0
        skipped = 0
        failed = 0
        if not root.exists():
            return {"removed": 0, "skipped": 0, "failed": 0}
        for current, dirs, files in os.walk(root, topdown=False, followlinks=False):
            for name in files:
                path = Path(current, name)
                normalized = self._normalized(path)
                if path.is_symlink() or not self._is_file_inside(normalized, normalized_root):
                    skipped += 1
                    continue
                if refresh_protected:
                    protected_paths = self._protected()
                if normalized in protected_paths or path.name.endswith(".part"):
                    skipped += 1
                    continue
                try:
                    path.unlink()
                    removed += 1
                except OSError:
                    failed += 1
            for name in dirs:
                path = Path(current, name)
                if not path.is_symlink():
                    with contextlib.suppress(OSError):
                        path.rmdir()
        return {"removed": removed, "skipped": skipped, "failed": failed}

    def clear_category(self, category_id: str) -> dict[str, Any]:
        with self._operation_lock:
            return self._clear_category_unlocked(category_id)

    def _clear_category_unlocked(self, category_id: str) -> dict[str, Any]:
        if category_id == "cache":
            cache_dir = get_cache_dir()
            protected = self._protected()
            totals = {"removed": 0, "skipped": 0, "failed": 0}
            if cache_dir.exists():
                for child in cache_dir.iterdir():
                    if child.name in {"logs", "crash_reports"}:
                        continue
                    if child.is_symlink():
                        totals["skipped"] += 1
                        continue
                    if self._normalized(child) in protected:
                        totals["skipped"] += 1
                        continue
                    child_result = (
                        self._clear_directory(child, protected, refresh_protected=True)
                        if child.is_dir()
                        else self._clear_files([child])
                    )
                    for key in totals:
                        totals[key] += child_result[key]
            return {"category_id": category_id, **totals, "overview": self._get_overview_unlocked()}
        if category_id == "logs":
            from backend import logging_setup

            log_result = logging_setup.clear_logs()
            return {"category_id": category_id, **log_result, "overview": self._get_overview_unlocked()}
        if category_id == "crash_reports":
            crash_result = self._clear_directory(
                get_cache_dir() / "crash_reports", self._protected(), refresh_protected=True
            )
            return {"category_id": category_id, **crash_result, "overview": self._get_overview_unlocked()}
        if category_id == "downloads":
            self._assert_safe_download_root()
            candidates = self._managed_download_files(strict=True)
            manifest = self._read_download_manifest(strict=True)
            download_result = {"removed": 0, "skipped": 0, "failed": 0}
            for path in candidates:
                normalized = self._normalized(path)
                if normalized in self._protected() or path.name.endswith(".part"):
                    download_result["skipped"] += 1
                    continue
                try:
                    path.unlink()
                    download_result["removed"] += 1
                    manifest.pop(normalized, None)
                except FileNotFoundError:
                    manifest.pop(normalized, None)
                except OSError:
                    download_result["failed"] += 1
            self._write_download_manifest(manifest)
            return {"category_id": category_id, **download_result, "overview": self._get_overview_unlocked()}
        raise ValueError("该存储项目不可清理")

    @staticmethod
    def _clear_files(paths: Iterable[Path]) -> dict[str, int]:
        result = {"removed": 0, "skipped": 0, "failed": 0}
        for path in paths:
            if path.is_symlink():
                result["skipped"] += 1
                continue
            try:
                path.unlink()
                result["removed"] += 1
            except FileNotFoundError:
                pass
            except OSError:
                result["failed"] += 1
        return result

    @staticmethod
    def _format_details(format_id: str) -> tuple[str, str]:
        formats = {"avif": ("AVIF", ".avif"), "jxl": ("JXL", ".jxl")}
        if format_id not in formats:
            raise ValueError("不支持的压缩格式")
        return formats[format_id]

    def compress_file(self, source: Path, format_id: str, quality: int) -> dict[str, Any]:
        from PIL import Image, ImageOps

        pil_format, extension = self._format_details(format_id)
        available = {item["id"]: item["available"] for item in self.get_compression_capabilities()}
        if not available.get(format_id):
            raise RuntimeError(f"当前安装未提供 {pil_format} 编码器")
        quality = max(1, min(int(quality), 100))
        target = source.with_suffix(extension)
        if target != source and target.exists():
            return {"status": "skipped", "reason": "target_exists", "path": str(source)}
        temporary = source.with_name(f".{source.stem}.{uuid.uuid4().hex}.compress.part")
        original_size = source.stat().st_size
        try:
            with Image.open(source) as opened:
                if getattr(opened, "is_animated", False):
                    return {"status": "skipped", "reason": "animated", "path": str(source)}
                has_alpha = "A" in opened.getbands() or "transparency" in opened.info
                icc_profile = opened.info.get("icc_profile")
                image = ImageOps.exif_transpose(opened)
                image.load()
                original_dimensions = image.size
                exif = image.info.get("exif")
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA" if has_alpha else "RGB")
                save_options: dict[str, Any] = {"quality": quality}
                if icc_profile:
                    save_options["icc_profile"] = icc_profile
                if exif:
                    save_options["exif"] = exif
                if pil_format == "AVIF":
                    save_options["speed"] = 6
                image.save(temporary, format=pil_format, **save_options)
            with Image.open(temporary) as verification:
                if verification.size != original_dimensions:
                    raise RuntimeError("压缩后的图片尺寸发生变化")
                if has_alpha and "A" not in verification.getbands():
                    raise RuntimeError("压缩后的图片丢失透明通道")
                verification.verify()
            compressed_size = temporary.stat().st_size
            if compressed_size >= original_size:
                return {"status": "skipped", "reason": "not_smaller", "path": str(source)}
            os.replace(temporary, target)
            if target != source:
                source.unlink()
            return {
                "status": "compressed",
                "path": str(target),
                "before_bytes": original_size,
                "after_bytes": compressed_size,
                "saved_bytes": original_size - compressed_size,
            }
        finally:
            with contextlib.suppress(OSError):
                temporary.unlink()

    def compress_downloads(self, format_id: str, quality: int) -> dict[str, Any]:
        with self._operation_lock:
            return self._compress_downloads_unlocked(format_id, quality)

    def _compress_downloads_unlocked(self, format_id: str, quality: int) -> dict[str, Any]:
        root = self._downloads_dir()
        self._assert_safe_download_root()
        protected = self._protected()
        result = {"compressed": 0, "skipped": 0, "failed": 0, "saved_bytes": 0}
        manifest = self._read_download_manifest(strict=True)
        candidates = self._managed_download_files(strict=True)
        if root.exists():
            for path in candidates:
                if not path.is_file() or path.is_symlink() or path.suffix.lower() not in IMAGE_EXTENSIONS:
                    continue
                protected = self._protected()
                if self._normalized(path) in protected:
                    result["skipped"] += 1
                    continue
                try:
                    outcome = self.compress_file(path, format_id, quality)
                    if outcome["status"] == "compressed":
                        result["compressed"] += 1
                        result["saved_bytes"] += outcome["saved_bytes"]
                        normalized_source = self._normalized(path)
                        if normalized_source in manifest:
                            manifest.pop(normalized_source, None)
                            target = Path(outcome["path"])
                            manifest[self._normalized(target)] = self._file_identity(target)
                    else:
                        result["skipped"] += 1
                except Exception as exc:
                    logger.warning("Failed to compress {}: {}", path, exc)
                    result["failed"] += 1
        self._write_download_manifest(manifest)
        return {**result, "overview": self._get_overview_unlocked()}

    def _assert_safe_download_root(self) -> None:
        root = self._downloads_dir()
        self.validate_download_directory(root)

    def optimize_new_download(self, path: Path) -> Path:
        with self._operation_lock:
            self.register_download(path)
            if not self.store.get("storage.auto_compress.enabled", False):
                return path
            if self._normalized(path) in self._protected():
                logger.warning("Automatic compression skipped for protected download {}", path)
                return path
            format_id = str(self.store.get("storage.auto_compress.format", "avif"))
            quality = int(self.store.get("storage.auto_compress.quality", 80))
            try:
                result = self.compress_file(path, format_id, quality)
                target = Path(result["path"])
                if result.get("status") == "compressed":
                    manifest = self._read_download_manifest(strict=True)
                    manifest.pop(self._normalized(path), None)
                    manifest[self._normalized(target)] = self._file_identity(target)
                    self._write_download_manifest(manifest)
                return target
            except Exception as exc:
                logger.warning("Automatic download compression skipped for {}: {}", path, exc)
                return path

    def validate_download_directory(self, path: Path) -> None:
        resolved = path.expanduser().resolve(strict=False)
        normalized = self._normalized(resolved)
        is_junction = getattr(os.path, "isjunction", lambda _: False)
        if path.is_symlink() or is_junction(path) or normalized == Path(normalized.anchor):
            raise ValueError("下载目录不能是磁盘根目录或符号链接")
        default = self._normalized(get_data_dir() / "downloads")
        if normalized == default:
            return
        sensitive = {
            self._normalized(BASE_DIR.resolve()),
            self._normalized(get_cache_dir().resolve()),
            self._normalized(get_config_dir().resolve()),
            self._normalized(get_data_dir().resolve()),
        }
        for root in sensitive:
            if self._is_file_inside(normalized, root) or self._is_file_inside(root, normalized):
                raise ValueError("下载目录不能与应用程序、配置或缓存目录重叠")

    def validate_favorites_directory(self, path: Path) -> Path:
        resolved = path.expanduser().resolve(strict=False)
        normalized = self._normalized(resolved)
        default = self._normalized(get_data_dir().resolve(strict=False))
        if normalized == default:
            return resolved
        is_junction = getattr(os.path, "isjunction", lambda _: False)
        if path.is_symlink() or is_junction(path) or normalized == Path(normalized.anchor):
            raise ValueError("收藏目录不能是磁盘根目录或符号链接")
        unsafe_roots = {
            self._normalized(BASE_DIR.resolve(strict=False)),
            self._normalized(get_cache_dir().resolve(strict=False)),
            self._normalized(get_config_dir().resolve(strict=False)),
            self._normalized(get_data_dir().resolve(strict=False)),
            *self._approved_download_roots(strict=False),
        }
        for root in unsafe_roots:
            if self._is_file_inside(normalized, root) or self._is_file_inside(root, normalized):
                raise ValueError("收藏目录不能与应用程序、配置、缓存或下载目录重叠")
        return resolved

    def run_automatic_maintenance(self) -> None:
        if not self._maintenance_lock.acquire(blocking=False):
            return
        try:
            with self._operation_lock:
                if self.store.get("storage.auto_clear_cache.enabled", False):
                    max_bytes = max(1, int(self.store.get("storage.auto_clear_cache.max_mb", 512))) * 1024 * 1024
                    cache_spec = next(spec for spec in self._category_specs() if spec["id"] == "cache")
                    cache_size, _ = self._scan_files(cache_spec["paths"], cache_spec.get("excluded_dirs"))
                    if cache_size >= max_bytes:
                        self._clear_category_unlocked("cache")
                if self.store.get("storage.auto_clear_logs.enabled", False):
                    from backend import logging_setup

                    logging_setup.prune_logs(max(2, int(self.store.get("storage.auto_clear_logs.max_files", 20))))
        except Exception as exc:
            logger.warning("Automatic storage maintenance failed: {}", exc)
        finally:
            self._maintenance_lock.release()

    def start_automatic_maintenance(self, interval_seconds: int = 300) -> None:
        if self._maintenance_started:
            return
        self._maintenance_started = True

        def loop() -> None:
            while True:
                self.run_automatic_maintenance()
                threading.Event().wait(max(60, interval_seconds))

        threading.Thread(target=loop, name="storage-maintenance", daemon=True).start()
