from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import requests
from loguru import logger


class _ImageExtractor(HTMLParser):
    """基础 HTML 标签解析器"""

    def __init__(self) -> None:
        super().__init__()
        self.urls: set[str] = set()
        self.in_script = False
        self.script_data: list[str] = []
        self.in_style = False
        self.style_data: list[str] = []

        self.lazy_attrs = {
            "data-src",
            "data-lazy-src",
            "data-original",
            "data-srcset",
            "data-bg",
            "data-image",
            "data-lazy",
            "data-retina",
        }

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.lower(): value or "" for key, value in attrs}
        tag_lower = tag.lower()

        if tag_lower == "img":
            if src := attributes.get("src"):
                self.urls.add(src)
            for lazy in self.lazy_attrs:
                if val := attributes.get(lazy):
                    self.urls.add(val)
        elif tag_lower == "source":
            self._parse_srcset(attributes.get("srcset", "") or attributes.get("data-srcset", ""))
        elif tag_lower == "meta":
            prop = attributes.get("property") or attributes.get("name")
            content = attributes.get("content")
            if prop and prop.lower() in {"og:image", "twitter:image"} and content:
                self.urls.add(content)
        elif tag_lower == "style":
            self.in_style = True
            self.style_data.clear()
        elif tag_lower == "script":
            self.in_script = True
            self.script_data.clear()
            # 直接提取 SSR 脚本标签的属性 (如 Next.js 的 <script id="__NEXT_DATA__">)
            if attributes.get("id") in {"__NEXT_DATA__", "__NUXT_DATA__"}:
                pass  # 数据会在 handle_data 中收集

        if style := attributes.get("style", ""):
            self._parse_css_urls(style)

    def handle_data(self, data: str) -> None:
        if self.in_style:
            self.style_data.append(data)
        if self.in_script:
            self.script_data.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "style" and self.in_style:
            self.in_style = False
            self._parse_css_urls("".join(self.style_data))
        elif tag.lower() == "script" and self.in_script:
            self.in_script = False
            # 将 script 内容存起来，后续统一用正则和 JSON 解析处理
            self.script_data.clear()

    def _parse_srcset(self, srcset: str) -> None:
        for item in srcset.split(","):
            if candidate := item.strip().split(" ")[0]:
                self.urls.add(candidate)

    def _parse_css_urls(self, css: str) -> None:
        for match in re.findall(r"url\((?P<url>[^)]+)\)", css, flags=re.IGNORECASE):
            if (url := match.strip("'\"").strip()) and not url.startswith("data:"):
                self.urls.add(url)


