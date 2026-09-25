from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.plugins import PluginManager

PNG = b"\x89PNG\r\n\x1a\n" + b"test-image"


def manifest(**updates: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schema_version": 1,
        "id": "com.example.sample",
        "name": "Sample",
        "version": "1.0.0",
        "description": "Test plugin",
        "author": "Tests",
        "permissions": [],
        "contributes": {},
    }
    value.update(updates)
    return value


def make_package(
    directory: Path,
    plugin_manifest: dict[str, object] | None = None,
    module: str = "def setup(context):\n    return None\n",
    *,
    entries: dict[str, bytes | str] | None = None,
    name: str = "sample.ltp",
) -> Path:
    path = directory / name
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("plugin.json", json.dumps(plugin_manifest or manifest()))
        archive.writestr("module.py", module)
        for entry_name, content in (entries or {}).items():
            archive.writestr(entry_name, content)
    return path


class PluginManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.data_dir = self.root / "data"
        self.config_dir = self.root / "config"
        self.cache_dir = self.root / "cache"
        self.packages_dir = self.root / "packages"
        self.packages_dir.mkdir()
        self.manager = self.new_manager()

    def tearDown(self) -> None:
        self.manager.shutdown()
        self.temporary.cleanup()

    def new_manager(self) -> PluginManager:
        return PluginManager(data_dir=self.data_dir, config_dir=self.config_dir, cache_dir=self.cache_dir)

    def install(self, **kwargs: object) -> dict[str, object]:
        package = make_package(self.packages_dir, **kwargs)
        return self.manager.install_package(package)

    def test_install_package_extracts_files_and_reports_hash(self) -> None:
        result = self.install(entries={"assets/icon.png": PNG})

        self.assertEqual(result["status"], "installed")
        self.assertEqual(result["state"], "disabled")
        self.assertEqual(len(str(result["package_hash"])), 64)
        install_dir = self.data_dir / "plugins" / "com.example.sample"
        self.assertTrue((install_dir / "plugin.json").is_file())
        self.assertEqual((install_dir / "assets" / "icon.png").read_bytes(), PNG)
        listed = self.manager.list_plugins()["plugins"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["manifest"]["entrypoint"], "module.py:setup")

    def test_install_rejects_traversal_absolute_duplicate_and_executable_entries(self) -> None:
        bad_entries = [
            {"../outside.py": "pass"},
            {"C:/outside.py": "pass"},
            {"MODULE.py": "pass"},
            {"native.dll": b"MZ"},
            {"folder./alias.py": "pass"},
            {"folder/code.py:stream": "pass"},
            {"CON.py": "pass"},
        ]
        for index, entries in enumerate(bad_entries):
            with self.subTest(entries=entries):
                package = make_package(self.packages_dir, entries=entries, name=f"bad-{index}.ltp")
                result = self.manager.install_package(package)
                self.assertEqual(result["status"], "error")
        self.assertFalse((self.root / "outside.py").exists())

    def test_install_rejects_invalid_manifest_and_missing_entrypoint(self) -> None:
        cases = [
            manifest(schema_version=2),
            manifest(id="Bad ID"),
            manifest(version="latest"),
            manifest(entrypoint="../module.py:setup"),
            manifest(entrypoint="missing.py:setup"),
            manifest(permissions=["host.everything"]),
        ]
        for index, value in enumerate(cases):
            with self.subTest(value=value):
                package = make_package(self.packages_dir, value, name=f"invalid-{index}.ltp")
                result = self.manager.install_package(package)
                self.assertEqual(result["status"], "error")

    def test_enable_loads_action_settings_paths_and_contributions(self) -> None:
        plugin_manifest = manifest(
            permissions=["ui.pages", "ui.navigation", "ui.buttons"],
            contributes={
                "pages": [
                    {
                        "id": "home",
                        "label": "Plugin Home",
                        "route": "/plugins/com.example.sample",
                        "blocks": [
                            {"type": "heading", "text": "Hello", "level": 2},
                            {"type": "button", "label": "Count", "action": "count", "payload": {"step": 1}},
                        ],
                    }
                ],
                "navigation": [{"id": "nav", "label": "Sample", "page": "home"}],
                "buttons": [{"id": "toolbar", "label": "Count", "action": "count"}],
            },
        )
        module = """
def setup(context):
    assert not hasattr(context, "store")
    assert not hasattr(context, "token")
    assert not hasattr(context, "backend_api")
    context.set_setting("counter.value", 3)
    def count(payload):
        current = context.get_setting("counter.value", 0)
        current += payload.get("step", 1)
        context.set_setting("counter.value", current)
        return {"count": current, "plugin": context.plugin_id}
    context.register_action("count", count)
"""
        self.install(plugin_manifest=plugin_manifest, module=module)

        enabled = self.manager.set_enabled("com.example.sample", True)
        invoked = self.manager.invoke("com.example.sample", "count", {"step": 2})

        self.assertEqual(enabled["status"], "started")
        self.assertEqual(invoked["status"], "ok")
        self.assertEqual(invoked["result"], {"count": 5, "plugin": "com.example.sample"})
        self.assertEqual(enabled["contributions"]["pages"][0]["route"], "/plugins/com.example.sample")
        settings_path = self.config_dir / "plugins" / "com.example.sample" / "settings.json"
        self.assertEqual(json.loads(settings_path.read_text())["counter"]["value"], 5)
        self.assertTrue((self.data_dir / "plugin_data" / "com.example.sample").is_dir())
        self.assertTrue((self.cache_dir / "plugins" / "com.example.sample").is_dir())

    def test_event_subscription_delivers_json_payload(self) -> None:
        module = """
def setup(context):
    def handle(payload):
        context.set_setting('last.event', payload)
    context.subscribe_event('wallpaper-changed', handle)
"""
        self.install(module=module)
        self.assertEqual(self.manager.set_enabled("com.example.sample", True)["status"], "started")

        result = self.manager.publish_event("wallpaper-changed", {"path": "C:/wallpaper.jpg"})

        self.assertEqual(result["delivered"], 1)
        self.assertEqual(
            json.loads((self.config_dir / "plugins" / "com.example.sample" / "settings.json").read_text()),
            {"last": {"event": {"path": "C:/wallpaper.jpg"}}},
        )

    def test_event_callback_timeout_isolated(self) -> None:
        module = """
import time
def setup(context):
    context.subscribe_event('slow-event', lambda payload: time.sleep(10))
"""
        self.install(module=module, name="slow.ltp")
        self.manager.set_enabled("com.example.sample", True)

        result = self.manager.publish_event("slow-event", {})

        self.assertEqual(result["delivered"], 0)
        self.assertIn("timed out", result["errors"][0])

    def test_plugin_entrypoint_supports_relative_module_imports(self) -> None:
        module = """
from .helper import message

def setup(context):
    context.register_action("message", lambda payload: message())
"""
        self.install(module=module, entries={"helper.py": "def message():\n    return 'from helper'\n"})

        enabled = self.manager.set_enabled("com.example.sample", True)
        invoked = self.manager.invoke("com.example.sample", "message")

        self.assertEqual(enabled["status"], "started")
        self.assertEqual(invoked["result"], "from helper")

    def test_start_and_stop_hooks_are_idempotent(self) -> None:
        module = """
class Plugin:
    def on_start(self, context):
        context.set_setting("starts", context.get_setting("starts", 0) + 1)
    def on_stop(self, context):
        context.set_setting("stops", context.get_setting("stops", 0) + 1)

def setup(context):
    return Plugin()
"""
        self.install(module=module)

        self.manager.set_enabled("com.example.sample", True)
        self.manager.set_enabled("com.example.sample", True)
        self.manager.set_enabled("com.example.sample", False)
        self.manager.set_enabled("com.example.sample", False)

        settings = json.loads((self.config_dir / "plugins" / "com.example.sample" / "settings.json").read_text())
        self.assertEqual(settings, {"starts": 1, "stops": 1})

    def test_enabled_state_persists_and_start_enabled_isolates_broken_plugin(self) -> None:
        self.install(module="def setup(context):\n    context.register_action('ping', lambda payload: 'pong')\n")
        self.manager.set_enabled("com.example.sample", True)
        self.manager.shutdown()

        broken_manifest = manifest(id="com.example.broken", name="Broken")
        broken_package = make_package(
            self.packages_dir,
            broken_manifest,
            "def setup(context):\n    raise RuntimeError('broken setup')\n",
            name="broken.ltp",
        )
        self.manager = self.new_manager()
        self.manager.install_package(broken_package)
        self.manager.set_enabled("com.example.broken", True)
        self.manager.shutdown()

        self.manager = self.new_manager()
        result = self.manager.start_enabled()
        by_id = {item["id"]: item for item in result["plugins"]}

        self.assertEqual(by_id["com.example.sample"]["status"], "started")
        self.assertEqual(by_id["com.example.broken"]["status"], "error")
        self.assertTrue(by_id["com.example.broken"]["enabled"])
        self.assertEqual(self.manager.invoke("com.example.sample", "ping")["result"], "pong")
        state = json.loads((self.config_dir / "plugins" / "state.json").read_text())
        self.assertEqual(state["enabled"], ["com.example.broken", "com.example.sample"])

        disabled = self.manager.set_enabled("com.example.broken", False)
        self.assertFalse(disabled["enabled"])
        self.assertEqual(disabled["state"], "disabled")

    def test_contribution_permissions_and_references_are_enforced(self) -> None:
        cases = [
            manifest(contributes={"pages": [{"id": "page", "label": "Page", "route": "/page"}]}),
            manifest(contributes={"styles": [{"id": "style", "scope": "global", "css": "body{}"}]}),
            manifest(
                permissions=["ui.theme"],
                contributes={"theme": [{"id": "theme", "label": "Theme", "variables": {"color": "red"}}]},
            ),
            manifest(
                permissions=["ui.navigation"],
                contributes={"navigation": [{"id": "nav", "label": "Missing", "page": "no-page"}]},
            ),
        ]
        for index, value in enumerate(cases):
            with self.subTest(value=value):
                package = make_package(self.packages_dir, value, name=f"permissions-{index}.ltp")
                self.assertEqual(self.manager.install_package(package)["status"], "error")

    def test_runtime_contributions_and_action_results_are_validated(self) -> None:
        plugin_manifest = manifest(permissions=["ui.overlay"])
        module = """
def setup(context):
    context.register_action("bad", lambda payload: {"value": object()})
    context.contribute("overlays", {
        "id": "notice",
        "label": "Notice",
        "blocks": [{"type": "text", "text": "Runtime contribution"}],
    })
"""
        self.install(plugin_manifest=plugin_manifest, module=module)
        enabled = self.manager.set_enabled("com.example.sample", True)

        self.assertEqual(enabled["contributions"]["overlays"][0]["id"], "notice")
        self.assertEqual(self.manager.invoke("com.example.sample", "bad")["status"], "error")
        self.assertEqual(self.manager.invoke("com.example.sample", "bad", object())["status"], "error")

    def test_widget_contributions_require_permission_and_normalize_size(self) -> None:
        descriptor = {
            "id": "weather",
            "label": "Weather",
            "description": "Current conditions",
            "default_size": {"width": 32, "height": 20},
            "blocks": [{"type": "text", "text": "Sunny"}],
        }
        rejected = self.install(
            plugin_manifest=manifest(contributes={"widgets": [descriptor]}),
            name="widget-rejected.ltp",
        )
        self.assertEqual(rejected["status"], "error")

        accepted_package = make_package(
            self.packages_dir,
            manifest(
                id="com.example.widgets",
                permissions=["ui.widgets"],
                contributes={"widgets": [descriptor]},
            ),
            name="widget-accepted.ltp",
        )
        accepted = self.manager.install_package(accepted_package)
        self.assertEqual(accepted["manifest"]["contributes"]["widgets"][0]["default_size"], {"width": 32, "height": 20})

    def test_widget_contributions_reject_interactive_buttons(self) -> None:
        package = make_package(
            self.packages_dir,
            manifest(
                id="com.example.interactive-widget",
                permissions=["ui.widgets"],
                contributes={
                    "widgets": [{
                        "id": "interactive",
                        "label": "Interactive",
                        "default_size": {"width": 24, "height": 20},
                        "blocks": [{"type": "button", "label": "Run", "action": "run"}],
                    }],
                },
            ),
            name="interactive-widget.ltp",
        )

        self.assertEqual(self.manager.install_package(package)["status"], "error")

    def test_widget_settings_and_refresh_are_normalized(self) -> None:
        descriptor = {
            "id": "dashboard",
            "label": "Dashboard",
            "default_size": {"width": 34, "height": 26},
            "settings": [
                {"key": "city", "label": "城市", "type": "select", "default": "beijing", "options": [
                    {"value": "beijing", "label": "北京"},
                    {"value": "shanghai", "label": "上海"},
                ]},
                {"key": "threshold", "label": "阈值", "type": "slider", "min": 0, "max": 100, "step": 5, "default": 40},
                {"key": "showDetails", "label": "显示详情", "type": "switch", "default": True},
            ],
            "refresh": {"action": "refresh-data", "interval_seconds": 900, "payload": {"units": "metric"}},
            "blocks": [
                {"type": "metric", "label": "温度", "value": "{{temperature}}°", "unit": "C", "size": "lg"},
                {"type": "progress", "label": "进度", "value": "{{progress}}"},
                {"type": "time", "label": "更新", "format": "datetime"},
                {"type": "badge", "text": "{{city}}", "tone": "info"},
                {"type": "rows", "items": [{"label": "天气", "value": "{{condition}}", "emphasis": True}]},
                {"type": "columns", "blocks": [{"type": "text", "text": "左"}, {"type": "text", "text": "右"}]},
            ],
        }
        package = make_package(
            self.packages_dir,
            manifest(
                id="com.example.dashboard-widget",
                permissions=["ui.widgets"],
                contributes={"widgets": [descriptor]},
            ),
            name="dashboard-widget.ltp",
        )

        result = self.manager.install_package(package)

        self.assertEqual(result["status"], "installed")
        widget = result["manifest"]["contributes"]["widgets"][0]
        self.assertEqual(widget["settings"][0]["options"][0]["value"], "beijing")
        self.assertEqual(widget["refresh"]["interval_seconds"], 900)
        self.assertEqual(len(widget["blocks"]), 6)

    def test_widget_settings_reject_invalid_descriptors(self) -> None:
        cases = [
            [{"key": "bad key!", "label": "x", "type": "text"}],
            [{"key": "a", "label": "x", "type": "unknown"}],
            [{"key": "a", "label": "", "type": "text"}],
            [{"key": "a", "label": "x", "type": "select"}],
            [{"key": "a", "label": "x", "type": "select", "options": [{"value": "b", "label": "B"}], "default": "missing"}],
            [{"key": "a", "label": "x", "type": "slider", "min": 10, "max": 1}],
            [{"key": "a", "label": "x", "type": "color", "default": "red"}],
        ]
        for index, settings in enumerate(cases):
            with self.subTest(settings=settings):
                package = make_package(
                    self.packages_dir,
                    manifest(
                        id="com.example.bad-widget-settings",
                        permissions=["ui.widgets"],
                        contributes={"widgets": [{"id": "w", "label": "W", "settings": settings}]},
                    ),
                    name=f"bad-widget-settings-{index}.ltp",
                )
                self.assertEqual(self.manager.install_package(package)["status"], "error")

    def test_widget_refresh_bounds_and_action_reference(self) -> None:
        module = """
def setup(context):
    context.register_action("refresh-data", lambda payload: {"data": {"temperature": 24}})
"""
        for index, refresh in enumerate([
            {"action": "refresh-data", "interval_seconds": 5},
            {"action": "refresh-data", "interval_seconds": 100000},
        ]):
            with self.subTest(refresh=refresh):
                package = make_package(
                    self.packages_dir,
                    manifest(
                        id="com.example.refresh-widget",
                        permissions=["ui.widgets"],
                        contributes={"widgets": [{"id": "w", "label": "W", "refresh": refresh}]},
                    ),
                    module=module,
                    name=f"refresh-widget-{index}.ltp",
                )
                self.assertEqual(self.manager.install_package(package)["status"], "error")

        missing = self.install(
            plugin_manifest=manifest(
                id="com.example.refresh-widget-missing",
                permissions=["ui.widgets"],
                contributes={"widgets": [{"id": "w", "label": "W", "refresh": {"action": "missing-action", "interval_seconds": 60}}]},
            ),
            module=module,
            name="refresh-widget-missing.ltp",
        )
        self.assertEqual(missing["status"], "installed")
        self.assertEqual(self.manager.set_enabled("com.example.refresh-widget-missing", True)["status"], "error")

        accepted_package = make_package(
            self.packages_dir,
            manifest(
                id="com.example.refresh-widget-ok",
                permissions=["ui.widgets"],
                contributes={"widgets": [{"id": "w", "label": "W", "refresh": {"action": "refresh-data", "interval_seconds": 120}}]},
            ),
            module=module,
            name="refresh-widget-ok.ltp",
        )
        accepted = self.manager.install_package(accepted_package)
        self.assertEqual(accepted["status"], "installed")
        self.assertEqual(self.manager.set_enabled("com.example.refresh-widget-ok", True)["status"], "started")

    def test_widget_blocks_reject_invalid_new_block_shapes(self) -> None:
        cases = [
            [{"type": "metric", "value": ""}],
            [{"type": "progress", "value": 250}],
            [{"type": "badge", "text": ""}],
            [{"type": "rows", "items": [{"label": "a"}]}],
            [{"type": "columns", "blocks": [{"type": "text", "text": "x"} for _ in range(7)]}],
        ]
        for index, blocks in enumerate(cases):
            with self.subTest(blocks=blocks):
                package = make_package(
                    self.packages_dir,
                    manifest(
                        id="com.example.bad-widget-blocks",
                        permissions=["ui.widgets"],
                        contributes={"widgets": [{"id": "w", "label": "W", "blocks": blocks}]},
                    ),
                    name=f"bad-widget-blocks-{index}.ltp",
                )
                self.assertEqual(self.manager.install_package(package)["status"], "error")

    def test_upgrade_rules_and_removal(self) -> None:
        self.install()
        lower = make_package(
            self.packages_dir,
            manifest(version="0.9.0"),
            name="lower.ltp",
        )
        self.assertEqual(self.manager.install_package(lower)["status"], "error")
        self.assertEqual(self.manager.install_package(lower, allow_downgrade=True)["manifest"]["version"], "0.9.0")

        self.manager.set_enabled("com.example.sample", True)
        self.assertEqual(self.manager.install_package(lower)["status"], "error")
        self.assertEqual(self.manager.remove("com.example.sample")["status"], "error")
        self.manager.set_enabled("com.example.sample", False)
        removed = self.manager.remove("com.example.sample")

        self.assertEqual(removed["status"], "removed")
        self.assertFalse((self.data_dir / "plugins" / "com.example.sample").exists())
        self.assertEqual(self.manager.list_plugins()["plugins"], [])


if __name__ == "__main__":
    unittest.main()
