import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.api import BackendAPI, _version_key


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self.payload


class _DownloadResponse:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.url = "https://example.com/update.exe"
        self.headers = {"Content-Length": str(len(payload))}

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int):
        yield self.payload

    def close(self) -> None:
        return None


class UpdateApiTests(unittest.TestCase):
    def test_version_key_compares_numeric_segments(self) -> None:
        self.assertGreater(_version_key("2.10.0"), _version_key("2.9.9"))
        self.assertEqual(_version_key("2.0"), _version_key("2.0.0"))

    @patch("backend.api.platform.machine", return_value="AMD64")
    @patch("backend.api.sys.platform", "win32")
    @patch("backend.api.VERSION", "2.0.0")
    @patch("requests.get")
    def test_check_for_updates_selects_current_platform_package(self, get, _machine) -> None:
        get.side_effect = [
            _Response([
                {"id": "beta", "name": "测试版", "order": 1},
                {"id": "stable", "name": "正式版", "description": "稳定更新", "order": 0},
            ]),
            _Response({
                "version": "2.1.0",
                "channel": "stable",
                "release_note": "修复问题",
                "platforms": {
                    "windows": {
                        "x64": {
                            "download_url": "https://example.com/update.exe",
                            "size_bytes": 1024,
                            "sha256": "abc",
                        }
                    }
                },
            }),
        ]
        api = BackendAPI.__new__(BackendAPI)
        api.store = MagicMock()

        result = api.check_for_updates("stable")

        self.assertTrue(result["has_update"])
        self.assertEqual(result["selected_channel"], "stable")
        self.assertEqual(result["channels"][0]["id"], "stable")
        self.assertEqual(result["package"]["download_url"], "https://example.com/update.exe")
        self.assertEqual(result["architecture"], "x64")

    @patch("requests.get")
    def test_forced_update_download_verifies_and_reuses_package(self, get) -> None:
        payload = b"signed update package"
        digest = hashlib.sha256(payload).hexdigest()
        get.return_value = _DownloadResponse(payload)

        with tempfile.TemporaryDirectory() as directory:
            api = BackendAPI.__new__(BackendAPI)
            api.store = MagicMock()
            api.store.get.return_value = directory

            first = api.download_update_package(
                "2.1.0",
                "https://example.com/update.exe",
                digest,
                len(payload),
            )
            second = api.download_update_package(
                "2.1.0",
                "https://example.com/update.exe",
                digest,
                len(payload),
            )

            self.assertEqual(Path(first["path"]).read_bytes(), payload)
            self.assertFalse(first["already_downloaded"])
            self.assertTrue(second["already_downloaded"])
            get.assert_called_once()

    @patch("requests.get")
    def test_forced_update_download_rejects_checksum_mismatch(self, get) -> None:
        payload = b"tampered update package"
        get.return_value = _DownloadResponse(payload)

        with tempfile.TemporaryDirectory() as directory:
            api = BackendAPI.__new__(BackendAPI)
            api.store = MagicMock()
            api.store.get.return_value = directory

            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                api.download_update_package(
                    "2.1.0",
                    "https://example.com/update.exe",
                    "0" * 64,
                    len(payload),
                )

            update_directory = Path(directory) / "updates"
            self.assertFalse((update_directory / "update.exe").exists())
            self.assertFalse((update_directory / "update.exe.part").exists())


if __name__ == "__main__":
    unittest.main()
