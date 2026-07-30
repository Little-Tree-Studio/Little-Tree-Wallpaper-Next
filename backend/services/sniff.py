from __future__ import annotations

import contextlib
import html as html_module
import json
import re
import time
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlparse

import requests
from loguru import logger


def _split_srcset(srcset: str) -> list[str]:
    candidates: list[str] = []
    for item in srcset.split(","):
        item = item.strip()
        if not item:
            continue
        candidate = item.split(maxsplit=1)[0]
        if candidate and not candidate.lower().startswith("data:"):
            candidates.append(candidate)
    return candidates


class _ImageExtractor(HTMLParser):
    """Collect image candidates and embedded data from HTML."""

    IMAGE_META_KEYS = {
        "image",
        "og:image",
        "og:image:url",
        "og:image:secure_url",
        "twitter:image",
        "twitter:image:src",
        "thumbnail",
        "thumbnailurl",
        "msapplication-tileimage",
    }
    IMAGE_LINK_RELS = {
        "icon",
        "apple-touch-icon",
        "apple-touch-startup-image",
        "image_src",
    }
    URL_ATTRS = (
        "src",
        "data-src",
        "data-lazy-src",
        "data-original",
        "data-bg",
        "data-background",
        "data-image",
        "data-lazy",
        "data-retina",
    )
    SRCSET_ATTRS = ("srcset", "data-srcset", "data-lazy-srcset")

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.urls: set[str] = set()
        self.base_href = ""
        self.script_blocks: list[tuple[str, str, str]] = []
        self._in_script = False
        self._script_id = ""
        self._script_type = ""
        self._script_data: list[str] = []
        self._in_style = False
        self._style_data: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.lower(): value or "" for key, value in attrs}
        tag_lower = tag.lower()

        if tag_lower in {"amp-img", "img", "source"}:
            self._add_url_attributes(attributes)
            self._add_srcsets(attributes)
        elif tag_lower in {"media:content", "media:thumbnail"} or (
            tag_lower == "enclosure" and attributes.get("type", "").lower().startswith("image/")
        ):
            self._add(attributes.get("url", ""))
        elif tag_lower == "video":
            self._add(attributes.get("poster", ""))
        elif tag_lower == "image":
            self._add(attributes.get("href", "") or attributes.get("xlink:href", ""))
        elif tag_lower == "input" and attributes.get("type", "").lower() == "image":
            self._add(attributes.get("src", ""))
        elif tag_lower == "object" and attributes.get("type", "").lower().startswith("image/"):
            self._add(attributes.get("data", ""))
        elif tag_lower == "meta":
            key = (attributes.get("property") or attributes.get("name") or attributes.get("itemprop")).lower()
            if key in self.IMAGE_META_KEYS:
                self._add(attributes.get("content", ""))
        elif tag_lower == "link":
            rels = set(attributes.get("rel", "").lower().split())
            if rels & self.IMAGE_LINK_RELS or ("preload" in rels and attributes.get("as", "").lower() == "image"):
                self._add(attributes.get("href", ""))
                for candidate in _split_srcset(attributes.get("imagesrcset", "")):
                    self._add(candidate)
        elif tag_lower == "base" and not self.base_href:
            self.base_href = attributes.get("href", "").strip()
        elif tag_lower == "style":
            self._in_style = True
            self._style_data.clear()
        elif tag_lower == "script":
            self._in_script = True
            self._script_id = attributes.get("id", "")
            self._script_type = attributes.get("type", "")
            self._script_data.clear()

        self._add(attributes.get("background", ""))
        if inline_style := attributes.get("style", ""):
            self._parse_css_urls(inline_style)

    def handle_data(self, data: str) -> None:
        if self._in_style:
            self._style_data.append(data)
        if self._in_script:
            self._script_data.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag_lower = tag.lower()
        if tag_lower == "style" and self._in_style:
            self._in_style = False
            self._parse_css_urls("".join(self._style_data))
            self._style_data.clear()
        elif tag_lower == "script" and self._in_script:
            self._in_script = False
            self.script_blocks.append((self._script_id, self._script_type, "".join(self._script_data)))
            self._script_data.clear()

    def _add_url_attributes(self, attributes: dict[str, str]) -> None:
        for attr in self.URL_ATTRS:
            self._add(attributes.get(attr, ""))

    def _add_srcsets(self, attributes: dict[str, str]) -> None:
        for attr in self.SRCSET_ATTRS:
            for candidate in _split_srcset(attributes.get(attr, "")):
                self._add(candidate)

    def _add(self, value: str) -> None:
        value = value.strip()
        if value and not value.lower().startswith("data:"):
            self.urls.add(value)

    def _parse_css_urls(self, css: str) -> None:
        for match in re.findall(r"url\(\s*(?P<url>[^)]+?)\s*\)", css, flags=re.IGNORECASE):
            self._add(match.strip("'\" "))


