from __future__ import annotations

import builtins
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from loguru import logger

try:
    from littledl import DownloadConfig, download_file_sync
except NameError as exc:
    if "Any" not in str(exc):
        raise
    # 兼容当前 littledl 发布包中 scheduler.py 漏导入 Any 的问题。
    if not hasattr(builtins, "Any"):
        builtins.Any = Any
    from littledl import DownloadConfig, download_file_sync


def _looks_like_file_path(path: Path) -> bool:
    return bool(path.suffix)


def _resolve_target(
    save_path: str | Path,
    filename: str | None,
) -> tuple[Path, Path, str | None]:
    target_path = Path(save_path).expanduser().resolve()
    explicit_filename = filename

    if explicit_filename:
        if target_path.exists() and target_path.is_file():
            save_dir = target_path.parent
        elif not target_path.exists() and _looks_like_file_path(target_path):
            save_dir = target_path.parent
        else:
            save_dir = target_path
        return target_path, save_dir, explicit_filename

    if target_path.exists():
        if target_path.is_dir():
            return target_path, target_path, None
        return target_path, target_path.parent, target_path.name

    if _looks_like_file_path(target_path):
        return target_path, target_path.parent, target_path.name

    return target_path, target_path, None


def _build_download_config(
    timeout: int,
    headers: dict[str, str] | None,
    resume: bool,
) -> DownloadConfig:
    base_kwargs: dict[str, Any] = {
        "timeout": timeout,
        "resume": resume,
        "verify_ssl": True,
    }
    if headers:
        base_kwargs["headers"] = dict(headers)

    try:
        return DownloadConfig(**base_kwargs)
    except TypeError:
        config = DownloadConfig(timeout=timeout, resume=resume, verify_ssl=True)
        if headers and hasattr(config, "headers"):
            setattr(config, "headers", dict(headers))
        return config


def _extract_progress(payload: Any) -> tuple[int, int]:
    if payload is None:
        return 0, 0

    if isinstance(payload, dict):
        downloaded = int(payload.get("downloaded") or 0)
        total = int(payload.get("total") or 0)
        return downloaded, total

    downloaded = int(getattr(payload, "downloaded", 0) or 0)
    total = int(getattr(payload, "total", 0) or 0)
    return downloaded, total


def _make_progress_adapter(
    progress_callback: Callable[[int, int], None] | None,
) -> Callable[..., None] | None:
    if progress_callback is None:
        return None

    def _adapter(*args: Any, **kwargs: Any) -> None:
        try:
            downloaded = 0
            total = 0

            if kwargs:
                downloaded, total = _extract_progress(kwargs)
            elif len(args) == 1:
                downloaded, total = _extract_progress(args[0])
            elif len(args) >= 2:
                downloaded = int(args[0] or 0)
                total = int(args[1] or 0)

            progress_callback(downloaded, total)
        except Exception:
            logger.debug("下载进度回调处理失败", exc_info=True)

    return _adapter


def download_file(
    url: str,
    save_path: str | Path = "./temp",
    filename: str | None = None,
    timeout: int = 300,
    max_retries: int = 3,
    headers: dict[str, str] | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
    resume: bool = False,
) -> str | None:
    target_path, save_dir, explicit_filename = _resolve_target(save_path, filename)
    save_dir.mkdir(parents=True, exist_ok=True)

    config = _build_download_config(timeout=timeout, headers=headers, resume=resume)
    callback = _make_progress_adapter(progress_callback)
    attempts = max(1, int(max_retries or 1))

    for attempt in range(1, attempts + 1):
        try:
            result = download_file_sync(
                url,
                save_path=str(save_dir),
                filename=explicit_filename,
                config=config,
                progress_callback=callback,
            )
            if not result:
                return None

            result_path = Path(result).expanduser().resolve()

            if explicit_filename and result_path.name != explicit_filename:
                final_target = save_dir / explicit_filename
                final_target.parent.mkdir(parents=True, exist_ok=True)
                if final_target.exists() and final_target != result_path:
                    final_target.unlink(missing_ok=True)
                result_path.replace(final_target)
                result_path = final_target
            elif not explicit_filename and target_path != save_dir and result_path != target_path:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                if target_path.exists() and target_path != result_path:
                    target_path.unlink(missing_ok=True)
                result_path.replace(target_path)
                result_path = target_path

            return str(result_path)
        except Exception as exc:
            logger.warning("第 {}/{} 次下载失败：{}", attempt, attempts, exc)
            if attempt >= attempts:
                logger.error("下载失败：{}", url)
                return None
            time.sleep(min(2 ** (attempt - 1), 8))

    return None