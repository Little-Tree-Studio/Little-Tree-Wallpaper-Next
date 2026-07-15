from __future__ import annotations

import unittest
from typing import Any

from backend.services.timeline import TimelineService, TimelineServiceError
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


class _FakeResponse:
    def __init__(self, payload: Any) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Any:
        return self._payload


class _FakeSession:
    def __init__(self, payloads: list[Any]) -> None:
        self.headers: dict[str, str] = {}
        self._payloads = list(payloads)
        self.calls: list[dict[str, Any]] = []

    def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return _FakeResponse(self._payloads.pop(0))


def _encrypt_filename(value: str, provider: str) -> str:
    import hashlib

    key = (provider * 16)[-16:].encode("utf-8")
    iv = hashlib.md5(key).hexdigest()[8:24].encode("ascii")
    raw = value.encode("utf-8")
    padded = raw + (b"\0" * (16 - len(raw)))
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return (encryptor.update(padded) + encryptor.finalize()).hex()


class TimelineServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        TimelineService._cache.clear()

    def test_decrypt_url_matches_public_frontend_algorithm(self) -> None:
        provider = "wallhaven"
        encrypted = _encrypt_filename("1wlnq9", provider)
        url = f"https://example.com/{encrypted}.jpg?size=full"

        self.assertEqual(
            TimelineService.decrypt_url(url, provider),
            "https://example.com/1wlnq9.jpg?size=full",
        )

    def test_list_topics_normalizes_public_payload(self) -> None:
        session = _FakeSession(
            [
                {
                    "status": 1,
                    "data": [
                        {
                            "id": "风光摄影",
                            "title": "风光摄影",
                            "story": "青山入画",
                            "thumburl": "https://example.com/cover.webp",
                            "width": 3840,
                            "height": 2160,
                        }
                    ],
                }
            ]
        )
        service = TimelineService(session=session, device_id="test-device")

        topics = service.list_topics(force_refresh=True)

        self.assertEqual(topics[0]["id"], "风光摄影")
        self.assertEqual(topics[0]["preview_url"], "https://example.com/cover.webp")
        self.assertEqual(session.headers["Timeline-Device"], "test-device")
        self.assertEqual(session.calls[0]["params"]["stock"], 10)

    def test_query_latest_returns_cursor_and_wallpaper_items(self) -> None:
        session = _FakeSession(
            [
                {
                    "status": 1,
                    "data": [
                        {
                            "id": "abc",
                            "no": 120,
                            "title": "",
                            "story": "远山与海",
                            "imgurl": "https://example.com/full.jpg",
                            "thumburl": "https://example.com/thumb.webp",
                            "topic": ",山海,,风光摄影,",
                            "catehow": "photography",
                            "catewhat": "landscape",
                            "width": 3840,
                            "height": 2160,
                        }
                    ],
                }
            ]
        )
        service = TimelineService(session=session, device_id="test-device")

        page = service.query_wallpapers(mode="latest", seed=1234, force_refresh=True)

        self.assertEqual(page["next_cursor"], 119)
        self.assertTrue(page["has_more"])
        self.assertEqual(page["seed"], 1234)
        self.assertEqual(page["items"][0]["source_id"], "builtin.timeline")
        self.assertEqual(page["items"][0]["title"], "山海 · 风光摄影")
        self.assertEqual(page["items"][0]["metadata"]["topics"], ["山海", "风光摄影"])
        self.assertEqual(page["items"][0]["metadata"]["tags"], ["山海", "风光摄影", "摄影", "风光"])
        self.assertEqual(session.calls[0]["params"]["order"], "date")
        self.assertEqual(session.calls[0]["params"]["no"], 99999999)

    def test_topic_requires_name(self) -> None:
        service = TimelineService(session=_FakeSession([]), device_id="test-device")
        with self.assertRaisesRegex(ValueError, "topic"):
            service.query_wallpapers(mode="topic")

    def test_trending_cache_ignores_unused_seed(self) -> None:
        payload = {
            "status": 1,
            "data": [
                {
                    "id": "trend",
                    "no": 10,
                    "imgurl": "https://example.com/full.jpg",
                }
            ],
        }
        session = _FakeSession([payload])
        service = TimelineService(session=session, device_id="test-device")

        first = service.query_wallpapers(mode="trending", seed=1)
        second = service.query_wallpapers(mode="trending", seed=2)

        self.assertEqual(first, second)
        self.assertEqual(first["seed"], 0)
        self.assertEqual(len(session.calls), 1)

    def test_random_uses_stable_seed_and_random_order(self) -> None:
        payload = {
            "status": 1,
            "data": [{"id": "random", "no": 9, "imgurl": "https://example.com/random.jpg"}],
        }
        session = _FakeSession([payload])
        service = TimelineService(session=session, device_id="test-device")

        page = service.query_wallpapers(mode="random", seed=4321, force_refresh=True)

        self.assertEqual(page["seed"], 4321)
        self.assertEqual(session.calls[0]["params"]["order"], "random")
        self.assertEqual(session.calls[0]["params"]["seed"], 4321)

    def test_topic_parser_uses_double_comma_separator(self) -> None:
        self.assertEqual(
            TimelineService._parse_topics(",海绵宝宝,,打工人,,2026,"),
            ["海绵宝宝", "打工人", "2026"],
        )

    def test_invalid_payload_raises_service_error(self) -> None:
        service = TimelineService(
            session=_FakeSession([{"status": 0, "msg": "设备 ID 缺失"}]),
            device_id="test-device",
        )
        with self.assertRaisesRegex(TimelineServiceError, "设备 ID 缺失"):
            service.list_topics(force_refresh=True)


if __name__ == "__main__":
    unittest.main()
