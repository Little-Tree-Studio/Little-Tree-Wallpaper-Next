from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

import backend.api as api_module
from backend.api import BackendAPI
from backend.plugins import PluginManager
from backend.server import create_app
from fastapi.testclient import TestClient

PNG = b"\x89PNG\r\n\x1a\n" + b"plugin-image"


class _Store:
    def get(self, _key: str, default: object = None) -> object:
        return default

    def as_dict(self) -> dict[str, object]:
        return {}

    @contextmanager
    def transaction(self) -> Iterator[None]:
        yield


def _make_package(directory: Path) -> Path:
    package = directory / "sample.ltp"
    manifest = {
        "schema_version": 1,
        "id": "com.example.integration",
        "name": "Integration",
        "version": "1.0.0",
        "description": "Integration test plugin",
        "author": "Tests",
        "permissions": ["ui.pages"],
        "contributes": {
            "pages": [
                {
                    "id": "home",
                    "label": "Plugin Home",
                    "route": "/plugins/com.example.integration",
                    "blocks": [
                        {"type": "image", "src": "assets/cover.png", "alt": "Cover"},
                    ],
                }
            ]
        },
    }
    module = """
class Plugin:
    def on_start(self, context):
        context.set_setting("starts", context.get_setting("starts", 0) + 1)

    def on_stop(self, context):
        context.set_setting("stops", context.get_setting("stops", 0) + 1)

def setup(context):
    context.register_action("echo", lambda payload: payload)
    return Plugin()
"""
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("plugin.json", json.dumps(manifest))
        archive.writestr("module.py", module)
        archive.writestr("assets/cover.png", PNG)
        archive.writestr("assets/undeclared.png", PNG)
    return package


class PluginIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.manager = PluginManager(
            data_dir=self.root / "data",
            config_dir=self.root / "config",
            cache_dir=self.root / "cache",
        )
        self.package = _make_package(self.root)
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(api_module, "get_settings_store", return_value=_Store()))
        self.stack.enter_context(patch.object(api_module, "get_data_dir", return_value=self.root / "data"))
        self.stack.enter_context(patch.object(api_module, "get_config_dir", return_value=self.root / "config"))
        self.stack.enter_context(patch.object(api_module, "get_cache_dir", return_value=self.root / "cache"))
        self.stack.enter_context(patch.object(api_module, "PluginManager", return_value=self.manager))
        for service_name in (
            "BingService",
            "CNUService",
            "PexelsService",
            "PixivelService",
            "SpotlightService",
            "SniffService",
            "TimelineService",
            "ThemeService",
            "IntelligentMarketService",
            "LTWSService",
            "StorageService",
        ):
            self.stack.enter_context(patch.object(api_module, service_name, MagicMock()))
        self.api = BackendAPI()

    def tearDown(self) -> None:
        self.manager.shutdown()
        self.stack.close()
        self.temporary.cleanup()

    def test_rpc_wrappers_bootstrap_and_source_sanitization(self) -> None:
        self.api._show_file_dialog = MagicMock(return_value=str(self.package))

        installed = self.api.install_plugin_package()
        enabled = self.api.set_plugin_enabled("com.example.integration", True)
        invoked = self.api.invoke_plugin_action("com.example.integration", "echo", {"ok": True})
        listed = self.api.list_plugins()

        self.assertEqual(installed["source"], self.package.name)
        self.assertEqual(enabled["status"], "started")
        self.assertEqual(invoked["result"], {"ok": True})
        self.assertEqual(listed["plugins"][0]["source"], self.package.name)
        self.assertFalse(hasattr(self.api, "echo"))
        self.api.bing_service.query_daily.return_value = []
        self.api.ltws_service.list_sources.return_value = []
        self.api.spotlight_service.list_local_candidates.return_value = []
        self.api.get_sentence = MagicMock(return_value={})
        bootstrap = self.api.bootstrap()
        self.assertIsInstance(bootstrap["plugins"], list)
        self.assertEqual(bootstrap["plugins"][0]["id"], "com.example.integration")
        self.assertEqual(bootstrap["runtime"]["plugins"]["count"], 1)
        self.assertEqual(self.api.reload_plugin("com.example.integration")["status"], "started")
        self.assertEqual(self.api.set_plugin_enabled("com.example.integration", False)["status"], "disabled")
        self.assertEqual(self.api.remove_plugin("com.example.integration")["status"], "removed")

    def test_asset_helper_allows_only_started_declared_images(self) -> None:
        self.api.install_plugin_package(str(self.package))
        self.api.set_plugin_enabled("com.example.integration", True)

        resolved = BackendAPI._resolve_plugin_asset(self.manager, "com.example.integration", "assets/cover.png")
        self.assertIsNotNone(resolved)
        assert resolved is not None
        self.assertEqual(resolved[0], PNG)
        self.assertEqual(resolved[1], "image/png")

        rejected = (
            "assets/undeclared.png",
            "module.py",
            "plugin.json",
            ".install.json",
            "../outside.png",
            "assets/../../outside.png",
            "assets\\cover.png",
            "/assets/cover.png",
            "assets/%2e%2e/outside.png",
            "assets//cover.png",
            "assets/cover.png.",
        )
        for path in rejected:
            with self.subTest(path=path):
                self.assertIsNone(BackendAPI._resolve_plugin_asset(self.manager, "com.example.integration", path))
        self.assertIsNone(BackendAPI._resolve_plugin_asset(self.manager, "com.example.unknown", "assets/cover.png"))

        outside = self.root / "outside.png"
        outside.write_bytes(PNG)
        link = self.manager.plugins_dir / "com.example.integration" / "assets" / "cover.png"
        link.unlink()
        try:
            link.symlink_to(outside)
        except OSError:
            pass
        else:
            self.assertIsNone(
                BackendAPI._resolve_plugin_asset(self.manager, "com.example.integration", "assets/cover.png")
            )

        self.api.set_plugin_enabled("com.example.integration", False)
        self.assertIsNone(BackendAPI._resolve_plugin_asset(self.manager, "com.example.integration", "assets/cover.png"))

    def test_fastapi_lifecycle_and_authenticated_asset_route(self) -> None:
        self.api.install_plugin_package(str(self.package))
        self.api.set_plugin_enabled("com.example.integration", True)
        self.manager.shutdown()
        frontend = self.root / "frontend"
        frontend.mkdir()
        (frontend / "index.html").write_text("<!doctype html>", encoding="utf-8")

        app = create_app(self.api, "secret", frontend)
        with TestClient(app, headers={"host": "127.0.0.1"}) as client:
            settings_path = self.root / "config" / "plugins" / "com.example.integration" / "settings.json"
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(settings, {"starts": 2, "stops": 1})

            unauthorized = client.get("/api/plugin-assets/com.example.integration/assets/cover.png")
            response = client.get("/api/plugin-assets/com.example.integration/assets/cover.png?token=secret")
            encoded = client.get("/api/plugin-assets/com.example.integration/assets/%252e%252e/cover.png?token=secret")
            self.assertEqual(unauthorized.status_code, 401)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, PNG)
            self.assertEqual(response.headers["content-type"], "image/png")
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")
            self.assertEqual(response.headers["cache-control"], "private, max-age=3600")
            self.assertEqual(encoded.status_code, 404)

        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        self.assertEqual(settings, {"starts": 2, "stops": 2})
        self.manager.shutdown()
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        self.assertEqual(settings, {"starts": 2, "stops": 2})


if __name__ == "__main__":
    unittest.main()
