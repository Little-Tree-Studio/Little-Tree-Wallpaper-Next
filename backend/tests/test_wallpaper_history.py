from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from backend.api import BackendAPI


def _make_api(settings: dict[str, object] | None = None) -> BackendAPI:
    api = BackendAPI.__new__(BackendAPI)
    defaults = {
        "wallpaper.history.record_mode": "auto",
        "wallpaper.history.auto_record_interval_seconds": 30,
        "wallpaper.history.record_dynamic_snapshot": False,
    }
    merged = {**defaults, **(settings or {})}
    store = MagicMock()
    store.get.side_effect = lambda key, default=None: merged.get(key, default)
    api.store = store
    api._history_monitor_lock = __import__("threading").RLock()
    api._history_monitor_stop = __import__("threading").Event()
    api._history_monitor_thread = None
    api._history_monitor_last_path = "C:/old.jpg"
    api._history_monitor_next_check = 0.0
    api._recent_applied = {}
    api.add_to_history = MagicMock()
    return api


class WallpaperHistorySettingsTests(unittest.TestCase):
    def test_new_install_receives_recording_defaults(self) -> None:
        import tempfile
        from pathlib import Path

        from backend.settings_manager import SettingsStore

        with tempfile.TemporaryDirectory() as directory:
            store = SettingsStore(Path(directory) / "config.json")

            self.assertEqual(store.get("wallpaper.history.record_mode"), "auto")
            self.assertEqual(store.get("wallpaper.history.auto_record_interval_seconds"), 30)
            self.assertFalse(store.get("wallpaper.history.record_dynamic_snapshot"))

    def test_invalid_recording_settings_are_normalized(self) -> None:
        import json
        import tempfile
        from pathlib import Path

        from backend.settings_manager import SettingsStore

        payload = {
            "wallpaper": {
                "history": {
                    "record_mode": "yolo",
                    "auto_record_interval_seconds": 99999,
                }
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            store = SettingsStore(path)

            self.assertEqual(store.get("wallpaper.history.record_mode"), "auto")
            self.assertEqual(store.get("wallpaper.history.auto_record_interval_seconds"), 3600)


class WallpaperMonitorTests(unittest.TestCase):
    @patch("backend.api.get_sys_wallpaper", return_value="C:/new.jpg")
    def test_external_change_is_recorded_in_auto_mode(self, _get: MagicMock) -> None:
        api = _make_api()

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_called_once_with("C:/new.jpg", "new.jpg", "external")
        self.assertEqual(api._history_monitor_last_path, "C:/new.jpg")

    @patch("backend.api.get_sys_wallpaper", return_value="C:/new.jpg")
    def test_manual_mode_only_updates_baseline(self, _get: MagicMock) -> None:
        api = _make_api({"wallpaper.history.record_mode": "manual"})

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_not_called()
        self.assertEqual(api._history_monitor_last_path, "C:/new.jpg")

    @patch("backend.api.get_sys_wallpaper", return_value="C:/old.jpg")
    def test_unchanged_wallpaper_is_not_recorded(self, _get: MagicMock) -> None:
        api = _make_api()

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_not_called()

    @patch("backend.api.get_sys_wallpaper", return_value="")
    def test_unreadable_wallpaper_keeps_baseline(self, _get: MagicMock) -> None:
        api = _make_api()

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_not_called()
        self.assertEqual(api._history_monitor_last_path, "C:/old.jpg")

    @patch("backend.api.get_sys_wallpaper", return_value="C:/applied.jpg")
    def test_recently_applied_wallpaper_is_not_recorded_twice(self, _get: MagicMock) -> None:
        api = _make_api()
        api._note_wallpaper_applied("C:/applied.jpg")

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_not_called()

    def test_applied_note_expires_after_window(self) -> None:
        api = _make_api()
        api._note_wallpaper_applied("C:/applied.jpg")
        api._recent_applied[
            __import__("os").path.normcase(__import__("os").path.abspath("C:/applied.jpg"))
        ] -= BackendAPI._HISTORY_APPLY_WINDOW_SECONDS + 1

        self.assertFalse(api._is_recently_applied_by_app("C:/applied.jpg"))

    @patch("backend.api.get_sys_wallpaper", return_value="C:/snapshot-0.jpg")
    def test_dynamic_snapshot_recorded_when_enabled(self, _get: MagicMock) -> None:
        api = _make_api({"wallpaper.history.record_dynamic_snapshot": True})
        applied_at = datetime.now().astimezone() - timedelta(seconds=5)
        api.dynamic_wallpaper_service = MagicMock()
        api.dynamic_wallpaper_service.last_static_snapshot_apply.return_value = {
            "path": "C:/snapshot-0.jpg",
            "at": applied_at.isoformat(timespec="seconds"),
        }

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_called_once_with("C:/snapshot-0.jpg", "snapshot-0.jpg", "dynamic")

    @patch("backend.api.get_sys_wallpaper", return_value="C:/snapshot-1.jpg")
    def test_dynamic_snapshot_skipped_when_disabled(self, _get: MagicMock) -> None:
        api = _make_api()
        applied_at = datetime.now().astimezone() - timedelta(seconds=5)
        api.dynamic_wallpaper_service = MagicMock()
        api.dynamic_wallpaper_service.last_static_snapshot_apply.return_value = {
            "path": "C:/snapshot-1.jpg",
            "at": applied_at.isoformat(timespec="seconds"),
        }

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_not_called()

    @patch("backend.api.get_sys_wallpaper", return_value="C:/random.jpg")
    def test_old_snapshot_stale_change_is_external(self, _get: MagicMock) -> None:
        api = _make_api({"wallpaper.history.record_dynamic_snapshot": True})
        stale_at = datetime.now().astimezone() - timedelta(hours=2)
        api.dynamic_wallpaper_service = MagicMock()
        api.dynamic_wallpaper_service.last_static_snapshot_apply.return_value = {
            "path": "C:/random.jpg",
            "at": stale_at.isoformat(timespec="seconds"),
        }

        api._check_system_wallpaper_change(30)

        api.add_to_history.assert_called_once_with("C:/random.jpg", "random.jpg", "external")


if __name__ == "__main__":
    unittest.main()
