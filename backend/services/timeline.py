from __future__ import annotations

import hashlib
import re
import time
import uuid
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from loguru import logger

from backend.models import WallpaperItem
from backend.services.cache import ResponseCache


class TimelineServiceError(RuntimeError):
    """Raised when the Timeline gallery API returns an unexpected response."""


class TimelineService:
    """Fetch public topics and wallpapers from the Timeline gallery."""

    api_base_url = "https://api.nguaduot.cn"
    gallery_base_url = "https://gallery.timeline.ink"
    _cache = ResponseCache("timeline", default_ttl=1800.0)
    _modes = frozenset({"latest", "trending", "random", "topic"})
    _category_labels = {
        "photography": "摄影",
        "landscape": "风光",
        "girl": "美女",
        "character": "人物",
        "living": "生灵",
    }

    def __init__(
        self,
        session: requests.Session | None = None,
        timeout_seconds: int = 20,
        device_id: str | None = None,
    ) -> None:
        self._session = session or requests.Session()
        self._timeout_seconds = max(1, timeout_seconds)
        # The public API requires a non-empty device id. Use a random per-process
        # identifier instead of fingerprinting the user's machine.
        self._device_id = device_id or uuid.uuid4().hex
        self._session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
                "Referer": f"{self.gallery_base_url}/",
                "Origin": self.gallery_base_url,
                "Timeline-Client": "timelineweb",
                "Timeline-Device": self._device_id,
                "Timeline-User": "",
                "Timeline-Pwd": "",
            }
        )

    def list_topics(self, force_refresh: bool = False) -> list[dict[str, Any]]:
        cache_key = "topics:v1"
        if not force_refresh:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        try:
            payload = self._request_json(
                "/snake/v4/topic",
                params={"stock": 10, "mobile": 0, "keyword": ""},
            )
            topics = [
                topic
                for item in self._payload_items(payload)
                if (topic := self._normalize_topic(item)) is not None
            ]
        except Exception:
            stale = self._cache.get_stale(cache_key, max_age=7 * 24 * 3600)
            if stale is not None:
                logger.info("Timeline topics fallback to stale cache")
                return stale
            raise

        self._cache.set(cache_key, topics)
        return topics

    def query_wallpapers(
        self,
        mode: str = "latest",
        cursor: int | None = None,
        topic: str = "",
        seed: int | None = None,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        normalized_mode = str(mode).strip().lower()
        normalized_topic = str(topic).strip()
        if normalized_mode not in self._modes:
            raise ValueError("mode 必须是 latest、trending、random 或 topic")
        if normalized_mode == "topic" and not normalized_topic:
            raise ValueError("专题模式必须指定 topic")

        normalized_cursor = 99999999 if cursor is None else int(cursor)
        if normalized_cursor < 1:
            raise ValueError("cursor 必须大于等于 1")
        normalized_seed = (
            0
            if normalized_mode == "trending"
            else int(seed) if seed is not None else int(time.time() * 1000)
        )

        params: dict[str, Any] = {
            "no": normalized_cursor,
            "id": "",
        }
        if normalized_mode == "topic":
            params.update(
                {
                    "topic": normalized_topic,
                    "date": "30000101",
                    "order": "random",
                    "seed": normalized_seed,
                }
            )
        else:
            params.update(
                {
                    "order": {
                        "latest": "date",
                        "trending": "score",
                        "random": "random",
                    }[normalized_mode],
                    "catehow": "",
                    "catewhat": "",
                }
            )
            if normalized_mode in {"latest", "random"}:
                params["seed"] = normalized_seed

        cache_key = (
            f"wallpapers:v2:{normalized_mode}:{normalized_topic}:"
            f"{normalized_cursor}:{normalized_seed}"
        )
        if not force_refresh:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        try:
            payload = self._request_json("/snake/v4", params=params)
            raw_items = self._payload_items(payload)
            items = [
                wallpaper
                for item in raw_items
                if (wallpaper := self._normalize_wallpaper(item)) is not None
            ]
        except Exception:
            stale = self._cache.get_stale(cache_key, max_age=24 * 3600)
            if stale is not None:
                logger.info("Timeline gallery fallback to stale cache for {}", cache_key)
                return stale
            raise

        numbers = [number for item in raw_items if (number := self._positive_int(item.get("no"))) is not None]
        next_cursor = min(numbers) - 1 if numbers and min(numbers) > 1 else None
        result = {
            "items": items,
            "next_cursor": next_cursor,
            "has_more": bool(items and next_cursor),
            "seed": normalized_seed,
        }
        self._cache.set(cache_key, result)
        return result

    def _request_json(self, path: str, *, params: dict[str, Any]) -> dict[str, Any]:
        response = self._session.get(
            f"{self.api_base_url}{path}",
            params=params,
            timeout=self._timeout_seconds,
        )
        response.raise_for_status()
        response.encoding = "utf-8"
        try:
            payload = response.json()
        except ValueError as exc:
            raise TimelineServiceError("拾光壁纸接口返回了无效 JSON") from exc
        if not isinstance(payload, dict) or payload.get("status") != 1:
            message = str(payload.get("msg") or "拾光壁纸接口请求失败") if isinstance(payload, dict) else "拾光壁纸接口结构已变化"
            raise TimelineServiceError(message)
        return payload

    @staticmethod
    def _payload_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
        data = payload.get("data")
        if not isinstance(data, list):
            raise TimelineServiceError("拾光壁纸接口数据结构已变化")
        return [item for item in data if isinstance(item, dict)]

    @classmethod
    def _normalize_topic(cls, item: dict[str, Any]) -> dict[str, Any] | None:
        topic_id = str(item.get("id") or item.get("title") or "").strip()
        if not topic_id:
            return None
        preview_url = cls.decrypt_url(
            str(item.get("thumburl") or item.get("imgurl") or "").strip(),
            str(item.get("rawprovider") or "").strip(),
        )
        if not preview_url:
            return None
        return {
            "id": topic_id,
            "title": str(item.get("title") or topic_id).strip(),
            "description": str(item.get("story") or "").strip(),
            "preview_url": preview_url,
            "width": cls._positive_int(item.get("width")),
            "height": cls._positive_int(item.get("height")),
            "category_type": str(item.get("catehow") or "").strip(),
            "category_subject": str(item.get("catewhat") or "").strip(),
            "detail_url": f"{cls.gallery_base_url}/?t={quote(topic_id)}",
        }

    @classmethod
    def _normalize_wallpaper(cls, item: dict[str, Any]) -> dict[str, Any] | None:
        raw_id = str(item.get("id") or "").strip()
        if not raw_id:
            return None
        provider = str(item.get("rawprovider") or "").strip()
        image_url = cls.decrypt_url(str(item.get("imgurl") or "").strip(), provider)
        preview_url = cls.decrypt_url(str(item.get("thumburl") or "").strip(), provider)
        if not image_url:
            return None

        story = str(item.get("story") or "").strip()
        copyright_text = str(item.get("copyright") or item.get("copyrightrich") or "").strip()
        description = story or copyright_text
        topics = cls._parse_topics(item.get("topic"))
        category_labels = cls._category_tags(item.get("catehow"), item.get("catewhat"))
        title = cls._normalize_title(item.get("title"), topics, category_labels)
        source_page_url = str(item.get("srcurl") or "").strip()
        gallery_url = f"{cls.gallery_base_url}/?t={quote(topics[0])}" if topics else cls.gallery_base_url
        tags = list(dict.fromkeys([*topics, *category_labels]))

        return WallpaperItem(
            id=f"timeline:{raw_id}",
            source_id="builtin.timeline",
            source_name="拾光壁纸",
            title=title,
            image_url=image_url,
            preview_url=preview_url or image_url,
            width=cls._positive_int(item.get("width")),
            height=cls._positive_int(item.get("height")),
            description=description,
            metadata={
                "raw_id": raw_id,
                "no": cls._positive_int(item.get("no")),
                "topics": topics,
                "released_at": str(item.get("reldate") or "").strip(),
                "copyright": copyright_text,
                "provider": provider,
                "provider_id": str(item.get("rawid") or "").strip(),
                "source_page_url": source_page_url,
                "gallery_url": gallery_url,
                "score": item.get("score"),
                "rank": item.get("rank"),
                "tone": item.get("tone"),
                "tags": tags,
            },
        ).to_dict()

    @staticmethod
    def decrypt_url(url: str, provider: str) -> str:
        """Decode the encrypted filename block used by Timeline's public UI."""
        if not url or not provider:
            return url
        parsed = urlsplit(url)
        path_parts = parsed.path.rsplit("/", 1)
        filename = path_parts[-1]
        stem_parts = filename.split(".", 1)
        stem = stem_parts[0]
        if len(stem) < 32 or not re.fullmatch(r"[0-9a-fA-F]{32}", stem[:32]):
            return url

        key_text = (provider * 16)[-16:]
        key = key_text.encode("utf-8")
        if len(key) not in {16, 24, 32}:
            return url
        iv = hashlib.md5(key).hexdigest()[8:24].encode("ascii")
        try:
            decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
            plaintext = (decryptor.update(bytes.fromhex(stem[:32])) + decryptor.finalize()).rstrip(b"\0")
            decoded = plaintext.decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return url
        if not decoded:
            return url

        decoded_stem = f"{decoded}{stem[32:]}"
        decoded_filename = decoded_stem if len(stem_parts) == 1 else f"{decoded_stem}.{stem_parts[1]}"
        decoded_path = decoded_filename if len(path_parts) == 1 else f"{path_parts[0]}/{decoded_filename}"
        return urlunsplit((parsed.scheme, parsed.netloc, decoded_path, parsed.query, parsed.fragment))

    @staticmethod
    def _positive_int(value: Any) -> int | None:
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return number if number > 0 else None

    @staticmethod
    def _parse_topics(value: Any) -> list[str]:
        raw = str(value or "").strip().strip(",")
        if not raw:
            return []
        return list(dict.fromkeys(part.strip() for part in raw.split(",,") if part.strip()))

    @classmethod
    def _category_tags(cls, category_type: Any, category_subject: Any) -> list[str]:
        values = [str(category_type or "").strip(), str(category_subject or "").strip()]
        return list(
            dict.fromkeys(cls._category_labels[value] for value in values if value in cls._category_labels)
        )

    @staticmethod
    def _normalize_title(value: Any, topics: list[str], category_labels: list[str]) -> str:
        title = str(value or "").strip()
        return title or " · ".join(topics or category_labels) or "拾光壁纸"
