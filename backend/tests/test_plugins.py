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
