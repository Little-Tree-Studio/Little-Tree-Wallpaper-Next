from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from typing import Any

import requests
from loguru import logger

from backend.models import WallpaperItem
from backend.services.cache import ResponseCache


class CNUServiceError(RuntimeError):
    """Raised when CNU returns data that no longer matches its public pages."""


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if value:
            self.parts.append(value)

    def text(self) -> str:
        return " ".join(self.parts)


class _WorkMetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self.body_parts: list[str] = []
        self.author_parts: list[str] = []
        self.author_url = ""
        self.published_at = ""
        self._title_depth = 0
        self._body_depth = 0
        self._author_depth = 0

    @staticmethod
    def _classes(attrs: dict[str, str]) -> set[str]:
        return set(attrs.get("class", "").split())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        classes = self._classes(values)
        if tag == "h2" and "work-title" in classes:
            self._title_depth = 1
        elif self._title_depth:
            self._title_depth += 1

        if values.get("id") == "work_body":
            self._body_depth = 1
        elif self._body_depth:
            self._body_depth += 1

        if tag == "a" and "/users/" in values.get("href", "") and not self.author_url:
            self.author_url = values["href"]
            self._author_depth = 1
        elif self._author_depth:
            self._author_depth += 1

        if "timeago" in classes and values.get("title"):
            self.published_at = values["title"].strip()

    def handle_endtag(self, tag: str) -> None:
        if self._title_depth:
            self._title_depth -= 1
        if self._body_depth:
            self._body_depth -= 1
        if self._author_depth:
            self._author_depth -= 1

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if not value:
            return
        if self._title_depth:
            self.title_parts.append(value)
        if self._body_depth:
            self.body_parts.append(value)
        if self._author_depth:
            self.author_parts.append(value)


class _WorkListParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.works: list[dict[str, str]] = []
        self._work_depth = 0
        self._title_depth = 0
        self._author_depth = 0
        self._current: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        classes = set(values.get("class", "").split())
        if tag == "div" and {"grid-item", "work-thumbnail"}.issubset(classes):
            self._work_depth = 1
            self._current = {}
            return
        if not self._work_depth:
            return
        if tag == "div":
            self._work_depth += 1
        if tag == "a" and "/works/" in values.get("href", ""):
            self._current["detail_url"] = values["href"]
            self._current["id"] = values["href"].rstrip("/").rsplit("/", 1)[-1]
        elif tag == "div" and "title" in classes:
            self._title_depth = self._work_depth
        elif tag == "div" and "author" in classes:
            self._author_depth = self._work_depth
        elif tag == "img" and values.get("src"):
            self._current["preview_url"] = html.unescape(values["src"])

    def handle_endtag(self, tag: str) -> None:
        if not self._work_depth or tag != "div":
            return
        if self._title_depth == self._work_depth:
            self._title_depth = 0
        if self._author_depth == self._work_depth:
            self._author_depth = 0
        self._work_depth -= 1
        if self._work_depth == 0:
            if self._current.get("id") and self._current.get("preview_url"):
                self.works.append(self._current)
            self._current = {}

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if not value:
            return
        if self._title_depth:
            self._current["title"] = f"{self._current.get('title', '')} {value}".strip()
        if self._author_depth:
            self._current["author"] = f"{self._current.get('author', '')} {value}".strip()


