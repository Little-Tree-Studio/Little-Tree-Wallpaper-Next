from __future__ import annotations

import unittest
from contextlib import nullcontext
from threading import Event, RLock
from unittest.mock import MagicMock, patch

from backend.api import BackendAPI
from backend.services.dynamic_wallpaper import WindowsDynamicWallpaperService


class FakeWindow:
    def __init__(self) -> None:
        self.scripts: list[str] = []
        self.urls: list[str] = []

    def evaluate_js(self, script: str) -> None:
        self.scripts.append(script)

    def load_url(self, url: str) -> None:
        self.urls.append(url)


class DynamicWallpaperServiceTests(unittest.TestCase):
    def test_stop_releases_media_and_clears_references(self) -> None:
        service = WindowsDynamicWallpaperService()
        window = FakeWindow()
        service._window = window
        service._attached = True
        service._media_path = "C:/video.mp4"
        service._media_revision = 4
        service._media_paths = {4: service._media_path}

        service.stop()

        self.assertTrue(any("removeAttribute('src')" in script for script in window.scripts))
        self.assertEqual(window.urls, ["about:blank"])
        self.assertEqual(service._media_path, "")
        self.assertEqual(service._media_paths, {})
        self.assertEqual(service._media_revision, 5)
        self.assertFalse(service.requires_static_wallpaper_confirmation())

    @patch("backend.services.dynamic_wallpaper.threading.Thread")
    def test_start_returns_snapshot_without_running_diagnostics(self, thread_type: MagicMock) -> None:
        service = WindowsDynamicWallpaperService()
        service.diagnose = MagicMock()

        result = service.start("C:/video.mp4")

        thread_type.return_value.start.assert_called_once_with()
        service.diagnose.assert_not_called()
        self.assertTrue(result["operation_busy"])
        self.assertEqual(result["operation_phase"], "queued")
        service._operation_lock.release()

    @patch("backend.services.dynamic_wallpaper.threading.Thread")
    def test_start_releases_operation_lock_when_thread_fails(self, thread_type: MagicMock) -> None:
        service = WindowsDynamicWallpaperService()
        thread_type.return_value.start.side_effect = RuntimeError("thread failed")

        with self.assertRaisesRegex(RuntimeError, "thread failed"):
            service.start("C:/video.mp4")

        self.assertFalse(service._operation_lock.locked())
        self.assertEqual(service._operation_phase, "idle")

    def test_diagnose_does_not_wait_for_slow_probe(self) -> None:
        service = WindowsDynamicWallpaperService()
        probe_started = Event()
        release_probe = Event()

        def slow_probe() -> None:
            probe_started.set()
            release_probe.wait(timeout=1)
            service._diagnostic_lock.release()

        service._run_diagnostic_probe = slow_probe

        result = service.diagnose()

        self.assertTrue(probe_started.wait(timeout=1))
        self.assertEqual(result["operation_phase"], "idle")
        self.assertTrue(service._diagnostic_lock.locked())
        release_probe.set()

    def test_inactive_service_rejects_old_telemetry(self) -> None:
        service = WindowsDynamicWallpaperService()
        service._media_revision = 3
        service.update_telemetry({"media_revision": 3, "event": "playing"})
        self.assertFalse(service._telemetry["received"])


class BackgroundWallpaperConfirmationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = BackendAPI.__new__(BackendAPI)
        self.api.store = MagicMock()
        self.api.store.transaction.return_value = nullcontext()
        self.api._storage_references_lock = RLock()
        self.api.dynamic_wallpaper_service = MagicMock()
        self.api._pending_wallpaper_lock = RLock()
        self.api._pending_static_wallpaper = None
        self.api._desktop_notify = MagicMock()
        self.api.add_to_history = MagicMock()

    @patch("backend.api.set_sys_wallpaper")
    def test_background_request_is_queued_and_not_applied(self, set_system: MagicMock) -> None:
        self.api.dynamic_wallpaper_service.requires_static_wallpaper_confirmation.return_value = True

        result = self.api._request_background_wallpaper("C:/still.jpg")

        self.assertTrue(result["queued"])
        self.assertEqual(self.api.get_pending_static_wallpaper()["path"], "C:/still.jpg")
        self.api._desktop_notify.assert_called_once()
        set_system.assert_not_called()

    @patch("backend.api.set_sys_wallpaper")
    def test_confirming_pending_request_stops_then_applies(self, set_system: MagicMock) -> None:
        self.api.dynamic_wallpaper_service.requires_static_wallpaper_confirmation.return_value = True
        self.api.dynamic_wallpaper_service.wait_until_idle.return_value = True
        calls: list[str] = []
        self.api.dynamic_wallpaper_service.stop.side_effect = lambda: calls.append("stop")
        set_system.side_effect = lambda _path: calls.append("set")
        queued = self.api._request_background_wallpaper("C:/still.jpg")

        result = self.api.resolve_pending_static_wallpaper(queued["task_id"], True)

        self.assertTrue(result["success"])
        self.assertEqual(calls, ["stop", "set"])
        self.assertIsNone(self.api.get_pending_static_wallpaper())

    def test_latest_background_request_replaces_previous_one(self) -> None:
        self.api.dynamic_wallpaper_service.requires_static_wallpaper_confirmation.return_value = True
        first = self.api._request_background_wallpaper("C:/first.jpg")
        second = self.api._request_background_wallpaper("C:/second.jpg")

        self.assertNotEqual(first["task_id"], second["task_id"])
        self.assertEqual(self.api.get_pending_static_wallpaper()["path"], "C:/second.jpg")


if __name__ == "__main__":
    unittest.main()
