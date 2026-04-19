from __future__ import annotations

from datetime import datetime
import re
from typing import Any
from urllib.parse import urljoin

import requests

from little_tree_wallpaper.models import WallpaperItem


class BingService:
    endpoint = "https://cn.bing.com/HPImageArchive.aspx"
    gallery_endpoint = "https://www.bing.com/hp/api/v1/imagegallery"
    _screen_quality_pattern = re.compile(r"^screen:(\d{2,5})x(\d{2,5})$")
    _quality_aliases = {
        "hd": "highDef",
        "highDef": "highDef",
        "wallpaper": "highDef",
        "original": "ultraHighDef",
        "uhd": "ultraHighDef",
        "ultraHighDef": "ultraHighDef",
    }
    _daily_quality_suffixes = {
        "highDef": "1920x1080.jpg",
        "ultraHighDef": "UHD.jpg",
    }

    def query_daily(
        self,
        market: str = "zh-CN",
        count: int = 8,
        quality: str = "highDef",
    ) -> list[dict[str, Any]]:
        normalized_quality = self._normalize_quality(quality)
        image = self._get_daily_wallpaper(market)
        if not image:
            return []
        return [self._normalize_daily_item(image, normalized_quality)]

    def query_recent(
        self,
        market: str = "zh-CN",
        count: int = 8,
        quality: str = "highDef",
        ssd: str | None = None,
    ) -> list[dict[str, Any]]:
        normalized_quality = self._normalize_quality(quality)
        response = requests.get(
            self.gallery_endpoint,
            params={
                "format": "json",
                "ssd": ssd or datetime.utcnow().strftime("%Y%m%d"),
                "mkt": market,
            },
            timeout=20,
            headers={
                "User-Agent": "LittleTreeWallpaperNext/0.1.0",
                "Accept-Language": market,
            },
        )
        response.raise_for_status()
        payload = response.json()
        gallery = payload.get("data", {})
        items: list[dict[str, Any]] = []
        for image in gallery.get("images", [])[: max(1, min(count, 20))]:
            items.append(self._normalize_recent_item(image, normalized_quality))
        return items

    def _normalize_daily_item(
        self, image: dict[str, Any], quality: str
    ) -> dict[str, Any]:
        output_profile = self._build_output_profile(quality)
        urlbase = image.get("urlbase", "")
        quality_urls = self._build_daily_quality_urls(urlbase, image.get("url", ""))
        source_quality = "ultraHighDef" if output_profile else quality
        image_url = self._pick_quality_url(quality_urls, source_quality)
        preview_url = (
            self._absolute_url(f"{urlbase}_320x180.jpg") if urlbase else self._pick_quality_url(quality_urls, "highDef")
        )
        title = image.get("title") or image.get("copyright") or "Bing 每日壁纸"
        return WallpaperItem(
            id=f"bing:{image.get('startdate', '')}:{image.get('hsh', '')}",
            source_id="builtin.bing_daily",
            source_name="Bing 每日壁纸",
            title=title,
            image_url=image_url,
            preview_url=preview_url,
            width=output_profile["width"] if output_profile else (3840 if quality == "ultraHighDef" else 1920),
            height=output_profile["height"] if output_profile else (2160 if quality == "ultraHighDef" else 1080),
            description=image.get("copyright", ""),
            metadata={
                **image,
                "quality": quality,
                "available_qualities": quality_urls,
                "click_url": self._absolute_url(image.get("copyrightlink", "")),
                **({"output_profile": output_profile} if output_profile else {}),
            },
        ).to_dict()

    def _get_daily_wallpaper(self, market: str) -> dict[str, Any] | None:
        response = requests.get(
            self.endpoint,
            params={
                "format": "js",
                "idx": 0,
                "n": 1,
                "mkt": market,
            },
            timeout=20,
            headers={
                "User-Agent": "LittleTreeWallpaperNext/0.1.0",
                "Accept-Language": market,
            },
        )
        response.raise_for_status()
        payload = response.json()
        images = payload.get("images", [])
        if not images:
            return None
        return images[0]

    def _normalize_recent_item(
        self, image: dict[str, Any], quality: str
    ) -> dict[str, Any]:
        output_profile = self._build_output_profile(quality)
        landscape = image.get("imageUrls", {}).get("landscape", {}) or {}
        quality_urls = {
            "highDef": self._absolute_url(landscape.get("highDef", "")),
            "ultraHighDef": self._absolute_url(landscape.get("ultraHighDef", "")),
        }
        source_quality = "ultraHighDef" if output_profile else quality
        image_url = self._pick_quality_url(quality_urls, source_quality)
        preview_url = quality_urls.get("highDef") or image_url
        title = image.get("title") or image.get("caption") or "Bing 近期图片"
        return WallpaperItem(
            id=f"bing:recent:{image.get('isoDate', '')}:{title}",
            source_id="builtin.bing_recent",
            source_name="Bing 近期壁纸",
            title=title,
            image_url=image_url,
            preview_url=preview_url,
            width=output_profile["width"] if output_profile else (3840 if quality == "ultraHighDef" else 1920),
            height=output_profile["height"] if output_profile else (2160 if quality == "ultraHighDef" else 1080),
            description=image.get("description") or image.get("copyright", ""),
            metadata={
                **image,
                "quality": quality,
                "available_qualities": quality_urls,
                "click_url": self._absolute_url(image.get("clickUrl", "")),
                **({"output_profile": output_profile} if output_profile else {}),
            },
        ).to_dict()

    def _build_daily_quality_urls(
        self, urlbase: str, fallback_url: str
    ) -> dict[str, str]:
        quality_urls = {
            quality: self._absolute_url(f"{urlbase}_{suffix}") if urlbase else ""
            for quality, suffix in self._daily_quality_suffixes.items()
        }
        if fallback_url:
            quality_urls["highDef"] = self._absolute_url(fallback_url)
        return quality_urls

    def _normalize_quality(self, quality: str) -> str:
        screen_quality = self._parse_screen_quality(quality)
        if screen_quality is not None:
            return f"screen:{screen_quality['width']}x{screen_quality['height']}"
        return self._quality_aliases.get(quality, "highDef")

    def _pick_quality_url(self, quality_urls: dict[str, str], quality: str) -> str:
        for key in (quality, "ultraHighDef", "highDef"):
            candidate = quality_urls.get(key)
            if candidate:
                return candidate
        return ""

    def _parse_screen_quality(self, quality: str) -> dict[str, int] | None:
        match = self._screen_quality_pattern.fullmatch(quality)
        if not match:
            return None
        width = int(match.group(1))
        height = int(match.group(2))
        if width <= 0 or height <= 0:
            return None
        return {"width": width, "height": height}

    def _build_output_profile(self, quality: str) -> dict[str, int | str] | None:
        screen_quality = self._parse_screen_quality(quality)
        if screen_quality is None:
            return None
        return {
            "mode": "cover_center_crop",
            "width": screen_quality["width"],
            "height": screen_quality["height"],
        }

    def _absolute_url(self, url: str) -> str:
        if not url:
            return ""
        return urljoin("https://www.bing.com", url)
