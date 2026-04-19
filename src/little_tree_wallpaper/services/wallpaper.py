from __future__ import annotations

import base64
import ctypes
import hashlib
import io
import mimetypes
import os
import platform
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
import re
from urllib.parse import unquote, unquote_to_bytes, urlparse

import orjson
import requests
from loguru import logger
from PIL import Image
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    import pillow_avif  # type: ignore[import-not-found]  # noqa: F401
except ImportError:  # pragma: no cover
    pillow_avif = None

try:
    import filetype
except ImportError:  # pragma: no cover
    filetype = None

from little_tree_wallpaper.models import HistoryItem


class WallpaperService:
    def __init__(self, download_dir: Path, history_dir: Path):
        self.download_dir = download_dir
        self.history_dir = history_dir
        self.managed_wallpaper_dir = self.history_dir.parent / "wallpaper"
        self._http = self._build_http_session()
        self.download_dir.mkdir(parents=True, exist_ok=True)
        self.history_dir.mkdir(parents=True, exist_ok=True)
        self.managed_wallpaper_dir.mkdir(parents=True, exist_ok=True)
        self.history_file = self.history_dir / "history.json"
        if not self.history_file.exists():
            self.history_file.write_bytes(orjson.dumps([], option=orjson.OPT_INDENT_2))

    def set_download_dir(self, download_dir: Path) -> Path:
        resolved = download_dir.expanduser().resolve()
        resolved.mkdir(parents=True, exist_ok=True)
        self.download_dir = resolved
        return self.download_dir

    def get_current_wallpaper(
        self, windows_way: str = "auto"
    ) -> dict[str, str | bool | None] | None:
        local_path = self._get_current_wallpaper_path(windows_way)
        if not local_path:
            return None

        path = Path(local_path)
        exists = path.is_file()
        return {
            "local_path": local_path,
            "exists": exists,
            "preview_url": self._build_preview_data_url(path) if exists else None,
            "refreshed_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        }

    def download(
        self,
        image_url: str,
        suggested_name: str | None = None,
        metadata: dict | None = None,
    ) -> Path:
        local_path = self._resolve_local_path(image_url)
        if local_path is not None:
            return self._apply_output_profile(
                local_path,
                suggested_name=suggested_name,
                metadata=metadata,
            )

        parsed = urlparse(image_url)
        if parsed.scheme == "data":
            decoded_path = self._save_data_url(
                image_url,
                suggested_name=suggested_name,
            )
            return self._apply_output_profile(
                decoded_path,
                suggested_name=suggested_name,
                metadata=metadata,
            )
        safe_name = (
            self._slugify(suggested_name)
            if suggested_name
            else hashlib.sha1(image_url.encode("utf-8")).hexdigest()
        )
        headers = self._build_download_headers(image_url=image_url, metadata=metadata)

        try:
            response = self._http.get(
                image_url,
                timeout=(12, 90),
                headers=headers,
                stream=True,
            )
            response.raise_for_status()
        except requests.exceptions.Timeout as exc:
            logger.warning("wallpaper download timed out: {}", image_url)
            raise RuntimeError("下载壁纸超时，请稍后重试或切换其他画质。") from exc
        except requests.exceptions.RequestException as exc:
            logger.warning("wallpaper download failed: {}", exc)
            raise RuntimeError(f"下载壁纸失败: {exc}") from exc

        suffix = self._infer_remote_suffix(
            parsed.path, response.headers.get("content-type")
        )
        output_path = self.download_dir / f"{safe_name}{suffix}"
        with output_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 128):
                if chunk:
                    handle.write(chunk)

        downloaded_path = self._ensure_download_extension(
            output_path,
            content_type=response.headers.get("content-type"),
            suggested_name=suggested_name,
        )
        return self._apply_output_profile(
            downloaded_path,
            suggested_name=suggested_name,
            metadata=metadata,
        )

    def set_wallpaper(
        self,
        image_url: str,
        title: str,
        source_id: str,
        source_name: str,
        metadata: dict | None = None,
    ) -> dict[str, str]:
        local_path = self.download(
            image_url,
            suggested_name=self._slugify(title),
            metadata=metadata,
        )
        managed_path = self._copy_to_managed_wallpaper(local_path)
        self._apply_wallpaper(managed_path)
        history_image_url = (
            str(local_path) if urlparse(image_url).scheme == "data" else image_url
        )
        self._record_history(
            title=title,
            image_url=history_image_url,
            source_id=source_id,
            source_name=source_name,
            local_path=managed_path,
            deduplicate_by="local_path",
        )
        return {"local_path": str(managed_path), "message": "壁纸已更新"}

    def list_history(self) -> list[dict]:
        return orjson.loads(self.history_file.read_bytes())

    def record_current_wallpaper(self) -> dict[str, str | bool | None] | None:
        info = self.get_current_wallpaper()
        if not info or not info.get("local_path"):
            return info

        source_path = Path(info["local_path"])
        if not source_path.is_file():
            return info

        dest_name = source_path.name
        target_path = self.history_dir / dest_name
        if target_path.exists():
            if target_path.resolve() != source_path.resolve():
                content_hash_src = self._file_hash(source_path)
                content_hash_dst = self._file_hash(target_path)
                if content_hash_src != content_hash_dst:
                    stem = source_path.stem or "wallpaper"
                    suffix = source_path.suffix or ".jpg"
                    target_path = (
                        self.history_dir
                        / f"{stem}_{hashlib.sha1(str(source_path).encode('utf-8')).hexdigest()[:8]}{suffix}"
                    )
                    shutil.copy2(source_path, target_path)
        else:
            shutil.copy2(source_path, target_path)

        title = source_path.stem or "当前壁纸"
        self._record_history(
            title=title,
            image_url=str(target_path),
            source_id="system.current",
            source_name="系统当前壁纸",
            local_path=target_path,
            deduplicate_by="local_path",
        )
        return info

    def clear_history(self) -> tuple[int, int]:
        removed_files = 0
        freed_bytes = 0
        for candidate in self.history_dir.rglob("*"):
            if not candidate.is_file():
                continue
            removed_files += 1
            try:
                freed_bytes += candidate.stat().st_size
            except OSError:
                continue

        for candidate in list(self.history_dir.iterdir()):
            if candidate == self.history_file:
                continue
            try:
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate)
                else:
                    candidate.unlink()
            except FileNotFoundError:
                continue
            except OSError as exc:
                logger.warning("清理壁纸历史目录失败: {}", exc)

        self.history_file.write_bytes(orjson.dumps([], option=orjson.OPT_INDENT_2))
        return (removed_files, freed_bytes)

    def _file_hash(self, path: Path) -> str:
        hasher = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    def _record_history(
        self,
        title: str,
        image_url: str,
        source_id: str,
        source_name: str,
        local_path: Path,
        *,
        deduplicate_by: str | None = None,
    ) -> None:
        payload = self.list_history()
        preview_url = (
            self._build_preview_data_url(local_path) if local_path.is_file() else None
        )
        local_path_str = str(local_path)

        if deduplicate_by == "local_path":
            for i, existing in enumerate(payload):
                existing_lp = existing.get("local_path")
                if existing_lp and Path(existing_lp).resolve() == local_path.resolve():
                    entry = payload.pop(i)
                    entry["applied_at"] = (
                        datetime.utcnow().isoformat(timespec="seconds") + "Z"
                    )
                    if preview_url:
                        entry["preview_url"] = preview_url
                    payload.insert(0, entry)
                    self.history_file.write_bytes(
                        orjson.dumps(payload[:200], option=orjson.OPT_INDENT_2)
                    )
                    return

        payload.insert(
            0,
            HistoryItem(
                id=hashlib.sha1(
                    f"{title}|{image_url}|{datetime.utcnow().isoformat()}".encode(
                        "utf-8"
                    )
                ).hexdigest(),
                title=title,
                image_url=image_url,
                preview_url=preview_url,
                source_id=source_id,
                source_name=source_name,
                applied_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
                local_path=local_path_str,
            ).to_dict(),
        )
        self.history_file.write_bytes(
            orjson.dumps(payload[:200], option=orjson.OPT_INDENT_2)
        )

    def _save_data_url(self, image_url: str, suggested_name: str | None = None) -> Path:
        header, _, payload = image_url.partition(",")
        if not header.startswith("data:") or not payload:
            raise RuntimeError("下载壁纸失败: 无效的数据图像")

        mime_part = header[5:]
        mime_type, *encoding_parts = mime_part.split(";")
        is_base64 = any(part.lower() == "base64" for part in encoding_parts)

        try:
            raw_bytes = (
                base64.b64decode(payload) if is_base64 else unquote_to_bytes(payload)
            )
        except (ValueError, TypeError) as exc:
            raise RuntimeError("下载壁纸失败: 无法解析生成图像") from exc

        suffix = mimetypes.guess_extension(mime_type or "image/png") or ".png"
        if suffix == ".jpe":
            suffix = ".jpg"
        safe_name = (
            self._slugify(suggested_name)
            if suggested_name
            else hashlib.sha1(image_url.encode("utf-8")).hexdigest()
        )
        output_path = self.download_dir / f"{safe_name}{suffix}"
        output_path.write_bytes(raw_bytes)
        return output_path

    def _build_http_session(self) -> requests.Session:
        session = requests.Session()
        retries = Retry(
            total=2,
            connect=2,
            read=2,
            backoff_factor=0.8,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
        )
        adapter = HTTPAdapter(max_retries=retries)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def _build_download_headers(
        self, image_url: str, metadata: dict | None = None
    ) -> dict[str, str]:
        referer = ""
        if isinstance(metadata, dict):
            referer = str(metadata.get("click_url") or metadata.get("referer") or "")

        parsed = urlparse(image_url)
        if not referer and parsed.netloc.endswith("bing.com"):
            referer = "https://www.bing.com/"
        if not referer and "microsoft" in parsed.netloc:
            referer = "https://www.bing.com/"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
        }
        if referer:
            headers["Referer"] = referer
        return headers

    def _apply_wallpaper(self, image_path: Path) -> None:
        system = platform.system().lower()
        if system == "windows":
            self._set_windows_wallpaper(image_path)
            return
        if system == "darwin":
            self._set_macos_wallpaper(image_path)
            return
        if system == "linux":
            self._set_linux_wallpaper(image_path)
            return
        raise RuntimeError("当前平台暂未实现设置壁纸")

    def _slugify(self, value: str) -> str:
        cleaned = "".join(char if char.isalnum() else "_" for char in value).strip("_")
        return cleaned[:64] or "wallpaper"

    def _resolve_local_path(self, image_url: str) -> Path | None:
        raw = str(image_url or "").strip()
        if not raw:
            return None

        # urlparse("C:\\foo.jpg") treats "c" as a URL scheme, so detect native paths first.
        if re.match(r"^[a-zA-Z]:[\\/]", raw):
            return Path(raw).expanduser().resolve()
        if raw.startswith("\\\\"):
            return Path(raw).expanduser().resolve()

        parsed = urlparse(image_url)
        if parsed.scheme == "file":
            return Path(unquote(parsed.path)).resolve()
        if parsed.scheme == "":
            return Path(image_url).expanduser().resolve()
        return None

    def _infer_remote_suffix(self, url_path: str, content_type: str | None) -> str:
        parsed_suffix = Path(unquote(url_path)).suffix.lower()
        if parsed_suffix and len(parsed_suffix) <= 8:
            return parsed_suffix

        mime = (content_type or "").split(";", 1)[0].strip().lower()
        guessed = mimetypes.guess_extension(mime) if mime else None
        if guessed == ".jpe":
            return ".jpg"
        if guessed:
            return guessed
        return ".bin"

    def _ensure_download_extension(
        self,
        path: Path,
        content_type: str | None = None,
        suggested_name: str | None = None,
    ) -> Path:
        if suggested_name and Path(suggested_name).suffix:
            return path
        if path.suffix.lower() not in {"", ".bin", ".tmp"}:
            return path

        content = path.read_bytes()[:261]
        inferred_suffix: str | None = None
        if filetype is not None:
            guessed = filetype.guess(content)
            if guessed is not None:
                inferred_suffix = f".{guessed.extension}"

        if inferred_suffix is None and content_type:
            mime = content_type.split(";", 1)[0].strip().lower()
            inferred_suffix = mimetypes.guess_extension(mime)
            if inferred_suffix == ".jpe":
                inferred_suffix = ".jpg"

        if inferred_suffix is None or inferred_suffix == path.suffix.lower():
            return path

        target = path.with_suffix(inferred_suffix)
        if target.exists():
            target.unlink()
        path.replace(target)
        return target

    def _copy_to_managed_wallpaper(self, source_path: Path) -> Path:
        source_path = source_path.resolve()
        target_path = self.managed_wallpaper_dir / source_path.name
        if source_path != target_path:
            shutil.copy2(source_path, target_path)

        for candidate in self.managed_wallpaper_dir.iterdir():
            if candidate.is_file() and candidate != target_path:
                try:
                    candidate.unlink()
                except OSError:
                    logger.debug("skip stale wallpaper cleanup: {}", candidate)

        return target_path

    def _apply_output_profile(
        self,
        source_path: Path,
        suggested_name: str | None = None,
        metadata: dict | None = None,
    ) -> Path:
        profile = self._extract_output_profile(metadata)
        if profile is None:
            return source_path

        target_path = self._build_profile_output_path(
            source_path=source_path,
            suggested_name=suggested_name,
            width=profile["width"],
            height=profile["height"],
        )

        with Image.open(source_path) as image:
            rendered = self._resize_cover(image, profile["width"], profile["height"])
            self._save_processed_image(rendered, target_path)

        return target_path

    def _extract_output_profile(self, metadata: dict | None) -> dict[str, int] | None:
        if not isinstance(metadata, dict):
            return None
        profile = metadata.get("output_profile")
        if not isinstance(profile, dict):
            return None
        if profile.get("mode") != "cover_center_crop":
            return None

        try:
            width = int(profile.get("width", 0))
            height = int(profile.get("height", 0))
        except (TypeError, ValueError):
            return None

        if width <= 0 or height <= 0:
            return None
        return {"width": width, "height": height}

    def _build_profile_output_path(
        self,
        source_path: Path,
        suggested_name: str | None,
        width: int,
        height: int,
    ) -> Path:
        suffix = source_path.suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
            suffix = ".jpg"

        base_name = self._slugify(suggested_name or source_path.stem)
        return self.download_dir / f"{base_name}_{width}x{height}{suffix}"

    def _resize_cover(self, image: Image.Image, width: int, height: int) -> Image.Image:
        working = image.copy()
        source_aspect = working.width / working.height
        target_aspect = width / height

        if source_aspect > target_aspect:
            crop_width = max(1, int(round(working.height * target_aspect)))
            left = max(0, (working.width - crop_width) // 2)
            box = (left, 0, left + crop_width, working.height)
        else:
            crop_height = max(1, int(round(working.width / target_aspect)))
            top = max(0, (working.height - crop_height) // 2)
            box = (0, top, working.width, top + crop_height)

        cropped = working.crop(box)
        return cropped.resize((width, height), Image.Resampling.LANCZOS)

    def _save_processed_image(self, image: Image.Image, target_path: Path) -> None:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        suffix = target_path.suffix.lower()

        if suffix == ".png":
            image.save(target_path, format="PNG", optimize=True)
            return
        if suffix == ".webp":
            image.save(target_path, format="WEBP", quality=92, method=6)
            return

        rendered = image if image.mode in {"RGB", "L"} else image.convert("RGB")
        rendered.save(target_path, format="JPEG", quality=92, optimize=True)

    def _get_current_wallpaper_path(self, windows_way: str = "auto") -> str | None:
        if os.name == "nt":
            return self._get_windows_wallpaper(windows_way)
        if sys.platform == "darwin":
            return self._get_macos_wallpaper()
        if sys.platform.startswith("linux"):
            return self._get_linux_wallpaper()
        return None

    def _get_windows_wallpaper(self, windows_way: str) -> str | None:
        reg_path = None
        spi_path = None

        if windows_way in {"auto", "reg"}:
            try:
                import winreg

                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop"
                ) as key:
                    reg_path, _ = winreg.QueryValueEx(key, "WallPaper")
            except Exception:
                reg_path = None

        if windows_way in {"auto", "spi"}:
            try:
                buffer = ctypes.create_unicode_buffer(4096)
                ok = ctypes.windll.user32.SystemParametersInfoW(
                    0x0073, len(buffer), buffer, 0
                )
                spi_path = buffer.value if ok else None
            except Exception:
                spi_path = None

        for candidate in [reg_path, spi_path]:
            if candidate and Path(candidate).is_file():
                return candidate

        return reg_path or spi_path

    def _set_windows_wallpaper(self, image_path: Path) -> None:
        ctypes.windll.user32.SystemParametersInfoW(20, 0, str(image_path), 3)
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Control Panel\Desktop",
                0,
                winreg.KEY_SET_VALUE,
            ) as key:
                winreg.SetValueEx(key, "Wallpaper", 0, winreg.REG_SZ, str(image_path))
        except Exception:
            logger.debug("failed to persist wallpaper registry value")

    def _get_macos_wallpaper(self) -> str | None:
        script = 'tell application "System Events" to get POSIX path of picture of every desktop'
        output = self._try_subprocess(["osascript", "-e", script])
        if not output:
            return None

        for candidate in [
            item.strip()
            for item in output.replace(",", "\n").splitlines()
            if item.strip()
        ]:
            if Path(candidate).is_file():
                return candidate
        return None

    def _set_macos_wallpaper(self, image_path: Path) -> None:
        script = f'''
        tell application "System Events"
            tell every desktop
                set picture to "{image_path}"
            end tell
        end tell
        '''
        subprocess.run(["osascript", "-e", script], check=True)

    def _get_linux_wallpaper(self) -> str | None:
        schemas = [
            ("org.gnome.desktop.background", "picture-uri-dark"),
            ("org.gnome.desktop.background", "picture-uri"),
            ("org.cinnamon.desktop.background", "picture-uri"),
            ("org.mate.background", "picture-filename"),
        ]
        for schema, key in schemas:
            output = self._try_subprocess(["gsettings", "get", schema, key])
            if not output:
                continue
            normalized = output.strip().strip("'\"")
            for candidate in [
                item.strip() for item in normalized.split(",") if item.strip()
            ]:
                path = self._from_file_uri(candidate)
                if Path(path).is_file():
                    return path

        kde_conf = Path.home() / ".config" / "plasma-org.kde.plasma.desktop-appletsrc"
        if kde_conf.is_file():
            for line in reversed(
                kde_conf.read_text(encoding="utf-8", errors="ignore").splitlines()
            ):
                if line.startswith("Image="):
                    path = self._from_file_uri(line.split("=", 1)[1].strip())
                    if Path(path).is_file():
                        return path

        props_output = self._try_subprocess(
            [
                "xfconf-query",
                "--channel",
                "xfce4-desktop",
                "--property",
                "/backdrop",
                "--list",
            ],
        )
        if props_output:
            for prop in [
                item.strip() for item in props_output.splitlines() if item.strip()
            ]:
                if not (prop.endswith("image-path") or prop.endswith("last-image")):
                    continue
                value = self._try_subprocess(
                    ["xfconf-query", "--channel", "xfce4-desktop", "--property", prop],
                )
                if not value:
                    continue
                path = self._from_file_uri(value.strip())
                if Path(path).is_file():
                    return path

        return None

    def _set_linux_wallpaper(self, image_path: Path) -> None:
        desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").lower()
        session = os.environ.get("DESKTOP_SESSION", "").lower()
        uri = image_path.as_uri()

        if {"gnome", "unity", "budgie"} & {desktop, session}:
            subprocess.run(
                [
                    "gsettings",
                    "set",
                    "org.gnome.desktop.background",
                    "picture-uri",
                    uri,
                ],
                check=True,
            )
            return

        if "mate" in desktop:
            subprocess.run(
                [
                    "gsettings",
                    "set",
                    "org.mate.background",
                    "picture-filename",
                    str(image_path),
                ],
                check=True,
            )
            return

        if "cinnamon" in desktop:
            subprocess.run(
                [
                    "gsettings",
                    "set",
                    "org.cinnamon.desktop.background",
                    "picture-uri",
                    uri,
                ],
                check=True,
            )
            return

        if "xfce" in desktop or "xfce" in session:
            result = subprocess.run(
                ["xfconf-query", "-c", "xfce4-desktop", "-p", "/backdrop", "-l"],
                capture_output=True,
                text=True,
                check=False,
            )
            for line in result.stdout.splitlines():
                if "image-path" in line or "last-image" in line:
                    subprocess.run(
                        [
                            "xfconf-query",
                            "-c",
                            "xfce4-desktop",
                            "-p",
                            line,
                            "-s",
                            str(image_path),
                        ],
                        check=False,
                    )
            return

        if "kde" in desktop or "plasma" in desktop:
            script = f"""
            var allDesktops = desktops();
            for (i = 0; i < allDesktops.length; i++) {{
                d = allDesktops[i];
                d.wallpaperPlugin = "org.kde.image";
                d.currentConfigGroup = ["Wallpaper", "org.kde.image", "General"];
                d.writeConfig("Image", "file://{image_path}");
            }}
            """
            subprocess.run(
                [
                    "qdbus",
                    "org.kde.plasmashell",
                    "/PlasmaShell",
                    "org.kde.PlasmaShell.evaluateScript",
                    script,
                ],
                check=True,
            )
            return

        if "deepin" in desktop:
            subprocess.run(
                [
                    "gsettings",
                    "set",
                    "com.deepin.wrap.gnome.desktop.background",
                    "picture-uri",
                    uri,
                ],
                check=True,
            )
            return

        if {"lxde", "lxqt"} & {desktop, session}:
            subprocess.run(["pcmanfm", "--set-wallpaper", str(image_path)], check=False)
            return

        gsettings = shutil.which("gsettings")
        if gsettings:
            result = subprocess.run(
                [gsettings, "set", "org.gnome.desktop.background", "picture-uri", uri],
                check=False,
            )
            subprocess.run(
                [
                    gsettings,
                    "set",
                    "org.gnome.desktop.background",
                    "picture-uri-dark",
                    uri,
                ],
                check=False,
            )
            if result.returncode == 0:
                return

        if shutil.which("feh"):
            subprocess.run(["feh", "--bg-scale", str(image_path)], check=True)
            return
        if shutil.which("nitrogen"):
            subprocess.run(["nitrogen", "--set-scaled", str(image_path)], check=True)
            return

        raise RuntimeError("无法识别当前 Linux 桌面环境或缺少设置工具")

    def _try_subprocess(self, cmd: list[str]) -> str | None:
        try:
            return subprocess.check_output(cmd, text=True).strip()
        except Exception:
            return None

    def _from_file_uri(self, raw: str) -> str:
        if raw.startswith("file://"):
            return unquote(urlparse(raw).path)
        return unquote(raw)

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
            logger.debug("build wallpaper preview failed: {}", exc)
            return None
