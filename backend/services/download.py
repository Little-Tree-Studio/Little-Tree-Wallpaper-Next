"""Atomic, integrity-checked helpers for writing image bytes to disk.

Centralises the download-to-disk logic so that ``BackendAPI`` and the FastAPI
``/api/save-*`` routes share the same code path. The previous code opened the
final file directly, leaving half-written files behind on power loss; the
helpers here stage every write in a ``*.part`` sibling first and ``os.replace``
it into place once the size matches the advertised ``Content-Length`` and the
bytes verify as a decodable image.
"""

from __future__ import annotations

import contextlib
import mimetypes
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from loguru import logger

# 64 KiB strikes a good balance between syscall overhead and RSS growth
# while streaming multi-megabyte wallpapers.
_CHUNK_SIZE = 64 * 1024

# 200 MiB cap for the ``/api/save-*`` uploads. 8K JPEGs top out around 25 MiB
# so this leaves a comfortable margin without enabling truly unbounded writes.
MAX_BLOB_BYTES = 200 * 1024 * 1024


class DownloadError(Exception):
    """Raised when an image transfer fails an integrity check."""

    def __init__(self, message: str, *, code: str = "download_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass
class WriteResult:
    path: Path
    size: int


def sanitize_filename(name: str) -> str:
    """Reduce ``name`` to a safe basename (no path traversal)."""
    # Treat both path separator styles consistently on every host platform.
    base = Path((name or "").replace("\\", "/")).name
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", base).strip(" .")
    reserved_stem = base.split(".", 1)[0].upper()
    if reserved_stem in {"CON", "PRN", "AUX", "NUL"} or re.fullmatch(r"(?:COM|LPT)[1-9]", reserved_stem):
        base = f"_{base}"
    return base or "download"


def _ext_from_content_type(content_type: str | None) -> str | None:
    if not content_type:
        return None
    main = content_type.split(";", 1)[0].strip().lower()
    if not main.startswith("image/"):
        return None
    return mimetypes.guess_extension(main) or None


def _ensure_image_extension(path: Path, content_type: str | None) -> Path:
    """Add a guessed extension when the URL filename has no image extension.

    Pillow decoding below rejects non-images regardless, so this is purely
    cosmetic: it just avoids ``download.jpg`` for genuine PNG/WEBP responses.
    """
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}:
        return path
    ext = _ext_from_content_type(content_type)
    return path.with_suffix(ext) if ext else path


def _fsync(fp) -> None:
    """Best-effort fsync; some filesystems (e.g. network drives) reject it."""
    try:
        os.fsync(fp.fileno())
    except OSError as exc:  # pragma: no cover - platform dependent
        logger.debug("fsync failed ({}); continuing", exc)


def write_blob_atomic(dest: Path, data: bytes) -> WriteResult:
    """Write ``data`` to ``dest`` via a ``*.part`` sibling then atomic rename."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            _fsync(f)
        os.replace(tmp, dest)
    except Exception:
        safe_unlink(tmp)
        raise
    return WriteResult(path=dest, size=dest.stat().st_size)


def stream_to_file_atomic(
    dest: Path,
    source: BinaryIO,
    *,
    expected_size: int | None = None,
    content_type: str | None = None,
) -> WriteResult:
    """Stream ``source`` into ``dest`` via ``*.part`` + atomic rename.

    ``expected_size`` is the ``Content-Length`` advertised by the server. When
    provided, the post-write size is checked against it. ``content_type`` is
    used to recover a sensible extension if the URL filename has none.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    final_dest = _ensure_image_extension(dest, content_type)
    tmp = final_dest.with_name(final_dest.name + ".part")
    received = 0
    try:
        with open(tmp, "wb") as f:
            while True:
                chunk = source.read(_CHUNK_SIZE)
                if not chunk:
                    break
                f.write(chunk)
                received += len(chunk)
            f.flush()
            _fsync(f)
        if expected_size is not None and received != expected_size:
            raise DownloadError(
                f"下载不完整: 收到 {received} 字节, 预期 {expected_size} 字节",
                code="incomplete_download",
            )
        _verify_image(tmp)
        os.replace(tmp, final_dest)
    except Exception:
        safe_unlink(tmp)
        raise
    return WriteResult(path=final_dest, size=received)


def _verify_image(path: Path) -> None:
    """Confirm ``path`` decodes as an image. Raises ``DownloadError`` otherwise."""
    try:
        from PIL import Image
    except Exception as exc:  # pragma: no cover - Pillow is a hard dependency
        raise DownloadError(f"图片校验不可用: {exc}", code="pillow_unavailable") from exc

    try:
        with Image.open(path) as img:
            img.verify()
    except Exception as exc:
        raise DownloadError(
            f"下载内容不是有效图片: {exc}", code="invalid_image"
        ) from exc


def safe_unlink(path: Path | str) -> None:
    """Remove ``path`` if it exists, swallowing only ``FileNotFoundError``."""
    try:
        Path(path).unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.debug("safe_unlink failed for {}: {}", path, exc)


# Re-export for callers that prefer the long name.
suppress_os_error = contextlib.suppress(OSError)
