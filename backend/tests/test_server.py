from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.server import (
    _CONTROL_RPC_LIMITER,
    _DATA_RPC_LIMITER,
    _QUIET_RPC_METHODS,
    _rpc_limiter_for_method,
    create_app,
)
from fastapi.testclient import TestClient


class _PluginManager:
    @staticmethod
    def start_enabled() -> dict[str, list[object]]:
        return {"plugins": []}

    @staticmethod
    def shutdown() -> None:
        return None


class _API:
    plugin_manager = _PluginManager()

    @staticmethod
    def get_settings() -> dict[str, bool]:
        return {"responsive": True}


class ServerIsolationTests(unittest.TestCase):
    def test_dynamic_scene_reads_are_quiet(self) -> None:
        self.assertIn("get_dynamic_wallpaper_scene", _QUIET_RPC_METHODS)

    def test_slow_data_rpcs_use_an_independent_worker_budget(self) -> None:
        self.assertIs(_rpc_limiter_for_method("query_bing"), _DATA_RPC_LIMITER)
        self.assertIs(_rpc_limiter_for_method("execute_wallpaper_source"), _DATA_RPC_LIMITER)
        self.assertIs(_rpc_limiter_for_method("get_settings"), _CONTROL_RPC_LIMITER)
        self.assertIs(_rpc_limiter_for_method("get_dynamic_wallpaper_status"), _CONTROL_RPC_LIMITER)

    def test_loopback_media_origin_receives_cors_headers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            frontend_dir = Path(directory)
            (frontend_dir / "index.html").write_text("<!doctype html>", encoding="utf-8")
            app = create_app(_API(), "test-token", frontend_dir)
            with TestClient(app) as client:
                response = client.post(
                    "/api/rpc/get_settings",
                    headers={
                        "Host": "localhost",
                        "Origin": "http://127.0.0.1:49152",
                        "X-Api-Token": "test-token",
                    },
                    json={"args": []},
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"result": {"responsive": True}})
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:49152")


if __name__ == "__main__":
    unittest.main()
