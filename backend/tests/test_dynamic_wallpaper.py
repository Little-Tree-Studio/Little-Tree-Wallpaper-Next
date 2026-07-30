from __future__ import annotations

import unittest
import time
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


class BlockingWindow(FakeWindow):
    def __init__(self, release: Event) -> None:
        super().__init__()
        self.started = Event()
        self.release = release

    def evaluate_js(self, script: str) -> None:
        self.started.set()
        self.release.wait(timeout=2)
        super().evaluate_js(script)


class DynamicWallpaperServiceTests(unittest.TestCase):
    @patch("backend.services.dynamic_wallpaper.os.name", "nt")
    def test_hidden_host_handle_is_discovered_without_before_show_event(self) -> None:
        service = WindowsDynamicWallpaperService()
        window = FakeWindow()
        service._native_handle = MagicMock(return_value=1234)

        handle = service._wait_for_host_handle(window, timeout=0.1)

        self.assertEqual(handle, 1234)
        self.assertEqual(service._prepared_window_handle, 1234)
        self.assertTrue(service._host_ready.is_set())

    def test_stop_releases_media_and_clears_references(self) -> None:
        service = WindowsDynamicWallpaperService()
        window = FakeWindow()
        service._window = window
        service._attached = True
        service._media_path = "C:/video.mp4"
        service._media_revision = 4
        service._media_paths = {4: service._media_path}

        service.stop()

        self.assertEqual(window.scripts, [])
        self.assertEqual(window.urls, [])
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

    def test_stop_requests_cancellation_while_start_is_busy(self) -> None:
        service = WindowsDynamicWallpaperService()
        self.assertTrue(service._operation_lock.acquire(blocking=False))

        result = service.stop()

        self.assertTrue(service._stop_requested.is_set())
        self.assertEqual(result["operation_phase"], "stopping")
        self.assertEqual(result["last_operation"], "stop-requested")
        service._operation_lock.release()

    @patch("backend.services.dynamic_wallpaper.threading.Thread")
    def test_repeated_scene_apply_keeps_only_latest_pending_revision(self, thread_type: MagicMock) -> None:
        service = WindowsDynamicWallpaperService()

        first = service.start_scene(1, "image")
        second = service.start_scene(2, "slideshow")
        third = service.start_scene(3, "video")

        self.assertTrue(first["operation_busy"])
        self.assertEqual(second["last_operation"], "apply-scene-requested")
        self.assertEqual(third["last_operation"], "apply-scene-requested")
        self.assertEqual(service._pending_scene, (3, "video"))
        thread_type.return_value.start.assert_called_once_with()
        service._operation_lock.release()

    @patch("backend.services.dynamic_wallpaper.os.name", "nt")
    def test_running_scene_applies_revision_without_reloading_webview(self) -> None:
        service = WindowsDynamicWallpaperService()
        window = FakeWindow()
        service._window = window
        service._prepared_window_handle = 1234
        service._attached = True
        service._scene_runtime_loaded = True
        service._base_url = "http://127.0.0.1:8123"
        service._api_token = "secret"
        self.assertTrue(service._operation_lock.acquire(blocking=False))

        service._run_scene_start(7, "slideshow")

        self.assertEqual(window.urls, [])
        self.assertEqual(service._last_operation, "switch-scene")
        self.assertEqual(service._runtime_type, "slideshow")
        self.assertFalse(service._operation_lock.locked())

    @patch("backend.services.dynamic_wallpaper.threading.Thread")
    def test_scene_submitted_during_stop_starts_after_cleanup(self, thread_type: MagicMock) -> None:
        service = WindowsDynamicWallpaperService()
        self.assertTrue(service._operation_lock.acquire(blocking=False))
        service.stop()
        service.start_scene(9, "slideshow")
        service._operation_lock.release()

        service._finish_requested_stop()
        service._start_pending_scene()

        self.assertFalse(service._stop_requested.is_set())
        self.assertIsNone(service._pending_scene)
        thread_type.return_value.start.assert_called_once_with()
        service._operation_lock.release()

    def test_stop_does_not_wait_for_blocked_slideshow_cleanup(self) -> None:
        release = Event()
        window = BlockingWindow(release)
        service = WindowsDynamicWallpaperService()
        service._window = window
        service._attached = True

        started_at = time.monotonic()
        result = service.stop()
        elapsed = time.monotonic() - started_at

        self.assertLess(elapsed, 0.2)
        self.assertFalse(result["running"])
        self.assertFalse(window.started.wait(timeout=0.05))
        release.set()

    def test_finish_requested_stop_clears_runtime_after_operation(self) -> None:
        service = WindowsDynamicWallpaperService()
        window = FakeWindow()
        service._window = window
        service._attached = True
        service._stop_requested.set()

        service._finish_requested_stop()

        self.assertFalse(service._attached)
        self.assertFalse(service._stop_requested.is_set())
        self.assertEqual(window.scripts, [])
        self.assertEqual(window.urls, [])

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

    def test_scene_url_places_hash_route_before_route_query(self) -> None:
        service = WindowsDynamicWallpaperService()
        service._base_url = "http://127.0.0.1:8123"
        service._api_token = "secret"

        self.assertEqual(
            service.scene_url(42),
            "http://127.0.0.1:8123/?token=secret#/dynamic/runtime?revision=42",
        )

    def test_scene_controls_and_runtime_type(self) -> None:
        service = WindowsDynamicWallpaperService()
        window = FakeWindow()
        service._window = window
        service._attached = True
        service._prepared_window_handle = 1
        service._host_ready.set()
        service._runtime_type = "slideshow"
        service._runtime_mode = "scene"

        service.control("next")
        service.control("previous")

        self.assertIn("__ltwDynamicRuntime?.next", window.scripts[0])
        self.assertIn("__ltwDynamicRuntime?.previous", window.scripts[1])
        snapshot = service._status_snapshot()
        self.assertEqual(snapshot["dynamic_type"], "slideshow")
        self.assertEqual(snapshot["runtime_mode"], "scene")

        service.stop()
        self.assertEqual(service._runtime_type, "")
        self.assertEqual(service._runtime_mode, "")

    def test_video_auto_control_uses_both_runtime_bridges(self) -> None:
        service = WindowsDynamicWallpaperService()
        window = FakeWindow()
        service._window = window
        service._attached = True

        service.control("auto")

        self.assertIn("__ltwPlayer?.auto", window.scripts[0])
        self.assertIn("__ltwDynamicRuntime?.auto", window.scripts[0])


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


class DynamicWallpaperAutomationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = BackendAPI.__new__(BackendAPI)
        self.api.dynamic_wallpaper_service = MagicMock()
        self.api.get_dynamic_wallpaper_scene = MagicMock(return_value={
            "background": {
                "type": "slideshow",
                "path": "C:/old",
                "source": "folder",
                "folder_id": "",
                "items": [],
                "interval_seconds": 30,
                "transition": "fade",
                "transition_duration": 900,
                "shuffle": False,
                "muted": True,
                "loop": True,
                "playback_rate": 1.0,
                "autoplay": True,
            },
            "widgets": [{"id": "clock", "type": "builtin:clock"}],
            "revision": 1,
        })
        self.api.save_dynamic_wallpaper_scene = MagicMock(side_effect=lambda scene: scene)
        self.api.start_dynamic_wallpaper_scene = MagicMock(return_value={"running": True})

    def test_slideshow_update_preserves_widgets(self) -> None:
        result = self.api.automation_dynamic_wallpaper({
            "action": "slideshow_transition",
            "transition": "wipe",
            "transition_duration": 1200,
        })

        saved = self.api.save_dynamic_wallpaper_scene.call_args.args[0]
        self.assertEqual(saved["widgets"], [{"id": "clock", "type": "builtin:clock"}])
        self.assertEqual(saved["background"]["transition"], "wipe")
        self.assertEqual(result["type"], "slideshow")

    def test_replace_video_can_start_paused(self) -> None:
        self.api.automation_dynamic_wallpaper({
            "action": "replace_video",
            "path": "C:/new.mp4",
            "video_action": "pause",
            "muted": False,
            "loop": False,
            "playback_rate": 1.5,
        })

        background = self.api.save_dynamic_wallpaper_scene.call_args.args[0]["background"]
        self.assertEqual(background["type"], "video")
        self.assertFalse(background["autoplay"])
        self.assertFalse(background["muted"])
        self.assertFalse(background["loop"])
        self.assertEqual(background["playback_rate"], 1.5)


class DynamicWallpaperWindowLifecycleTests(unittest.TestCase):
    def test_shutdown_destroys_hidden_widget_editor(self) -> None:
        api = BackendAPI.__new__(BackendAPI)
        api.dynamic_wallpaper_service = MagicMock()
        api._dynamic_editor_window = MagicMock()
        api._dynamic_editor_allow_close = False
        editor = api._dynamic_editor_window

        api.shutdown_dynamic_wallpaper()

        api.dynamic_wallpaper_service.shutdown.assert_called_once_with()
        editor.destroy.assert_called_once_with()
        self.assertIsNone(api._dynamic_editor_window)
        self.assertTrue(api._dynamic_editor_allow_close)

    def test_scene_normalizes_builtin_widget_content(self) -> None:
        api = BackendAPI.__new__(BackendAPI)

        scene = api._normalize_dynamic_scene({
            "widgets": [
                {
                    "id": "note",
                    "type": "builtin:note",
                    "x": 10,
                    "y": 12,
                    "width": 30,
                    "height": 24,
                    "settings": {"title": "提醒", "content": "A" * 600, "ignored": "value"},
                },
            ],
        })

        settings = scene["widgets"][0]["settings"]
        self.assertEqual(settings["title"], "提醒")
        self.assertEqual(len(settings["content"]), 500)
        self.assertNotIn("ignored", settings)


if __name__ == "__main__":
    unittest.main()
