from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote, urlparse, urlunparse

import requests
from loguru import logger


class _NextDataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._capturing = False
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "script" and attributes.get("id") == "__NEXT_DATA__":
            self._capturing = True

    def handle_data(self, data: str) -> None:
        if self._capturing:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capturing:
            self._capturing = False

    @property
    def data(self) -> str:
        return "".join(self._parts).strip()


class PexelsService:
    """Read Pexels' public search-page data and normalize photo results."""

    _SEARCH_API_URL = "https://www.pexels.com/zh-cn/api/v3/search/photos"
    _SEARCH_PAGE_URL = "https://www.pexels.com/zh-cn/search/{query}/"
    # This is the public browser-client credential shipped in Pexels' web bundle,
    # not a user API key. The SSR-page parser below is retained as a fallback when
    # the site's frontend contract changes.
    _WEB_CLIENT_KEY = "H2jk9uKnhRmL6WPwh89zBezWvr"
    _ORIGINAL_PATH = re.compile(r"^/photos/(?P<id>\d+)/pexels-photo-(?P=id)\.jpeg$")

    def __init__(self, session: requests.Session | None = None) -> None:
        self._session = session or requests.Session()

    def search(
        self,
        query: str,
        page: int = 1,
        per_page: int = 24,
        user_agent: str = "Mozilla/5.0",
    ) -> list[dict[str, Any]]:
        term = str(query or "").strip()
        if not term:
            return []
        page_number = max(1, int(page))
        page_size = max(1, min(int(per_page), 24))

        api_error: Exception | None = None
        try:
            payload = self._request_search_api(term, page_number, page_size, user_agent)
            return self._parse_results(self._photo_data(payload))
        except Exception as exc:
            api_error = exc
            logger.warning("Pexels page-data request failed, trying SSR page: {}", exc)

        try:
            payload = self._request_search_page(term, page_number, user_agent)
            return self._parse_results(self._photo_data(payload))
        except Exception as page_exc:
            logger.warning("Pexels SSR search page failed: {}", page_exc)
            detail = str(api_error or page_exc)
            raise RuntimeError(f"Pexels 搜索暂时不可用: {detail}") from page_exc

    def _request_search_api(
        self,
        query: str,
        page: int,
        per_page: int,
        user_agent: str,
    ) -> dict[str, Any]:
        response = self._session.get(
            self._SEARCH_API_URL,
            params={
                "query": query,
                "page": page,
                "per_page": per_page,
                "seo_tags": "true",
            },
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json, text/plain, */*",
                "Referer": self._SEARCH_PAGE_URL.format(query=quote(query, safe="")),
                "X-Client-Type": "react",
                "secret-key": self._WEB_CLIENT_KEY,
            },
            timeout=30,
        )
        if response.status_code == 429:
            raise RuntimeError("Pexels 请求过于频繁，请稍后重试")
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("Pexels 返回了无效的搜索数据")
        return payload

    def _request_search_page(self, query: str, page: int, user_agent: str) -> dict[str, Any]:
        response = self._session.get(
            self._SEARCH_PAGE_URL.format(query=quote(query, safe="")),
            params={"page": page} if page > 1 else None,
            headers={
                "User-Agent": user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
            },
            timeout=30,
        )
        if response.status_code == 403 and response.headers.get("Cf-Mitigated") == "challenge":
            raise RuntimeError("Pexels 拒绝了本次页面抓取")
        response.raise_for_status()

        parser = _NextDataParser()
        parser.feed(response.text)
        if not parser.data:
            raise RuntimeError("Pexels 搜索页未包含可解析的数据")
        payload = json.loads(parser.data)
        if not isinstance(payload, dict):
            raise RuntimeError("Pexels 搜索页数据格式无效")
        return payload

    @staticmethod
    def _photo_data(payload: dict[str, Any]) -> list[Any]:
        direct = payload.get("data")
        if isinstance(direct, list):
            return direct

        props = payload.get("props")
        page_props = props.get("pageProps") if isinstance(props, dict) else None
        initial_data = page_props.get("initialData") if isinstance(page_props, dict) else None
        photos = initial_data.get("data") if isinstance(initial_data, dict) else None
        if not isinstance(photos, list):
            raise RuntimeError("Pexels 搜索结果结构已发生变化")
        return photos

    @classmethod
    def _parse_results(cls, photos: list[Any]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for raw in photos:
            if not isinstance(raw, dict):
                continue
            attributes = raw.get("attributes")
            if not isinstance(attributes, dict):
                continue

            photo_id = str(attributes.get("id") or raw.get("id") or "").strip()
            image = attributes.get("image")
            if not photo_id.isdigit() or photo_id in seen_ids or not isinstance(image, dict):
                continue

            original_url = cls._canonical_original_url(
                str(image.get("download_link") or image.get("large") or image.get("medium") or ""),
                photo_id,
            )
            preview_url = cls._validated_image_url(
                str(image.get("medium") or image.get("large") or image.get("small") or "")
            )
            if not original_url:
                continue
            if not preview_url:
                preview_url = original_url

            user = attributes.get("user") if isinstance(attributes.get("user"), dict) else {}
            author = str(user.get("name") or "").strip()
            if not author:
                author = " ".join(
                    part
                    for part in (
                        str(user.get("first_name") or "").strip(),
                        str(user.get("last_name") or "").strip(),
                    )
                    if part
                )
            title = str(
                attributes.get("title")
                or attributes.get("alt")
                or attributes.get("description")
                or f"Pexels {photo_id}"
            ).strip()
            tags = [
                str(tag.get("name") or tag.get("search_term") or "").strip()
                for tag in attributes.get("tags", [])
                if isinstance(tag, dict) and (tag.get("name") or tag.get("search_term"))
            ]

            seen_ids.add(photo_id)
            results.append(
                {
                    "id": f"pexels:{photo_id}",
                    "url": original_url,
                    "preview_url": preview_url,
                    "source_url": original_url,
                    "source_page_url": f"https://www.pexels.com/zh-cn/photo/{photo_id}/",
                    "referer": "https://www.pexels.com/",
                    "filename": f"pexels-{photo_id}.jpg",
                    "content_type": "image/jpeg",
                    "title": title,
                    "author": author,
                    "author_id": str(user.get("id") or ""),
                    "width": cls._positive_int(attributes.get("width")),
                    "height": cls._positive_int(attributes.get("height")),
                    "tags": tags,
                }
            )
        return results

    @classmethod
    def _canonical_original_url(cls, value: str, photo_id: str) -> str:
        image_url = cls._validated_image_url(value)
        if not image_url:
            return ""
        parsed = urlparse(image_url)
        match = cls._ORIGINAL_PATH.fullmatch(parsed.path)
        if not match or match.group("id") != photo_id:
            return ""
        # Pexels' w/h/dpr/fm/fit parameters transform the asset. Removing the
        # complete query string returns the source-resolution JPEG.
        return urlunparse(parsed._replace(query="", fragment=""))

    @staticmethod
    def _validated_image_url(value: str) -> str:
        parsed = urlparse(value.strip())
        if parsed.scheme != "https" or (parsed.hostname or "").lower() != "images.pexels.com":
            return ""
        return parsed.geturl()

    @staticmethod
    def _positive_int(value: Any) -> int | None:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None
