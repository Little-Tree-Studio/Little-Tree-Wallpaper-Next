"""Optional standalone image-classification runtime management."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

from backend.paths import get_data_dir
from backend.settings_manager import normalize_update_mirror


MODEL_INDEX = "https://wallpaper.api.zsxiaoshu.cn/core/update/{channel}/model.json"
DEFAULT_MODEL_ROOT = get_data_dir() / "components" / "classifier"


class ClassifierService:
    def __init__(self, store: Any):
        self.store = store
        self._lock = threading.RLock()
        self._worker: subprocess.Popen[str] | None = None
        self._worker_root: Path | None = None
        self._download: dict[str, Any] = {"phase": "idle", "progress": 0.0, "error": ""}

    def _channel(self) -> str:
        return str(self.store.get("updates.channel", "stable") or "stable")

    def model_root(self) -> Path:
        configured = str(self.store.get("classifier.directory", "") or "").strip()
        return Path(configured).expanduser() if configured else DEFAULT_MODEL_ROOT

    def _mirror(self) -> str:
        return normalize_update_mirror(self.store.get("updates.mirror", ""))

    def _download_url(self, url: str) -> str:
        mirror = self._mirror()
        parsed = urlparse(url)
        if mirror and parsed.hostname and (parsed.hostname == "github.com" or parsed.hostname.endswith(".githubusercontent.com")):
            return f"{mirror}{url}"
        return url

    def _index_url(self) -> str:
        return MODEL_INDEX.format(channel=self._channel())

    def get_classifier_catalog(self) -> dict[str, Any]:
        response = requests.get(self._index_url(), timeout=(10, 30))
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("模型清单格式无效")
        data["channel"] = self._channel()
        data["index_url"] = self._index_url()
        return data

    def _current_version(self) -> str:
        path = self.model_root() / "current.json"
        try:
            return str(json.loads(path.read_text(encoding="utf-8")).get("active_version") or "")
        except Exception:
            return ""

    def get_classifier_status(self) -> dict[str, Any]:
        version = self._current_version()
        root = self.model_root() / version if version else None
        installed = bool(
            root
            and (root / "manifest.json").is_file()
            and ((root / "classifier-worker.exe").is_file() or (root / "classifier-worker.py").is_file())
        )
        return {
            "installed": installed,
            "version": version,
            "root": str(root) if installed else "",
            "directory": str(self.model_root()),
            "download": dict(self._download),
            "channel": self._channel(),
            "mirror": self._mirror(),
        }

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def install_classifier(self, package: dict[str, Any]) -> dict[str, Any]:
        version = str(package.get("version") or package.get("latest_version") or "").strip()
        url = str(package.get("download_url") or package.get("url") or "").strip()
        expected = str(package.get("sha256") or "").lower().strip()
        if not version or not url or urlparse(url).scheme != "https":
            raise ValueError("模型安装包信息无效")
        model_root = self.model_root()
        destination = model_root / version
        model_root.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._download = {"phase": "downloading", "version": version, "progress": 0.0, "error": ""}
        archive = model_root / f".classifier-{version}.part"
        temporary = Path(tempfile.mkdtemp(prefix="classifier-", dir=model_root))
        try:
            response = requests.get(self._download_url(url), stream=True, timeout=(10, 300))
            response.raise_for_status()
            total = int(response.headers.get("Content-Length") or package.get("size_bytes") or 0)
            received = 0
            with archive.open("wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    if not chunk:
                        continue
                    output.write(chunk)
                    received += len(chunk)
                    with self._lock:
                        self._download.update({"received_bytes": received, "total_bytes": total, "progress": round(received * 100 / total, 2) if total else 0.0})
            if expected and self._sha256(archive).lower() != expected:
                raise ValueError("模型安装包 SHA-256 校验失败")
            with self._lock:
                self._download.update({"phase": "installing", "progress": 100.0})
            with zipfile.ZipFile(archive) as bundle:
                for member in bundle.infolist():
                    target = (temporary / member.filename).resolve()
                    if not str(target).startswith(str(temporary.resolve()) + os.sep):
                        raise ValueError("模型安装包包含无效路径")
                bundle.extractall(temporary)
            if not (temporary / "manifest.json").is_file():
                raise ValueError("模型安装包缺少 manifest.json")
            entry_ok = (temporary / "classifier-worker.exe").is_file() or (temporary / "classifier-worker.py").is_file()
            if not entry_ok:
                raise ValueError("模型安装包缺少 worker")
            backup = destination.with_name(f".{version}.previous")
            shutil.rmtree(backup, ignore_errors=True)
            if destination.exists():
                destination.replace(backup)
            temporary.replace(destination)
            (model_root / "current.json").write_text(json.dumps({"active_version": version}, indent=2), encoding="utf-8")
            shutil.rmtree(backup, ignore_errors=True)
            with self._lock:
                self._download = {"phase": "installed", "version": version, "progress": 100.0, "error": ""}
            return self.get_classifier_status()
        except Exception as exc:
            shutil.rmtree(temporary, ignore_errors=True)
            with self._lock:
                self._download = {"phase": "error", "version": version, "progress": 0.0, "error": str(exc)}
            raise
        finally:
            archive.unlink(missing_ok=True)

    def start_classifier_install(self, package: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            phase = str(self._download.get("phase") or "idle")
            if phase in {"downloading", "installing"}:
                return self.get_classifier_status()
            self._download = {"phase": "queued", "version": str(package.get("version") or package.get("latest_version") or ""), "progress": 0.0, "error": ""}

        def run() -> None:
            try:
                self.install_classifier(package)
            except Exception:
                # The detailed error is already persisted in the task state.
                pass

        threading.Thread(target=run, name="classifier-install", daemon=True).start()
        return self.get_classifier_status()

    def _stop_worker(self) -> None:
        if self._worker and self._worker.poll() is None:
            with contextlib.suppress(Exception):
                self._worker.stdin.write('{"action":"shutdown"}\n')
                self._worker.stdin.flush()
                self._worker.wait(timeout=3)
        if self._worker and self._worker.poll() is None:
            self._worker.kill()
        self._worker = None
        self._worker_root = None

    def _start_worker(self, root: Path) -> None:
        self._stop_worker()
        entry = root / "classifier-worker.exe"
        command = [str(entry)] if entry.is_file() else [os.fspath(__import__("sys").executable), "-X", "utf8", "-u", str(root / "classifier-worker.py")]
        self._worker = subprocess.Popen(
            command,
            cwd=root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        ready = self._worker.stdout.readline() if self._worker.stdout else ""
        payload = json.loads(ready)
        if not payload.get("ok") or payload.get("action") != "ready":
            raise RuntimeError(payload.get("error") or "分类 worker 启动失败")
        self._worker_root = root

    def classify(self, image_path: str, top_k: int = 3) -> list[dict[str, Any]]:
        with self._lock:
            # Preserve Windows filesystem surrogate escapes when a legacy
            # record contains a non-decodable filename.
            with contextlib.suppress(UnicodeError):
                image_path = os.fsdecode(os.fsencode(image_path))
            if not Path(image_path).is_file():
                raise FileNotFoundError(f"图片文件不存在: {image_path}")
            version = self._current_version()
            root = self.model_root() / version
            if not root.is_dir():
                raise RuntimeError("图片分类模型尚未安装")
            if self._worker_root != root or not self._worker or self._worker.poll() is not None:
                self._start_worker(root)
            assert self._worker and self._worker.stdin and self._worker.stdout
            # Escape non-ASCII characters on the pipe. This avoids Windows
            # console/code-page conversions corrupting filenames on stdin.
            request = json.dumps({"action": "classify", "image_path": image_path, "top_k": top_k}, ensure_ascii=True)
            self._worker.stdin.write(request + "\n")
            self._worker.stdin.flush()
            response = json.loads(self._worker.stdout.readline())
            if not response.get("ok"):
                raise RuntimeError(str(response.get("error") or "图片分类失败"))
            return list(response.get("results") or [])

    def classify_favorites(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Classify local favorite files and return replacement smart tags."""
        results: list[dict[str, Any]] = []
        for item in items:
            path = str(item.get("local_path") or "")
            if not path or not Path(path).is_file():
                results.append({"id": str(item.get("id") or ""), "smart_tags": [], "skipped": True})
                continue
            predictions = self.classify(path, 3)
            results.append({
                "id": str(item.get("id") or ""),
                "smart_tags": [str(result["label"]) for result in predictions if result.get("label")],
                "skipped": False,
            })
        return results
