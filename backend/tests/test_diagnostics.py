from __future__ import annotations

import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend import diagnostics
from backend.api import BackendAPI


class RedactSettingsTests(unittest.TestCase):
    def test_masks_sensitive_keys_and_keeps_others(self) -> None:
        settings = {
            "generate": {"providers": [{"id": "x", "name": "X", "apiKey": "secret-value"}]},
            "download": {"proxy": {"server": "http://user:pass@127.0.0.1:7890"}},
            "store": {"custom_source_url": "https://example.com/source.json?token=abc&x=1"},
            "endpoint": "https://api.example.com/v1?key=plain-key&model=flux",
            "ui": {"language": "zh-CN"},
            "empty": {"apiKey": ""},
        }
        redacted = diagnostics.redact_settings(settings)

        provider = redacted["generate"]["providers"][0]
        self.assertEqual(provider["apiKey"], diagnostics.REDACTED)
        self.assertEqual(provider["name"], "X")
        self.assertIn(diagnostics.REDACTED, redacted["download"]["proxy"]["server"])
        self.assertNotIn("pass", redacted["download"]["proxy"]["server"])
        self.assertIn(diagnostics.REDACTED, redacted["store"]["custom_source_url"])
        self.assertNotIn("abc", redacted["store"]["custom_source_url"])
        self.assertIn("x=1", redacted["store"]["custom_source_url"])
        self.assertEqual(redacted["ui"]["language"], "zh-CN")
        self.assertEqual(redacted["empty"]["apiKey"], "")
        self.assertNotIn("plain-key", redacted["endpoint"])
        self.assertIn("model=flux", redacted["endpoint"])

        # The caller's settings must not be modified in place.
        self.assertEqual(settings["generate"]["providers"][0]["apiKey"], "secret-value")


class DiagnosticsArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.log_dir = self.root / "logs"
        self.crash_dir = self.root / "crash_reports"
        self.log_dir.mkdir()
        self.crash_dir.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write(self, directory: Path, name: str, content: str, mtime: float) -> Path:
        path = directory / name
        path.write_text(content, encoding="utf-8")
        os.utime(path, (mtime, mtime))
        return path

    def test_collect_attachments_orders_current_logs_first(self) -> None:
        self._write(self.log_dir, "app_old.log", "old", 1_600_000_100.0)
        self._write(self.log_dir, "app_new.log", "new", 1_600_000_300.0)
        self._write(self.log_dir, "error_new.log", "error", 1_600_000_200.0)
        self._write(self.crash_dir, "crash_report_a.txt", "crash", 1_600_000_100.0)

        attachments = diagnostics.collect_attachments(self.log_dir, self.crash_dir)
        names = [arcname for _, arcname in attachments]

        self.assertEqual(names[0], "logs/app_new.log")
        self.assertEqual(names[1], "logs/error_new.log")
        self.assertIn("logs/app_old.log", names)
        self.assertIn("crash_reports/crash_report_a.txt", names)

    def test_writes_report_settings_and_attachments(self) -> None:
        log = self._write(self.log_dir, "app_1.log", "hello log", 1_600_000_000.0)
        crash = self._write(self.crash_dir, "crash_report_1.txt", "trace", 1_600_000_000.0)
        destination = self.root / "diag.zip"

        summary = diagnostics.write_diagnostics_archive(
            destination,
            report={"generated_at": "now", "app": {}, "system": {}, "paths": {}, "runtime": {"x": 1}},
            settings={"generate": {"providers": [{"apiKey": "value"}]}},
            attachments=[(log, "logs/app_1.log"), (crash, "crash_reports/crash_report_1.txt")],
        )

        self.assertEqual(summary["attachment_count"], 2)
        self.assertEqual(summary["skipped_count"], 0)
        self.assertGreater(summary["size_bytes"], 0)
        with zipfile.ZipFile(destination) as archive:
            names = set(archive.namelist())
            self.assertTrue({"diagnostics.json", "settings.json", "report.md"} <= names)
            self.assertIn("logs/app_1.log", names)
            self.assertIn("crash_reports/crash_report_1.txt", names)
            report = json.loads(archive.read("diagnostics.json"))
            self.assertEqual(report["files"]["included_count"], 2)
            self.assertEqual(report["files"]["attachments"][0]["path"], "logs/app_1.log")
            self.assertEqual(
                archive.read("settings.json"),
                json.dumps({"generate": {"providers": [{"apiKey": "value"}]}}, ensure_ascii=False, indent=2).encode(
                    "utf-8"
                ),
            )

    def test_oversized_attachment_is_listed_but_skipped(self) -> None:
        small = self._write(self.log_dir, "app_small.log", "ok", 1_600_000_000.0)
        big = self._write(self.log_dir, "app_big.log", "x" * 64, 1_600_000_000.0)
        destination = self.root / "diag.zip"

        with patch.object(diagnostics, "MAX_ATTACHMENT_BYTES", 8):
            summary = diagnostics.write_diagnostics_archive(
                destination,
                report={"generated_at": "now"},
                settings={},
                attachments=[(small, "logs/app_small.log"), (big, "logs/app_big.log")],
            )

        self.assertEqual(summary["attachment_count"], 1)
        self.assertEqual(summary["skipped_count"], 1)
        with zipfile.ZipFile(destination) as archive:
            self.assertIn("logs/app_small.log", archive.namelist())
            self.assertNotIn("logs/app_big.log", archive.namelist())
            report = json.loads(archive.read("diagnostics.json"))
            skipped = report["files"]["skipped_attachments"]
            self.assertEqual(skipped[0]["path"], "logs/app_big.log")
            self.assertIn("过大", skipped[0]["reason"])


class ExportDiagnosticsApiTests(unittest.TestCase):
    def _api(self) -> BackendAPI:
        api = BackendAPI.__new__(BackendAPI)
        api.store = SimpleNamespace(  # type: ignore[assignment]
            as_dict=lambda: {"generate": {"providers": [{"apiKey": "secret-value"}]}, "ui": {"language": "zh-CN"}}
        )
        api._collect_diagnostics_report = lambda: {  # type: ignore[method-assign]
            "generated_at": "now",
            "app": {},
            "system": {},
            "paths": {},
            "runtime": {},
        }
        return api

    def test_export_writes_redacted_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "diag.zip"
            with patch("backend.diagnostics.collect_attachments", return_value=[]):
                result = self._api().export_diagnostics(str(destination))

            self.assertEqual(result["saved_path"], str(destination))
            self.assertEqual(result["attachment_count"], 0)
            with zipfile.ZipFile(destination) as archive:
                settings = json.loads(archive.read("settings.json"))
            self.assertEqual(settings["generate"]["providers"][0]["apiKey"], diagnostics.REDACTED)
            self.assertEqual(settings["ui"]["language"], "zh-CN")

    def test_cancelled_dialog_returns_cancelled_without_writing(self) -> None:
        api = self._api()
        with (
            patch("backend.diagnostics.collect_attachments", return_value=[]),
            patch("backend.api.BackendAPI._show_file_dialog", return_value=None) as dialog,
        ):
            result = api.export_diagnostics()

        self.assertEqual(result, {"saved_path": "", "cancelled": True})
        dialog.assert_called_once()


if __name__ == "__main__":
    unittest.main()
