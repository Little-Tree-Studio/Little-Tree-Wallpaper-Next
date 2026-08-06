from __future__ import annotations

import socket
import tempfile
import unittest
from ipaddress import ip_address
from pathlib import Path
from unittest.mock import patch

from backend.server import (
    _CONTROL_RPC_LIMITER,
    _DATA_RPC_LIMITER,
    _QUIET_RPC_METHODS,
    _host_is_allowed,
    _rpc_limiter_for_method,
    _validate_public_http_url,
    _validate_referer,
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
    def test_host_allowlist_accepts_only_exact_loopback_authorities(self) -> None:
        allowed = ["127.0.0.1", "127.0.0.1:49152", "localhost", "LOCALHOST:80", "::1", "[::1]", "[::1]:443"]
        rejected = [
            "",
            "example.com",
            "localhost.evil",
            "127.0.0.1.evil",
            "127.0.0.1:invalid",
            "127.0.0.1:65536",
            "[::1].evil",
            "[::1]:invalid",
            " [::1]",
        ]
        for host in allowed:
            with self.subTest(host=host):
                self.assertTrue(_host_is_allowed(host))
        for host in rejected:
            with self.subTest(host=host):
                self.assertFalse(_host_is_allowed(host))

    def test_public_url_validation_rejects_private_or_mixed_dns_results(self) -> None:
        public_result = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with patch("backend.server.socket.getaddrinfo", return_value=public_result):
            self.assertEqual(
                _validate_public_http_url("https://example.com/image.jpg"),
                ("https://example.com/image.jpg", "example.com", 443),
            )

        mixed_result = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (str(ip_address("93.184.216.34")), 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (str(ip_address("127.0.0.1")), 443)),
        ]
        with (
            patch("backend.server.socket.getaddrinfo", return_value=mixed_result),
            self.assertRaisesRegex(ValueError, "non-public"),
        ):
            _validate_public_http_url("https://example.com/image.jpg")

    def test_public_url_and_referer_validation_rejects_credentials_and_invalid_schemes(self) -> None:
        invalid_urls = [
            "file:///tmp/image.png",
            "https://user:secret@example.com/image.png",
            "https://example.com:invalid/image.png",
            "https:///image.png",
        ]
        for value in invalid_urls:
            with self.subTest(value=value), self.assertRaises(ValueError):
                _validate_public_http_url(value)

        self.assertEqual(_validate_referer(" https://example.com/gallery "), "https://example.com/gallery")
        for value in ["file:///tmp", "https://user:secret@example.com", "x" * 2049]:
            with self.subTest(referer=value), self.assertRaises(ValueError):
                _validate_referer(value)

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