class SniffService:
    IMAGE_EXTENSIONS = r"png|jpe?g|webp|gif|svg|avif|bmp|ico|heic|tiff?|jxl"
    IMAGE_REGEX = re.compile(
        rf"((?:(?:https?:)?//|(?:\.\.?/|/)?)[^\s\"'<>`]+?\."
        rf"(?:{IMAGE_EXTENSIONS})(?:[?#][^\s\"'<>`),;\]}}]*)?)",
        re.IGNORECASE,
    )
    STATE_ASSIGNMENT_REGEX = re.compile(
        r"(?:window\.)?__(?:APOLLO_STATE|INITIAL_STATE|DATA|NUXT|PRELOADED_STATE)__\s*=\s*",
        re.IGNORECASE,
    )
    IMAGE_KEY_HINTS = {
        "avatar",
        "background",
        "banner",
        "cover",
        "icon",
        "image",
        "img",
        "logo",
        "pic",
        "picture",
        "poster",
        "src",
        "srcset",
        "thumb",
        "thumbnail",
        "wallpaper",
    }
    TRACKING_PATTERNS = [
        r"/pixel\.",
        r"/spacer\.",
        r"/(?:blank|clear|transparent)\.gif",
        r"/1x1\.",
        r"/dot\.gif",
        r"google-analytics\.com",
        r"facebook\.com/tr",
        r"doubleclick\.net",
        r"baidu\.com/hm\.gif",
        r"hm\.baidu\.com",
    ]
    TRACKING_QUERY_PARAMS = {
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid",
        "utm_campaign",
        "utm_content",
        "utm_medium",
        "utm_source",
        "utm_term",
    }

    def __init__(self, session: requests.Session | None = None) -> None:
        self._session = session or requests.Session()
        self._tracking_regex = re.compile("|".join(self.TRACKING_PATTERNS), re.IGNORECASE)

    def sniff_images(
        self,
        url: str,
        user_agent: str,
        timeout_seconds: int = 15,
        referer: str = "",
        use_source_as_referer: bool = True,
    ) -> list[dict[str, Any]]:
        started_at = time.perf_counter()
        url = url.strip()
        if not url.lower().startswith(("http://", "https://")):
            url = "http://" + url

        try:
            timeout = max(1, int(timeout_seconds))
        except (TypeError, ValueError):
            logger.warning(
                "Sniff aborted: url={} invalid_timeout={!r}",
                url,
                timeout_seconds,
            )
            return []

        referer_mode = "source" if use_source_as_referer else ("custom" if referer.strip() else "none")
        logger.info(
            "Sniff started: url={} timeout={}s referer_mode={}",
            url,
            timeout,
            referer_mode,
        )
        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8",
        }
        page_referer = url if use_source_as_referer else referer.strip()
        if page_referer.lower().startswith(("http://", "https://")):
            headers["Referer"] = page_referer

        try:
            response = self._session.get(
                url,
                headers=headers,
                timeout=timeout,
                allow_redirects=True,
            )
            response.raise_for_status()
        except requests.exceptions.RequestException as exc:
            logger.warning(
                "Sniff fetch failed: url={} error_type={} error={} elapsed_ms={:.1f}",
                url,
                type(exc).__name__,
                exc,
                (time.perf_counter() - started_at) * 1000,
            )
            return []

        page_url = str(response.url or url)
        if use_source_as_referer:
            page_referer = page_url

        content_type = str(response.headers.get("Content-Type", "")).split(";", 1)[0].strip().lower()
        logger.debug(
            "Sniff response: source={} final={} status={} content_type={} redirected={} fetch_ms={:.1f}",
            url,
            page_url,
            getattr(response, "status_code", "unknown"),
            content_type or "unknown",
            page_url != url,
            (time.perf_counter() - started_at) * 1000,
        )
        if content_type.startswith("image/"):
            results = self._process_results(
                page_url,
                {page_url},
                page_referer,
                page_url=page_url,
            )
            logger.info(
                "Sniff completed: page={} images={} elapsed_ms={:.1f}",
                page_url,
                len(results),
                (time.perf_counter() - started_at) * 1000,
            )
            return results

        html = response.text
        parser = _ImageExtractor()
        try:
            parser.feed(html)
            parser.close()
        except Exception as exc:
            logger.debug(
                "Sniff HTML parsing stopped early: page={} error_type={} error={}",
                page_url,
                type(exc).__name__,
                exc,
            )

        html_urls = set(parser.urls)
        json_urls: set[str] = set()
        if content_type == "application/json" or content_type.endswith("+json"):
            try:
                self._deep_walk_json(json.loads(html), json_urls)
            except (json.JSONDecodeError, TypeError) as exc:
                logger.debug(
                    "Sniff JSON parsing failed: page={} error_type={} error={}",
                    page_url,
                    type(exc).__name__,
                    exc,
                )
        script_urls = self._extract_script_images(parser.script_blocks)
        state_urls = self._extract_assigned_state_images(html)
        text_urls = self._extract_images_from_text(html)
        found_urls = html_urls | json_urls | script_urls | state_urls | text_urls

        base_url = urljoin(page_url, parser.base_href) if parser.base_href else page_url
        logger.debug(
            "Sniff extraction: page={} html={} json={} scripts={} state={} text={} unique={} base={}",
            page_url,
            len(html_urls),
            len(json_urls),
            len(script_urls),
            len(state_urls),
            len(text_urls),
            len(found_urls),
            base_url,
        )
        results = self._process_results(
            base_url,
            found_urls,
            page_referer,
            page_url=page_url,
        )
        logger.info(
            "Sniff completed: page={} images={} elapsed_ms={:.1f}",
            page_url,
            len(results),
            (time.perf_counter() - started_at) * 1000,
        )
        return results

    def _extract_script_images(self, blocks: list[tuple[str, str, str]]) -> set[str]:
        urls: set[str] = set()
        for script_id, script_type, script_text in blocks:
            if not script_text.strip():
                continue
            normalized_type = script_type.split(";", 1)[0].strip().lower()
            if script_id.upper() in {"__NEXT_DATA__", "__NUXT_DATA__"} or normalized_type in {
                "application/json",
                "application/ld+json",
            }:
                with contextlib.suppress(json.JSONDecodeError, TypeError):
                    self._deep_walk_json(json.loads(script_text), urls)
            urls.update(self._extract_images_from_text(script_text))
        return urls

    def _extract_assigned_state_images(self, html: str) -> set[str]:
        urls: set[str] = set()
        decoder = json.JSONDecoder()
        normalized_html = self._decode_escaped_text(html)
        for match in self.STATE_ASSIGNMENT_REGEX.finditer(normalized_html):
            try:
                data, _ = decoder.raw_decode(normalized_html, match.end())
            except json.JSONDecodeError:
                continue
            self._deep_walk_json(data, urls)
        return urls

    def _deep_walk_json(self, obj: Any, urls: set[str], *, image_hint: bool = False) -> None:
        if isinstance(obj, dict):
            for key, value in obj.items():
                normalized_key = re.sub(r"[^a-z0-9]+", "", str(key).lower())
                child_hint = image_hint or any(hint in normalized_key for hint in self.IMAGE_KEY_HINTS)
                self._deep_walk_json(value, urls, image_hint=child_hint)
        elif isinstance(obj, list):
            for item in obj:
                self._deep_walk_json(item, urls, image_hint=image_hint)
        elif isinstance(obj, str):
            value = self._clean_candidate(obj)
            if image_hint and self._looks_like_url(value):
                if "srcset" in value.lower() or re.search(r"\s+\d+(?:\.\d+)?[wx](?:\s*,|$)", value):
                    urls.update(_split_srcset(value))
                else:
                    urls.add(value)
            urls.update(self._extract_images_from_text(value))

    def _extract_images_from_text(self, text: str) -> set[str]:
        normalized = self._decode_escaped_text(text)
        return {match for match in self.IMAGE_REGEX.findall(normalized) if match}

    def _process_results(
        self,
        base_url: str,
        raw_urls: set[str],
        referer: str = "",
        *,
        page_url: str | None = None,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        invalid_count = 0
        tracking_count = 0
        duplicate_count = 0

        for item in sorted(raw_urls):
            clean_url = self._clean_candidate(item)
            if not self._looks_like_url(clean_url):
                invalid_count += 1
                continue

            absolute_url = urljoin(base_url, clean_url)
            parsed = urlparse(absolute_url)
            if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
                invalid_count += 1
                continue
            absolute_url = parsed._replace(fragment="").geturl()

            if self._tracking_regex.search(absolute_url):
                tracking_count += 1
                continue

            normalized_url = self._normalize_url(absolute_url)
            if normalized_url in seen_urls:
                duplicate_count += 1
                continue
            seen_urls.add(normalized_url)

            filename = unquote(urlparse(absolute_url).path.rsplit("/", 1)[-1])
            title = filename if filename and not filename.startswith(".") else f"图片 {len(results) + 1}"
            results.append(
                {
                    "id": f"sniff:{len(results)}",
                    "source_id": "builtin.sniff",
                    "source_name": "网页嗅探",
                    "title": title,
                    "image_url": absolute_url,
                    "preview_url": absolute_url,
                    "metadata": {
                        "page_url": page_url or base_url,
                        "referer": referer,
                    },
                }
            )
        logger.debug(
            "Sniff filtering: page={} raw={} accepted={} invalid={} tracking={} duplicate={}",
            page_url or base_url,
            len(raw_urls),
            len(results),
            invalid_count,
            tracking_count,
            duplicate_count,
        )
        return results

    @classmethod
    def _clean_candidate(cls, value: str) -> str:
        cleaned = html_module.unescape(str(value or "")).strip().strip("'\"")
        return cls._decode_escaped_text(cleaned).strip()

    @staticmethod
    def _decode_escaped_text(value: str) -> str:
        replacements = {
            r"\u0026": "&",
            r"\u002F": "/",
            r"\u003A": ":",
            r"\x26": "&",
            r"\x2F": "/",
            r"\x3A": ":",
        }
        decoded = value.replace("\\/", "/")
        for escaped, replacement in replacements.items():
            decoded = re.sub(re.escape(escaped), replacement, decoded, flags=re.IGNORECASE)
        return decoded

    @classmethod
    def _looks_like_url(cls, value: str) -> bool:
        if not value or any(char in value for char in ("\r", "\n", "\t")):
            return False
        lowered = value.lower()
        if lowered.startswith(("data:", "blob:", "javascript:", "mailto:", "about:", "#")):
            return False
        if lowered.startswith(("http://", "https://", "//", "/", "./", "../")):
            return True
        path = urlparse(value).path
        return bool(re.search(rf"\.(?:{cls.IMAGE_EXTENSIONS})$", path, flags=re.IGNORECASE))

    def _normalize_url(self, url: str) -> str:
        try:
            parsed = urlparse(url)
            filtered_query = [
                (key, value)
                for key, value in parse_qsl(parsed.query, keep_blank_values=True)
                if key.lower() not in self.TRACKING_QUERY_PARAMS
            ]
            return parsed._replace(
                scheme=parsed.scheme.lower(),
                netloc=parsed.netloc.lower(),
                query=urlencode(filtered_query, doseq=True),
                fragment="",
            ).geturl()
        except (TypeError, ValueError):
            return url
