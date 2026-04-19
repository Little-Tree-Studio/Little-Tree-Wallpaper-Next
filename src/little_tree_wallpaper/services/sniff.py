from __future__ import annotations

import asyncio
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

import aiohttp


class _ImageExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.urls: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "img" and attributes.get("src"):
            self.urls.add(attributes["src"])
        if tag.lower() == "source":
            srcset = attributes.get("srcset", "")
            for item in srcset.split(","):
                candidate = item.strip().split(" ")[0]
                if candidate:
                    self.urls.add(candidate)
        if tag.lower() == "meta":
            prop = attributes.get("property") or attributes.get("name")
            if prop in {"og:image", "twitter:image", "twitter:image:src"}:
                content = attributes.get("content", "")
                if content:
                    self.urls.add(content)


class SniffService:
    async def _fetch(self, url: str, user_agent: str, timeout_seconds: int) -> str:
        timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        async with aiohttp.ClientSession(timeout=timeout, headers={"User-Agent": user_agent}) as session:
            async with session.get(url) as response:
                response.raise_for_status()
                return await response.text()

    def sniff_images(self, url: str, user_agent: str, timeout_seconds: int = 15) -> list[dict]:
        html = asyncio.run(self._fetch(url=url, user_agent=user_agent, timeout_seconds=timeout_seconds))
        parser = _ImageExtractor()
        parser.feed(html)

        meta_matches = re.findall(r"https?://[^\s\"'>]+(?:png|jpg|jpeg|webp|gif)", html, flags=re.IGNORECASE)
        parser.urls.update(meta_matches)

        results: list[dict] = []
        for index, item in enumerate(sorted(parser.urls)):
            absolute_url = urljoin(url, item)
            results.append(
                {
                    "id": f"sniff:{index}",
                    "source_id": "builtin.sniff",
                    "source_name": "网页嗅探",
                    "title": absolute_url.split("/")[-1] or f"图片 {index + 1}",
                    "image_url": absolute_url,
                    "preview_url": absolute_url,
                    "metadata": {"page_url": url},
                }
            )
        return results