class SniffService:
    # 匹配常见图片格式，支持转义符 (JSON 中常见 \/)
    IMAGE_REGEX = re.compile(
        r'(https?:\\?/\\?/[^\s"\'<>\\]+?\.(?:png|jpe?g|webp|gif|svg|avif|bmp|ico|heic|tiff?)(?:[\?#][^\s"\'<>\\]*)?)',
        re.IGNORECASE,
    )

    # 匹配 SSR 框架注入的全局 JSON 数据
    SSR_JSON_PATTERNS = [
        re.compile(
            r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            re.DOTALL | re.IGNORECASE,
        ),
        re.compile(
            r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>',
            re.DOTALL | re.IGNORECASE,
        ),
        re.compile(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});", re.DOTALL | re.IGNORECASE),
        re.compile(r"window\.__DATA__\s*=\s*(\{.*?\});", re.DOTALL | re.IGNORECASE),
        re.compile(r"window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});", re.DOTALL | re.IGNORECASE),
    ]

    TRACKING_PATTERNS = [
        r"/pixel\.",
        r"/spacer\.",
        r"/blank\.gif",
        r"/1x1\.",
        r"/dot\.gif",
        r"google-analytics\.com",
        r"facebook\.com/tr",
        r"doubleclick\.net",
        r"baidu\.com/hm\.gif",
        r"hm\.baidu\.com",
    ]

    def __init__(self):
        self._tracking_regex = re.compile("|".join(self.TRACKING_PATTERNS), re.IGNORECASE)

    def sniff_images(
        self,
        url: str,
        user_agent: str,
        timeout_seconds: int = 15,
        referer: str = "",
        use_source_as_referer: bool = True,
    ) -> list[dict]:
        if not url.startswith(("http://", "https://")):
            url = "http://" + url

        logger.info("Sniffing images from {}", url)
        headers = {"User-Agent": user_agent, "Accept": "text/html,*/*"}
        page_referer = url if use_source_as_referer else referer.strip()
        if page_referer.startswith(("http://", "https://")):
            headers["Referer"] = page_referer
        try:
            resp = requests.get(url, headers=headers, timeout=timeout_seconds, allow_redirects=True)
            resp.raise_for_status()
            html = resp.text
            page_url = resp.url or url
        except requests.exceptions.RequestException as e:
            logger.warning("Fetch failed {}: {}", url, e)
            return []

        if use_source_as_referer:
            page_referer = page_url

        found_urls: set[str] = set()

        parser = _ImageExtractor()
        parser.feed(html)
        found_urls.update(parser.urls)
        logger.debug("HTML parser extracted {} image URLs from {}", len(parser.urls), url)

        found_urls.update(self._extract_ssr_images(html))

        found_urls.update(self.IMAGE_REGEX.findall(html))

        results = self._process_results(page_url, found_urls, page_referer)
        logger.info("Sniffed {} images from {}", len(results), page_url)
        return results

    def _extract_ssr_images(self, html: str) -> set[str]:
        """从现代前端框架注入的 JSON 状态中提取图片"""
        urls = set()

        for pattern in self.SSR_JSON_PATTERNS:
            match = pattern.search(html)
            if match:
                raw_json = match.group(1)
                try:
                    # 尝试解析 JSON
                    data = json.loads(raw_json)
                    # 深度遍历 JSON 寻找图片 URL
                    self._deep_walk_json(data, urls)
                except json.JSONDecodeError:
                    # 如果不是标准 JSON (比如被 JS 混淆)，降级使用正则提取
                    urls.update(self.IMAGE_REGEX.findall(raw_json))

        return urls

    def _deep_walk_json(self, obj: any, urls: set[str]) -> None:
        """递归遍历嵌套字典/列表，寻找符合图片特征的字符串"""
        if isinstance(obj, dict):
            for k, v in obj.items():
                # 启发式：如果 key 包含 image, img, pic, avatar, cover, thumbnail, src 等
                if (
                    isinstance(v, str)
                    and any(
                        word in k.lower()
                        for word in [
                            "img",
                            "image",
                            "pic",
                            "avatar",
                            "cover",
                            "thumb",
                            "src",
                            "poster",
                        ]
                    )
                    and self.IMAGE_REGEX.match(v)
                ):
                    urls.add(v)
                self._deep_walk_json(v, urls)
        elif isinstance(obj, list):
            for item in obj:
                self._deep_walk_json(item, urls)
        elif isinstance(obj, str) and self.IMAGE_REGEX.match(obj):
            # 如果字符串本身就是一个完整的图片 URL
            urls.add(obj)

    def _process_results(self, base_url: str, raw_urls: set[str], referer: str = "") -> list[dict]:
        results: list[dict] = []
        seen_urls: set[str] = set()

        for item in sorted(raw_urls):
            if not item:
                continue

            # 清理 JSON 转义符 (如 \/ 替换为 /)
            clean_url = item.replace("\\/", "/")
            absolute_url = clean_url if clean_url.startswith("http") else urljoin(base_url, clean_url)

            if self._tracking_regex.search(absolute_url):
                continue

            normalized_url = self._normalize_url(absolute_url)
            if normalized_url in seen_urls:
                continue
            seen_urls.add(normalized_url)

            filename = urlparse(absolute_url).path.split("/")[-1]
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
                        "page_url": base_url,
                        "referer": referer,
                    },
                }
            )
        return results

    def _normalize_url(self, url: str) -> str:
        try:
            parsed = urlparse(url)
            tracking_params = {
                "utm_source",
                "utm_medium",
                "utm_campaign",
                "fbclid",
                "gclid",
            }
            if parsed.query:
                qs = parse_qs(parsed.query, keep_blank_values=True)
                filtered_qs = {k: v for k, v in qs.items() if k.lower() not in tracking_params}
                new_query = urlencode(filtered_qs, doseq=True)
                parsed = parsed._replace(query=new_query)
            return parsed.geturl()
        except Exception:
            return url
