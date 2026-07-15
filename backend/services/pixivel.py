from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
from loguru import logger

from backend.models import WallpaperItem
from backend.services.cache import ResponseCache


class PixivelServiceError(RuntimeError):
    """Raised when the upstream Pixiv mirror returns an unexpected structure."""


class PixivelService:
    """Fetch Pixiv ranking and artwork data through the HibiAPI mirror.

    The service talks to ``https://hibiapi.cocomi.eu.org`` (a public HibiAPI
    instance used by the Pxelk frontend).  Ranking endpoints are cached and the
    returned image URLs are rewritten so the application can proxy them
    through ``/api/pixiv-image`` (Pixiv's CDN requires a ``Referer`` header).
    """

    base_url = "https://hibiapi.cocomi.eu.org"
    pixiv_base_url = "https://www.pixiv.net"
    image_proxy_base_url = "https://i.yuki.sh"
    _cache = ResponseCache("pixivel", default_ttl=1800.0)

    _rank_modes = frozenset(
        {
            "day",
            "week",
            "month",
            "day_male",
            "day_female",
            "week_original",
            "week_rookie",
            "day_manga",
            "day_r18",
            "week_r18",
            "day_male_r18",
            "day_female_r18",
            "week_r18g",
        }
    )

    _mode_labels = {
        "day": "每日",
        "week": "每周",
        "month": "每月",
        "day_male": "每日 男性",
        "day_female": "每日 女性",
        "week_original": "每周 原创",
        "week_rookie": "每周 新人",
        "day_manga": "每日 漫画",
    }

    def __init__(self, session: requests.Session | None = None, timeout_seconds: int = 20) -> None:
        self._session = session or requests.Session()
        self._timeout_seconds = max(1, timeout_seconds)
        self._session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7,ja;q=0.6",
                "Referer": "https://pixiviz.cocomi.eu.org/",
                "Origin": "https://pixiviz.cocomi.eu.org",
            }
        )

    @classmethod
    def rank_mode_label(cls, mode: str) -> str:
        return cls._mode_labels.get(mode, mode)

    def query_ranking(
        self,
        mode: str = "day",
        page: int = 1,
        limit: int = 30,
        force_refresh: bool = False,
        ranking_date: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return a list of ranked work summaries.

        Each summary contains the artwork id, title, author, preview image,
        ranking mode, and the canonical Pixiv detail URL.
        """
        normalized_mode = str(mode).strip().lower()
        if normalized_mode not in self._rank_modes:
            raise ValueError(f"不支持的榜单模式: {mode}")
        if page < 1:
            raise ValueError("page 必须大于等于 1")
        if not 1 <= limit <= 100:
            raise ValueError("limit 必须在 1 到 100 之间")
        today_jst = datetime.now(timezone(timedelta(hours=9))).date()
        if ranking_date is not None:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", ranking_date):
                raise ValueError("榜单日期必须使用 YYYY-MM-DD 格式")
            try:
                selected_date = date.fromisoformat(ranking_date)
            except ValueError as exc:
                raise ValueError("榜单日期必须使用 YYYY-MM-DD 格式") from exc
        else:
            selected_date = today_jst - timedelta(days=1)
        if selected_date >= today_jst:
            raise ValueError("榜单日期必须早于日本时间今天")
        selected_date_text = selected_date.isoformat()

        cache_key = f"rank:v4:{normalized_mode}:{selected_date_text}:{page}:{limit}"
        if not force_refresh:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        try:
            raw_illusts = self._fetch_ranking(normalized_mode, page, selected_date_text)
            works = [
                self._normalize_work_summary(illust, normalized_mode, selected_date_text)
                for illust in raw_illusts[:limit]
            ]
        except Exception:
            stale = self._cache.get_stale(cache_key, max_age=6 * 3600)
            if stale is not None:
                logger.info("Pixivel ranking fallback to stale cache for {}", cache_key)
                return stale
            raise

        self._cache.set(cache_key, works)
        return works

    def fetch_work(self, work_id: str | int) -> list[dict[str, Any]]:
        """Fetch a single artwork and return one WallpaperItem per page."""
        normalized_id = str(work_id).strip()
        if not normalized_id.isdigit():
            raise ValueError("work_id 必须是数字")
        return self._fetch_illust_items(normalized_id)

    def _fetch_ranking(self, mode: str, page: int, ranking_date: str) -> list[dict[str, Any]]:
        url = f"{self.base_url}/api/pixiv/rank"
        response = self._session.get(
            url,
            params={"page": page, "mode": mode, "date": ranking_date},
            timeout=self._timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict) and payload.get("error"):
            raise PixivelServiceError(f"HibiAPI 返回错误: {payload.get('error')}")
        if not isinstance(payload, dict) or not isinstance(payload.get("illusts"), list):
            raise PixivelServiceError("HibiAPI 榜单数据结构已变化")
        return [illust for illust in payload["illusts"] if isinstance(illust, dict)]

    def _fetch_illust(self, work_id: str) -> dict[str, Any]:
        cache_key = f"illust:{work_id}"
        cached = self._cache.get(cache_key)
        if isinstance(cached, dict):
            return cached

        url = f"{self.base_url}/api/pixiv/illust"
        try:
            response = self._session.get(
                url,
                params={"id": work_id},
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict) and payload.get("error"):
                raise PixivelServiceError(f"HibiAPI 返回错误: {payload.get('error')}")
            if not isinstance(payload, dict) or not isinstance(payload.get("illust"), dict):
                raise PixivelServiceError("HibiAPI 作品详情数据结构已变化")
            illust = payload["illust"]
        except Exception:
            stale = self._cache.get_stale(cache_key)
            if isinstance(stale, dict):
                logger.info("Pixivel detail fallback to stale cache for {}", work_id)
                return stale
            raise

        self._cache.set(cache_key, illust)
        return illust

    def _fetch_illust_items(self, work_id: str) -> list[dict[str, Any]]:
        illust = self._fetch_illust(work_id)
        return self._illust_to_wallpaper_items(illust)

    @classmethod
    def _normalize_work_summary(
        cls, illust: dict[str, Any], mode: str, ranking_date: str
    ) -> dict[str, Any]:
        work_id = str(illust.get("id") or "").strip()
        user = illust.get("user") or {}
        image_urls = illust.get("image_urls") or {}
        page_count = cls._positive_int(illust.get("page_count")) or 1
        return {
            "id": work_id,
            "title": str(illust.get("title") or "").strip(),
            "author": str(user.get("name") or "").strip(),
            "author_id": str(user.get("id") or "").strip(),
            "preview_url": cls._rewrite_image_url(str(image_urls.get("medium") or "").strip()),
            "mode": mode,
            "mode_label": cls.rank_mode_label(mode),
            "page_count": page_count,
            "width": cls._positive_int(illust.get("width")),
            "height": cls._positive_int(illust.get("height")),
            "total_view": cls._positive_int(illust.get("total_view")),
            "total_bookmarks": cls._positive_int(illust.get("total_bookmarks")),
            "create_date": str(illust.get("create_date") or "").strip(),
            "ranking_date": ranking_date,
            "tags": cls._format_tags(illust.get("tags") or []),
            "detail_url": f"{cls.pixiv_base_url}/artworks/{work_id}",
            "source_id": "builtin.pixivel",
            "source_name": "Pixiv 排行榜",
        }

    @classmethod
    def _illust_to_wallpaper_items(cls, illust: dict[str, Any]) -> list[dict[str, Any]]:
        work_id = str(illust.get("id") or "").strip()
        user = illust.get("user") or {}
        title = str(illust.get("title") or "").strip()
        caption = str(illust.get("caption") or "").strip()
        tags = cls._format_tags(illust.get("tags") or [])
        page_count = cls._positive_int(illust.get("page_count")) or 1
        detail_url = f"{cls.pixiv_base_url}/artworks/{work_id}"

        pages = cls._extract_pages(illust)
        if not pages:
            pages = [
                {
                    "image_url": str(illust.get("image_urls", {}).get("large") or ""),
                    "preview_url": str(illust.get("image_urls", {}).get("medium") or ""),
                    "width": cls._positive_int(illust.get("width")),
                    "height": cls._positive_int(illust.get("height")),
                }
            ]

        results: list[dict[str, Any]] = []
        for index, page in enumerate(pages):
            image_url = page.get("image_url") or ""
            preview_url = page.get("preview_url") or image_url
            if not image_url:
                continue
            results.append(
                WallpaperItem(
                    id=f"pixivel:{work_id}:{index}",
                    source_id="builtin.pixivel",
                    source_name="Pixiv 排行榜",
                    title=title if len(pages) == 1 else f"{title} #{index + 1}",
                    image_url=image_url,
                    preview_url=preview_url,
                    width=page.get("width") or cls._positive_int(illust.get("width")),
                    height=page.get("height") or cls._positive_int(illust.get("height")),
                    description=caption,
                    metadata={
                        "work_id": work_id,
                        "detail_url": detail_url,
                        "click_url": detail_url,
                        "referer": detail_url,
                        "author": str(user.get("name") or "").strip(),
                        "author_id": str(user.get("id") or "").strip(),
                        "author_url": (
                            f"{cls.pixiv_base_url}/users/{user.get('id')}"
                            if user.get("id")
                            else ""
                        ),
                        "tags": tags,
                        "page_count": page_count,
                        "page_index": index,
                        "create_date": str(illust.get("create_date") or "").strip(),
                        "total_view": cls._positive_int(illust.get("total_view")),
                        "total_bookmarks": cls._positive_int(illust.get("total_bookmarks")),
                    },
                ).to_dict()
            )
        return results

    @classmethod
    def _extract_pages(cls, illust: dict[str, Any]) -> list[dict[str, Any]]:
        """Return a list of image URLs for every page of a multi-page artwork."""
        pages: list[dict[str, Any]] = []
        meta_pages = illust.get("meta_pages") or []
        if isinstance(meta_pages, list) and meta_pages:
            for page in meta_pages:
                if not isinstance(page, dict):
                    continue
                urls = page.get("image_urls") or {}
                original = str(urls.get("original") or "").strip()
                large = str(urls.get("large") or "").strip()
                medium = str(urls.get("medium") or "").strip()
                image_url = original or large or medium
                if not image_url:
                    continue
                pages.append(
                    {
                        "image_url": cls._rewrite_image_url(image_url),
                        "preview_url": cls._rewrite_image_url(medium or large or image_url),
                        "width": cls._positive_int(page.get("width")),
                        "height": cls._positive_int(page.get("height")),
                    }
                )
            return pages

        meta_single = illust.get("meta_single_page") or {}
        if isinstance(meta_single, dict) and meta_single.get("original_image_url"):
            pages.append(
                {
                    "image_url": cls._rewrite_image_url(str(meta_single["original_image_url"]).strip()),
                    "preview_url": cls._rewrite_image_url(
                        str(illust.get("image_urls", {}).get("medium", "")).strip()
                    ),
                }
            )
            return pages

        return []

    @staticmethod
    def _format_tags(tags: list[Any]) -> list[str]:
        formatted: list[str] = []
        for tag in tags:
            if isinstance(tag, dict):
                name = str(tag.get("name") or "").strip()
                translated = str(tag.get("translated_name") or "").strip()
                if translated and translated != name:
                    formatted.append(f"{name} ({translated})")
                elif name:
                    formatted.append(name)
            elif isinstance(tag, str):
                formatted.append(tag.strip())
        return formatted

    @classmethod
    def _rewrite_image_url(cls, url: str) -> str:
        """Rewrite Pixiv's origin and legacy mirror to the active image CDN.

        Direct access to ``i.pximg.net`` is blocked in some regions; the
        ``i.yuki.sh`` mirror is the active endpoint used by the target frontend.
        """
        if not url:
            return url
        for origin in (
            "https://i.pximg.net",
            "http://i.pximg.net",
            "https://pximg.cocomi.eu.org",
            "http://pximg.cocomi.eu.org",
        ):
            if url.startswith(origin):
                return url.replace(origin, cls.image_proxy_base_url, 1)
        return url

    @staticmethod
    def _positive_int(value: Any) -> int | None:
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return number if number > 0 else None
