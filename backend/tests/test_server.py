from __future__ import annotations

import io
import socket
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from ipaddress import ip_address
from pathlib import Path
from threading import Event, get_ident
from unittest.mock import Mock, patch
from urllib.parse import urlparse

import pytest
import requests
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
from backend.settings_manager import PIXIV_IMAGE_PROXIES
from fastapi.testclient import TestClient
from PIL import Image


class _PluginManager:
    @staticmethod
    def start_enabled() -> dict[str, list[object]]:
        return {"plugins": []}

    @staticmethod
    def shutdown() -> None:
        return None


class _API:
    plugin_manager = _PluginManager()
    store = {}

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

    def test_frontend_log_ingestion_is_quiet(self) -> None:
        self.assertIn("log_frontend", _QUIET_RPC_METHODS)

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


@pytest.fixture
def image_client(tmp_path):
    app = create_app(_API(), "test-token", tmp_path)
    with TestClient(app, base_url="http://localhost", headers={"X-Api-Token": "test-token"}) as client:
        yield client


@pytest.fixture
def image_bytes():
    output = io.BytesIO()
    with Image.new("RGB", (1, 1)) as image:
        image.save(output, format="PNG")
    return output.getvalue()


def image_response(chunks, headers=None, *, redirect=False):
    response = Mock(spec=requests.Response)
    response.headers = {"Content-Type": "image/png", **(headers or {})}
    response.is_redirect = redirect
    response.is_permanent_redirect = False
    response.iter_content.return_value = iter(chunks)
    return response


@pytest.fixture(params=[
    ("/api/cnu-image", "https://imgoss.cnu.cc/image.png"),
    ("/api/pixiv-image", "https://i.pximg.org/image.png"),
    ("/api/sniff-image", "https://example.com/image.png"),
])
def proxy_source(request):
    public_result = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
    with patch("backend.server.socket.getaddrinfo", return_value=public_result):
        yield request.param


def test_image_proxies_stream_and_close_success(image_client, proxy_source, image_bytes):
    endpoint, url = proxy_source
    upstream = image_response([image_bytes])
    with patch("backend.server.requests.get", return_value=upstream) as get:
        response = image_client.get(endpoint, params={"url": url})
    assert response.status_code == 200
    assert response.content == image_bytes
    assert get.call_args.kwargs["stream"] is True
    assert get.call_args.kwargs["allow_redirects"] is False
    upstream.close.assert_called_once()


@pytest.mark.parametrize("declared_length", ["9", "1", None])
def test_image_proxies_bound_declared_and_actual_size(image_client, proxy_source, declared_length):
    endpoint, url = proxy_source
    headers = {} if declared_length is None else {"Content-Length": declared_length}
    upstream = image_response([b"1234", b"56789", b"not consumed"], headers)
    with (
        patch("backend.server.requests.get", return_value=upstream),
        patch("backend.server._IMAGE_PROXY_MAX_BYTES", 8),
    ):
        response = image_client.get(endpoint, params={"url": url})
    assert response.status_code == 502
    if declared_length == "9":
        upstream.iter_content.assert_not_called()
    else:
        assert next(upstream.iter_content.return_value) == b"not consumed"
    upstream.close.assert_called_once()


@pytest.mark.parametrize("failure", ["http", "empty", "read"])
def test_image_proxies_close_on_failure(image_client, proxy_source, failure):
    endpoint, url = proxy_source
    upstream = image_response([])
    if failure == "http":
        upstream.status_code = 404
        upstream.raise_for_status.side_effect = requests.HTTPError(response=upstream)
    elif failure == "read":
        upstream.iter_content.side_effect = requests.ConnectionError("interrupted")
    with patch("backend.server.requests.get", return_value=upstream):
        response = image_client.get(endpoint, params={"url": url})
    assert response.status_code == 502
    upstream.close.assert_called_once()


def test_image_proxies_close_redirects_without_reading_body(image_client, proxy_source, image_bytes):
    endpoint, url = proxy_source
    redirect = image_response([], {"Location": "/final.png"}, redirect=True)
    upstream = image_response([image_bytes])
    with patch("backend.server.requests.get", side_effect=[redirect, upstream]) as get:
        response = image_client.get(endpoint, params={"url": url})
    assert response.status_code == 200
    expected_url = (
        "https://i.yuki.sh/final.png"
        if endpoint == "/api/pixiv-image"
        else url.replace("image.png", "final.png")
    )
    assert get.call_args.args[0] == expected_url
    redirect.iter_content.assert_not_called()
    redirect.close.assert_called_once()
    upstream.close.assert_called_once()


@pytest.mark.parametrize("endpoint,url", [
    ("/api/cnu-image", "https://imgoss.cnu.cc/image.png"),
    ("/api/pixiv-image", "https://i.pximg.org/image.png"),
])
def test_cdn_proxies_reject_redirects_outside_allowlist(image_client, endpoint, url):
    upstream = image_response([], {"Location": "http://127.0.0.1/private"}, redirect=True)
    with patch("backend.server.requests.get", return_value=upstream) as get:
        response = image_client.get(endpoint, params={"url": url})
    assert response.status_code == 502
    get.assert_called_once()
    upstream.close.assert_called_once()


def test_sniff_proxy_routes_pixiv_images_through_the_active_mirror(image_client, image_bytes):
    public_result = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
    upstream = image_response([image_bytes])
    with (
        patch("backend.server.socket.getaddrinfo", return_value=public_result),
        patch("backend.server.requests.get", return_value=upstream) as get,
    ):
        response = image_client.get(
            "/api/sniff-image",
            params={"url": "https://i.pximg.org/img-original/img/a.jpg"},
        )

    assert response.status_code == 200
    assert response.content == image_bytes
    proxy = PIXIV_IMAGE_PROXIES[0]
    assert urlparse(get.call_args.args[0]).netloc == urlparse(proxy["base_url"]).netloc
    assert get.call_args.kwargs["headers"]["Referer"] == proxy["referer"]
    upstream.close.assert_called_once()


def test_sniff_dns_does_not_block_health_requests(image_client, image_bytes):
    started = Event()
    release = Event()
    dns_threads = []
    loop_thread = image_client.portal.call(get_ident)

    def resolve(*args, **kwargs):
        dns_threads.append(get_ident())
        started.set()
        if not release.wait(timeout=10):
            raise OSError("test DNS was not released")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]

    upstream = image_response([image_bytes])
    with (
        patch("backend.server.socket.getaddrinfo", side_effect=resolve),
        patch("backend.server.requests.get", return_value=upstream),
        ThreadPoolExecutor(max_workers=2) as executor,
    ):
        image_request = executor.submit(
            image_client.get, "/api/sniff-image", params={"url": "https://example.com/image.png"}
        )
        try:
            assert started.wait(timeout=5)
            health_request = executor.submit(image_client.get, "/api/health")
            assert health_request.result(timeout=2).status_code == 200
            assert loop_thread not in dns_threads
        finally:
            release.set()
        assert image_request.result(timeout=5).status_code == 200


if __name__ == "__main__":
    unittest.main()
