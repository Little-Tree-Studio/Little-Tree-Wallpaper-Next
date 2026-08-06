from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta
from datetime import time as datetime_time
from pathlib import Path
from unittest.mock import patch

from backend.services.cache import ResponseCache


class ResponseCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.cache_root = Path(self.temporary.name)
        self.cache_dir_patch = patch("backend.services.cache.get_cache_dir", return_value=self.cache_root)
        self.cache_dir_patch.start()
        with ResponseCache._memory_lock:
            ResponseCache._memory.clear()

    def tearDown(self) -> None:
        with ResponseCache._memory_lock:
            ResponseCache._memory.clear()
        self.cache_dir_patch.stop()
        self.temporary.cleanup()

    def test_set_survives_memory_reset_and_new_instance(self) -> None:
        cache = ResponseCache("wallpapers")
        cache.set("daily", {"id": 7})
        with ResponseCache._memory_lock:
            ResponseCache._memory.clear()

        restored = ResponseCache("wallpapers")

        self.assertEqual(restored.get("daily"), {"id": 7})

    def test_expired_entry_is_available_only_as_stale_fallback(self) -> None:
        cache = ResponseCache("wallpapers")
        with patch("backend.services.cache.time.time", return_value=100.0):
            cache.set("daily", [1, 2, 3])

        with patch("backend.services.cache.time.time", return_value=111.0):
            self.assertIsNone(cache.get("daily", ttl=10.0))
            self.assertEqual(cache.get_stale("daily"), [1, 2, 3])

    def test_same_day_lookup_rejects_previous_calendar_day(self) -> None:
        cache = ResponseCache("wallpapers")
        yesterday = datetime.combine(datetime.now().date() - timedelta(days=1), datetime_time(hour=12)).timestamp()
        cache._path("daily").write_text(
            json.dumps({"cached_at": yesterday, "data": {"old": True}}),
            encoding="utf-8",
        )

        self.assertIsNone(cache.get_same_day("daily", ttl=-1))
        self.assertEqual(cache.get_stale("daily"), {"old": True})

    def test_malformed_payloads_are_cache_misses(self) -> None:
        cache = ResponseCache("wallpapers")
        invalid_payloads = ["not json", "[]", '{"cached_at":"invalid","data":1}', '{"cached_at":NaN,"data":1}']

        for index, payload in enumerate(invalid_payloads):
            with self.subTest(payload=payload):
                key = f"invalid-{index}"
                cache._path(key).write_text(payload, encoding="utf-8")
                self.assertIsNone(cache.get(key))
                self.assertIsNone(cache.get_same_day(key))

    def test_distinct_unsafe_keys_do_not_share_a_disk_entry(self) -> None:
        cache = ResponseCache("wallpapers")
        cache.set("topic/a", {"topic": "slash"})
        cache.set("topic?a", {"topic": "question"})
        with ResponseCache._memory_lock:
            ResponseCache._memory.clear()

        restored = ResponseCache("wallpapers")

        self.assertEqual(restored.get("topic/a"), {"topic": "slash"})
        self.assertEqual(restored.get("topic?a"), {"topic": "question"})

    def test_clear_is_scoped_to_one_namespace(self) -> None:
        first = ResponseCache("first")
        second = ResponseCache("second")
        first.set("key", 1)
        second.set("key", 2)

        first.clear()

        self.assertIsNone(first.get("key", ttl=-1))
        self.assertEqual(second.get("key", ttl=-1), 2)


if __name__ == "__main__":
    unittest.main()