class CNUService:
    base_url = "http://www.cnu.cc"
    image_base_url = "http://imgoss.cnu.cc"
    legacy_image_base_url = "http://img.cnu.cc/forum"
    _cache = ResponseCache("cnu", default_ttl=21600.0)
    _images_pattern = re.compile(
        r'<div\b[^>]*\bid=["\']imgs_json["\'][^>]*>(.*?)</div>',
        flags=re.IGNORECASE | re.DOTALL,
    )
    _section_orders = {
        "inspiration": frozenset({"recent", "hot"}),
        "discovery": frozenset({"hot", "recommend", "recent"}),
    }
    _category_names = {
        "inspiration": {
            "0": "全部", "220": "时尚大片", "222": "时装发布", "9": "潮流趋势",
            "118": "时尚摄影", "8": "婚纱摄影", "120": "广告摄影", "111": "人像摄影",
            "110": "人文摄影", "226": "风光摄影", "242": "生态摄影", "243": "观念摄影",
            "6": "当代艺术", "14": "插画设计", "12": "平面设计",
        },
        "discovery": {
            "0": "全部", "111": "人像摄影", "112": "情侣写真", "113": "儿童摄影",
            "237": "模特展示", "118": "时尚摄影", "120": "广告摄影", "44": "艺术摄影",
            "243": "观念摄影", "110": "街头人文", "226": "风光摄影", "227": "建筑摄影",
            "242": "生态摄影", "114": "宠物摄影",
        },
    }

    def __init__(self, session: requests.Session | None = None, timeout_seconds: int = 20) -> None:
        self._session = session or requests.Session()
        self._timeout_seconds = max(1, timeout_seconds)
        self._session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LittleTreeWallpaperNext/2.0",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
            }
        )

    def query_selected(
        self,
        page: int = 1,
        limit: int = 20,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        if page < 1:
            raise ValueError("page 必须大于等于 1")
        if not 1 <= limit <= 100:
            raise ValueError("limit 必须在 1 到 100 之间")

        cache_key = f"selected:{page}:{limit}"
        if not force_refresh:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        try:
            works = self._fetch_selected_works(page)
            items: list[dict[str, Any]] = []
            for work in works:
                if len(items) >= limit:
                    break
                try:
                    remaining = limit - len(items)
                    items.extend(self._fetch_work_items(work, max_images=remaining))
                except Exception as exc:
                    logger.warning("Skipping CNU work {}: {}", work.get("id"), exc)
            if works and not items:
                raise CNUServiceError("CNU 精选作品存在，但详情页均无法解析")
        except Exception:
            stale = self._cache.get_stale(cache_key)
            if stale is not None:
                logger.info("CNU query fallback to stale cache for {}", cache_key)
                return stale
            raise

        self._cache.set(cache_key, items)
        return items

    def query_selected_works(
        self,
        page: int = 1,
        limit: int = 20,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        if page < 1:
            raise ValueError("page 必须大于等于 1")
        if not 1 <= limit <= 50:
            raise ValueError("limit 必须在 1 到 50 之间")

        cache_key = f"selected-works:{page}:{limit}"
        if not force_refresh:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        try:
            works = [self._normalize_work_summary(work) for work in self._fetch_selected_works(page)[:limit]]
        except Exception:
            stale = self._cache.get_stale(cache_key)
            if stale is not None:
                logger.info("CNU work list fallback to stale cache for {}", cache_key)
                return stale
            raise

        self._cache.set(cache_key, works)
        return works

    def query_works(
        self,
        section: str,
        order: str,
        category_id: str | int = "0",
        page: int = 1,
        limit: int = 50,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]]:
        normalized_section = str(section).strip().lower()
        normalized_order = str(order).strip().lower()
        normalized_category = str(category_id).strip()
        if normalized_section not in self._section_orders:
            raise ValueError("section 必须是 inspiration 或 discovery")
        if normalized_order not in self._section_orders[normalized_section]:
            raise ValueError("当前 section 不支持该排序")
        if normalized_category not in self._category_names[normalized_section]:
            raise ValueError("未知的 CNU 分类")
        if page < 1:
            raise ValueError("page 必须大于等于 1")
        if not 1 <= limit <= 50:
            raise ValueError("limit 必须在 1 到 50 之间")

        cache_key = f"works:{normalized_section}:{normalized_order}:{normalized_category}:{page}:{limit}"
        if not force_refresh:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        try:
            works = self._fetch_work_list_page(
                normalized_section,
                normalized_order,
                normalized_category,
                page,
            )[:limit]
        except Exception:
            stale = self._cache.get_stale(cache_key)
            if stale is not None:
                logger.info("CNU list fallback to stale cache for {}", cache_key)
                return stale
            raise

        category_name = self._category_names[normalized_section][normalized_category]
        work_type = "杂志" if normalized_section == "inspiration" else "原创"
        for work in works:
            work.update(
                {
                    "description": "",
                    "author_id": "",
                    "category": category_name if normalized_category != "0" else "",
                    "category_id": normalized_category,
                    "selected_date": "",
                    "work_type": work_type,
                    "section": normalized_section,
                    "order": normalized_order,
                }
            )
        self._cache.set(cache_key, works)
        return works

    def fetch_work(self, work_id: str | int) -> list[dict[str, Any]]:
        normalized_id = str(work_id).strip()
        if not normalized_id.isdigit():
            raise ValueError("work_id 必须是数字")
        return self._fetch_work_items({"id": normalized_id})

    def _fetch_selected_works(self, page: int) -> list[dict[str, Any]]:
        url = f"{self.base_url}/selectedsFlow/{page}"
        response = self._session.get(url, timeout=self._timeout_seconds)
        response.raise_for_status()
        response.encoding = "utf-8"
        try:
            payload = response.json()
        except ValueError as exc:
            raise CNUServiceError("CNU 精选接口返回了无效 JSON") from exc
        return self.parse_selected_payload(payload)

    def _fetch_work_list_page(
        self,
        section: str,
        order: str,
        category_id: str,
        page: int,
    ) -> list[dict[str, Any]]:
        page_name = "inspirationPage" if section == "inspiration" else "discoveryPage"
        url = f"{self.base_url}/{page_name}/{order}-{category_id}"
        response = self._session.get(url, params={"page": page}, timeout=self._timeout_seconds)
        response.raise_for_status()
        response.encoding = "utf-8"
        return self.parse_work_list_html(response.text)

    @staticmethod
    def parse_work_list_html(document: str) -> list[dict[str, Any]]:
        parser = _WorkListParser()
        parser.feed(document)
        return parser.works

    @classmethod
    def parse_selected_payload(cls, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise CNUServiceError("CNU 精选接口结构已变化")
        works: list[dict[str, Any]] = []
        for group in payload["data"]:
            if not isinstance(group, dict):
                continue
            date = str(group.get("date") or "").strip()
            for raw_work in group.get("works") or []:
                if not isinstance(raw_work, dict) or not str(raw_work.get("id") or "").isdigit():
                    continue
                work = dict(raw_work)
                work["selected_date"] = date
                work["description"] = cls._html_to_text(str(work.get("body") or ""))
                cover = html.unescape(str(work.get("cover") or "").strip())
                work["preview_url"] = cls._build_preview_url(cover)
                works.append(work)
        return works

    def _fetch_work_items(
        self,
        work: dict[str, Any],
        max_images: int | None = None,
    ) -> list[dict[str, Any]]:
        work_id = str(work.get("id") or "").strip()
        detail_url = f"{self.base_url}/works/{work_id}"
        response = self._session.get(
            detail_url,
            timeout=self._timeout_seconds,
            headers={"Referer": f"{self.base_url}/selectedPage"},
        )
        response.raise_for_status()
        response.encoding = "utf-8"
        return self.parse_work_html(
            response.text,
            work_id=work_id,
            detail_url=detail_url,
            list_metadata=work,
            max_images=max_images,
        )

    @classmethod
    def _normalize_work_summary(cls, work: dict[str, Any]) -> dict[str, Any]:
        work_id = str(work.get("id") or "").strip()
        return {
            "id": work_id,
            "title": str(work.get("title") or "CNU 作品").strip(),
            "description": str(work.get("description") or "").strip(),
            "preview_url": str(work.get("preview_url") or "").strip(),
            "author": str(work.get("author_display_name") or "").strip(),
            "author_id": str(work.get("author_id") or "").strip(),
            "category": str(work.get("category") or "").strip(),
            "category_id": str(work.get("category_id") or "").strip(),
            "selected_date": str(work.get("selected_date") or "").strip(),
            "work_type": cls._work_type_label(work.get("type"), work.get("category")),
            "section": "selected",
            "order": "selected",
            "detail_url": f"{cls.base_url}/works/{work_id}",
        }

    @staticmethod
    def _work_type_label(value: Any, category: Any = "") -> str:
        normalized = str(value or "").strip()
        if normalized == "2":
            return "原创"
        if normalized == "-2":
            return "杂志"
        return str(category or "").strip()

    @classmethod
    def parse_work_html(
        cls,
        document: str,
        *,
        work_id: str,
        detail_url: str | None = None,
        list_metadata: dict[str, Any] | None = None,
        max_images: int | None = None,
    ) -> list[dict[str, Any]]:
        match = cls._images_pattern.search(document)
        if not match:
            raise CNUServiceError("CNU 详情页缺少 imgs_json")
        try:
            raw_images = json.loads(html.unescape(match.group(1)).strip())
        except (TypeError, ValueError) as exc:
            raise CNUServiceError("CNU 详情页图片数据无法解析") from exc
        if not isinstance(raw_images, list):
            raise CNUServiceError("CNU 详情页图片数据结构已变化")

        parser = _WorkMetadataParser()
        parser.feed(document)
        list_metadata = list_metadata or {}
        title = " ".join(parser.title_parts).strip() or str(list_metadata.get("title") or "CNU 图片")
        description = " ".join(parser.body_parts).strip() or str(list_metadata.get("description") or "")
        author = " ".join(parser.author_parts).strip() or str(list_metadata.get("author_display_name") or "")
        preview_url = str(list_metadata.get("preview_url") or "")
        resolved_detail_url = detail_url or f"{cls.base_url}/works/{work_id}"

        results: list[dict[str, Any]] = []
        image_limit = len(raw_images) if max_images is None else max(0, max_images)
        for index, raw_image in enumerate(raw_images[:image_limit]):
            if not isinstance(raw_image, dict):
                continue
            image_path = str(raw_image.get("img") or "").strip().lstrip("/")
            if not image_path:
                continue
            is_legacy = str(raw_image.get("height") or "").lower() == "auto"
            image_url = (
                f"{cls.legacy_image_base_url}/{image_path}"
                if is_legacy
                else f"{cls.image_base_url}/{image_path}?x-oss-process=style/content"
            )
            image_description = cls._html_to_text(str(raw_image.get("content") or ""))
            image_text = cls._html_to_text(str(raw_image.get("text") or ""))
            results.append(
                WallpaperItem(
                    id=f"cnu:{work_id}:{index}",
                    source_id="builtin.cnu",
                    source_name="CNU 视觉联盟",
                    title=title if len(raw_images) == 1 else f"{title} #{index + 1}",
                    image_url=image_url,
                    preview_url=preview_url or image_url,
                    width=cls._positive_int(raw_image.get("width")),
                    height=None if is_legacy else cls._positive_int(raw_image.get("height")),
                    description=image_description or image_text or description,
                    metadata={
                        "work_id": work_id,
                        "detail_url": resolved_detail_url,
                        "click_url": resolved_detail_url,
                        "referer": resolved_detail_url,
                        "author": author,
                        "author_url": parser.author_url,
                        "published_at": parser.published_at,
                        "category": str(list_metadata.get("category") or ""),
                        "category_id": str(list_metadata.get("category_id") or ""),
                        "selected_date": str(list_metadata.get("selected_date") or ""),
                        "image_index": index,
                        "image_count": len(raw_images),
                        "image_description": image_description,
                        "image_text": image_text,
                        "image_path": image_path,
                    },
                ).to_dict()
            )
        return results

    @classmethod
    def _build_preview_url(cls, cover: str) -> str:
        if not cover:
            return ""
        url = cover if cover.startswith(("http://", "https://")) else f"{cls.image_base_url}/{cover.lstrip('/')}"
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}x-oss-process=style/flow280"

    @staticmethod
    def _html_to_text(value: str) -> str:
        parser = _TextExtractor()
        parser.feed(html.unescape(value))
        return parser.text()

    @staticmethod
    def _positive_int(value: Any) -> int | None:
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return number if number > 0 else None
