from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.settings_manager import POLLINATIONS_PROVIDER_ID, SettingsStore


class SettingsStoreMigrationTests(unittest.TestCase):
    def test_new_runtime_preferences_receive_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SettingsStore(Path(directory) / "config.json")

            self.assertEqual(store.get("im.mirror_preference"), "auto")
            self.assertTrue(store.get("im.auto_health_check"))
            self.assertEqual(store.get("download.timeout_seconds"), 120)
            self.assertEqual(store.get("download.concurrent_tasks"), 3)
            self.assertEqual(store.get("wallpaper.history.max_items"), 200)
            self.assertEqual(store.get("sniff.max_results"), 300)
            self.assertEqual(store.get("create.export_format"), "png")
            self.assertEqual(store.get("generate.prompt_history_limit"), 12)
            self.assertTrue(store.get("ui.hide_on_close"))
            self.assertTrue(store.get("ui.minimize_to_tray"))
            self.assertFalse(store.get("ui.release_webview_on_close"))
            self.assertFalse(store.get("startup.auto_start"))
            self.assertTrue(store.get("startup.hide_on_launch"))
            self.assertEqual(store.get("wallpaper.dynamic.background.type"), "image")
            self.assertEqual(store.get("wallpaper.dynamic.widgets"), [])
            self.assertFalse(store.get("wallpaper.dynamic.static_snapshot.enabled"))
            self.assertEqual(
                store.get("wallpaper.dynamic.performance"),
                {
                    "other_application_focused": "keep_running",
                    "other_application_maximized": "keep_running",
                    "other_application_fullscreen": "keep_running",
                    "other_application_audio": "keep_running",
                    "on_battery": "keep_running",
                },
            )

    def test_invalid_dynamic_performance_action_is_reset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps({"wallpaper": {"dynamic": {"performance": {"on_battery": "destroy"}}}}),
                encoding="utf-8",
            )

            store = SettingsStore(path)

            self.assertEqual(store.get("wallpaper.dynamic.performance.on_battery"), "keep_running")

    def test_stop_dynamic_performance_action_is_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps({"wallpaper": {"dynamic": {"performance": {"on_battery": "stop"}}}}),
                encoding="utf-8",
            )

            store = SettingsStore(path)

            self.assertEqual(store.get("wallpaper.dynamic.performance.on_battery"), "stop")

    def test_invalid_legacy_mirror_is_migrated_without_losing_custom_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps({
                    "im": {"mirror_preference": "mirror_first"},
                    "download": {"concurrent_tasks": 6},
                    "generate": {"providers": []},
                }),
                encoding="utf-8",
            )

            store = SettingsStore(path)

            self.assertEqual(store.get("im.mirror_preference"), "auto")
            self.assertEqual(store.get("download.concurrent_tasks"), 6)
            providers = store.get("generate.providers")
            self.assertEqual(providers[0]["id"], POLLINATIONS_PROVIDER_ID)


if __name__ == "__main__":
    unittest.main()
