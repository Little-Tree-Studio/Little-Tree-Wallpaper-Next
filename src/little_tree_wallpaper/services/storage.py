from __future__ import annotations

import hashlib
import shutil
import uuid
from pathlib import Path
from typing import Any

from loguru import logger
from PIL import Image, ImageOps

from little_tree_wallpaper.paths import AppPaths
from little_tree_wallpaper.services.favorites import FavoriteManager
from little_tree_wallpaper.services.intelligent_market import IntelligentMarketService
from little_tree_wallpaper.services.ltws import LTWSService
from little_tree_wallpaper.services.wallpaper import WallpaperService

try:
    import pillow_avif  # type: ignore[import-not-found]  # noqa: F401
except ImportError:  # pragma: no cover
    pillow_avif = None


IMAGE_SUFFIXES = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
}
OPTIMIZABLE_TARGET_IDS = {"downloads", "favorite_localizations"}


class StorageService:
    def __init__(
        self,
        paths: AppPaths,
        wallpaper_service: WallpaperService,
        favorite_manager: FavoriteManager,
        ltws_service: LTWSService,
        intelligent_market_service: IntelligentMarketService,
    ):
        self._paths = paths
        self._wallpaper_service = wallpaper_service
        self._favorite_manager = favorite_manager
        self._ltws_service = ltws_service
        self._intelligent_market_service = intelligent_market_service

    def default_download_directory(self) -> Path:
        return self._paths.downloads_dir.resolve()

    def resolve_download_directory(
        self,
        raw_path: str | None,
        *,
        fallback_to_default: bool = True,
    ) -> Path:
        normalized = str(raw_path or "").strip()
        if not normalized:
            directory = self.default_download_directory()
        else:
            candidate = Path(normalized).expanduser()
            if not candidate.is_absolute():
                if fallback_to_default:
                    directory = self.default_download_directory()
                else:
                    raise ValueError("下载目录必须是绝对路径")
            else:
                directory = candidate.resolve()

        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def get_overview(self) -> dict[str, Any]:
        items = [self._build_item(target_id) for target_id in self._target_order()]
        data_size_bytes = sum(
            item["size_bytes"] for item in items if item["scope"] == "data"
        )
        cache_size_bytes = sum(
            item["size_bytes"] for item in items if item["scope"] == "cache"
        )
        return {
            "download_directory": str(self._wallpaper_service.download_dir),
            "default_download_directory": str(self.default_download_directory()),
            "total_size_bytes": data_size_bytes + cache_size_bytes,
            "data_size_bytes": data_size_bytes,
            "cache_size_bytes": cache_size_bytes,
            "items": items,
        }

    def target_directory(self, target_id: str) -> Path:
        normalized_target = str(target_id or "").strip()
        if normalized_target == "downloads":
            return self._wallpaper_service.download_dir
        if normalized_target == "favorite_localizations":
            return self._favorite_manager.localization_root()
        if normalized_target == "wallpaper_history":
            return self._wallpaper_service.history_dir
        if normalized_target == "intelligent_market_cache":
            return self._intelligent_market_service.cache_dir
        if normalized_target == "ltws_cache":
            return self._ltws_service.cache_dir
        if normalized_target == "logs":
            return self._paths.log_dir
        raise ValueError("未知的数据目标")

    def clear_targets(self, target_ids: list[str] | tuple[str, ...]) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        for target_id in self._normalize_target_ids(target_ids):
            if target_id == "favorite_localizations":
                removed_files, freed_bytes, updated_items = (
                    self._favorite_manager.clear_managed_localizations()
                )
                results.append(
                    {
                        "id": target_id,
                        "removed_files": removed_files,
                        "freed_bytes": freed_bytes,
                        "updated_items": updated_items,
                    }
                )
                continue

            if target_id == "wallpaper_history":
                removed_files, freed_bytes = self._wallpaper_service.clear_history()
                results.append(
                    {
                        "id": target_id,
                        "removed_files": removed_files,
                        "freed_bytes": freed_bytes,
                    }
                )
                continue

            directory = self.target_directory(target_id)
            if target_id == "logs":
                removed_files, freed_bytes = self._clear_log_directory(directory)
            else:
                removed_files, freed_bytes = self._clear_directory(directory)
            results.append(
                {
                    "id": target_id,
                    "removed_files": removed_files,
                    "freed_bytes": freed_bytes,
                }
            )

        return {
            "results": results,
            "storage": self.get_overview(),
        }

    def optimize_targets(
        self,
        target_ids: list[str] | tuple[str, ...],
        quality: int,
    ) -> dict[str, Any]:
        normalized_quality = max(1, min(int(quality), 100))
        selected_target_ids = [
            target_id
            for target_id in self._normalize_target_ids(target_ids)
            if target_id in OPTIMIZABLE_TARGET_IDS
        ]
        if not selected_target_ids:
            raise ValueError("至少选择一个可优化的目录")

        results: list[dict[str, Any]] = []
        total_before = 0
        total_after = 0
        total_processed = 0
        total_converted = 0
        total_skipped = 0
        total_errors = 0

        for target_id in selected_target_ids:
            target_result = self._optimize_target(target_id, normalized_quality)
            results.append(target_result)
            total_before += target_result["before_bytes"]
            total_after += target_result["after_bytes"]
            total_processed += target_result["processed_count"]
            total_converted += target_result["converted_count"]
            total_skipped += target_result["skipped_count"]
            total_errors += target_result["error_count"]

        return {
            "quality": normalized_quality,
            "processed_count": total_processed,
            "converted_count": total_converted,
            "skipped_count": total_skipped,
            "error_count": total_errors,
            "before_bytes": total_before,
            "after_bytes": total_after,
            "delta_bytes": total_before - total_after,
            "results": results,
            "storage": self.get_overview(),
        }

    def _target_order(self) -> tuple[str, ...]:
        return (
            "downloads",
            "favorite_localizations",
            "wallpaper_history",
            "intelligent_market_cache",
            "ltws_cache",
            "logs",
        )

    def _build_item(self, target_id: str) -> dict[str, Any]:
        directory = self.target_directory(target_id)
        file_count, size_bytes = self._directory_stats(directory)
        return {
            "id": target_id,
            "scope": "cache"
            if target_id in {"intelligent_market_cache", "ltws_cache", "logs"}
            else "data",
            "path": str(directory),
            "file_count": file_count,
            "size_bytes": size_bytes,
            "clear_supported": True,
            "optimize_supported": target_id in OPTIMIZABLE_TARGET_IDS,
        }

    def _normalize_target_ids(
        self, target_ids: list[str] | tuple[str, ...] | None
    ) -> list[str]:
        normalized: list[str] = []
        for target_id in target_ids or []:
            candidate = str(target_id or "").strip()
            if candidate and candidate not in normalized:
                self.target_directory(candidate)
                normalized.append(candidate)
        return normalized

    def _directory_stats(self, directory: Path) -> tuple[int, int]:
        if not directory.exists():
            return (0, 0)
        file_count = 0
        size_bytes = 0
        for candidate in directory.rglob("*"):
            if not candidate.is_file():
                continue
            file_count += 1
            try:
                size_bytes += candidate.stat().st_size
            except OSError:
                continue
        return (file_count, size_bytes)

    def _clear_directory(self, directory: Path) -> tuple[int, int]:
        removed_files, freed_bytes = self._directory_stats(directory)
        directory.mkdir(parents=True, exist_ok=True)
        for candidate in directory.iterdir():
            try:
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate)
                else:
                    candidate.unlink()
            except FileNotFoundError:
                continue
            except OSError as exc:
                logger.warning("clear storage target failed {}: {}", candidate, exc)
        directory.mkdir(parents=True, exist_ok=True)
        return (removed_files, freed_bytes)

    def _clear_log_directory(self, directory: Path) -> tuple[int, int]:
        removed_files, freed_bytes = self._directory_stats(directory)
        directory.mkdir(parents=True, exist_ok=True)
        for candidate in directory.iterdir():
            try:
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate)
                    continue
                if candidate.name == "app.log":
                    candidate.write_bytes(b"")
                    continue
                candidate.unlink()
            except FileNotFoundError:
                continue
            except OSError as exc:
                logger.warning("clear log target failed {}: {}", candidate, exc)
        return (removed_files, freed_bytes)

    def _optimize_target(self, target_id: str, quality: int) -> dict[str, Any]:
        directory = self.target_directory(target_id)
        processed_count = 0
        converted_count = 0
        skipped_count = 0
        error_count = 0
        before_bytes = 0
        after_bytes = 0

        for candidate in directory.rglob("*"):
            if not candidate.is_file():
                continue
            if candidate.suffix.lower() == ".avif":
                skipped_count += 1
                continue
            if candidate.suffix.lower() not in IMAGE_SUFFIXES:
                continue

            processed_count += 1
            try:
                original_size = candidate.stat().st_size
                target_path = self._convert_image_to_avif(candidate, quality)
                target_size = target_path.stat().st_size
                before_bytes += original_size
                after_bytes += target_size
                converted_count += 1
                if target_id == "favorite_localizations":
                    self._favorite_manager.replace_localization_file(
                        candidate,
                        target_path,
                    )
            except Exception as exc:
                error_count += 1
                logger.warning("optimize storage image failed {}: {}", candidate, exc)

        skipped_count += max(0, processed_count - converted_count - error_count)
        return {
            "id": target_id,
            "processed_count": processed_count,
            "converted_count": converted_count,
            "skipped_count": skipped_count,
            "error_count": error_count,
            "before_bytes": before_bytes,
            "after_bytes": after_bytes,
            "delta_bytes": before_bytes - after_bytes,
        }

    def _convert_image_to_avif(self, source_path: Path, quality: int) -> Path:
        suffix_hash = hashlib.sha1(str(source_path).encode("utf-8")).hexdigest()[:8]
        target_path = source_path.with_suffix(".avif")
        if target_path.exists() and target_path != source_path:
            target_path = source_path.with_name(f"{source_path.stem}_{suffix_hash}.avif")

        temp_target = target_path.with_name(
            f".__tmp_{target_path.stem}_{uuid.uuid4().hex}.avif"
        )
        temp_target.parent.mkdir(parents=True, exist_ok=True)

        with Image.open(source_path) as image:
            rendered = ImageOps.exif_transpose(image)
            if rendered.mode not in {"RGB", "RGBA"}:
                if "A" in rendered.getbands() or rendered.info.get("transparency") is not None:
                    rendered = rendered.convert("RGBA")
                else:
                    rendered = rendered.convert("RGB")
            rendered.save(temp_target, format="AVIF", quality=quality)

        if target_path.exists():
            target_path.unlink()
        temp_target.replace(target_path)
        source_path.unlink()
        return target_path