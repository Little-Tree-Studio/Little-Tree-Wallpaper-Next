from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from PIL import Image

from backend.models import WallpaperItem
from backend.services.cache import ResponseCache


class SpotlightService:
    online_endpoint = "https://fd.api.iris.microsoft.com/v4/api/selection"

    # Local Assets folder scan is expensive (PIL opens every file) but the
    # folder changes only when Windows pushes new spotlight images, so keep a
    # short TTL. Online payload rotates a few times per day so a longer TTL
    # is safe.
    _cache = ResponseCache("spotlight", default_ttl=600.0)
    _local_ttl = 600.0
    _online_ttl = 21600.0

    def list_candidates(self, limit: int = 20, force_refresh: bool = False) -> list[dict]:
        return self.list_local_candidates(limit=limit, force_refresh=force_refresh)

    def list_local_candidates(
        self, limit: int = 20, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        cache_key = f"local:{limit}"
        if not force_refresh:
            cached = self._cache.get(cache_key, ttl=self._local_ttl)
            if cached is not None:
                return cached

        items = self._scan_local_assets(limit=limit)
        if items or force_refresh:
            self._cache.set(cache_key, items)
        else:
            stale = self._cache.get_stale(cache_key)
            if stale is not None:
                return stale
        return items

    def _scan_local_assets(self, limit: int) -> list[dict[str, Any]]:
        if os.name != "nt":
            return []

        assets_path = Path.home() / "AppData/Local/Packages/Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy/LocalState/Assets"
        if not assets_path.exists():
            return []

        items: list[dict] = []
        for asset in sorted(assets_path.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
            if not asset.is_file() or asset.stat().st_size < 150_000:
                continue
            try:
                with Image.open(asset) as image:
                    width, height = image.size
                if width < 1000 or height < 1000:
                    continue
            except Exception:
                continue

            identifier = hashlib.sha1(str(asset).encode("utf-8")).hexdigest()
            items.append(
                WallpaperItem(
                    id=f"spotlight:{identifier}",
                    source_id="builtin.windows_spotlight",
                    source_name="Windows Spotlight",
                    title=asset.name,
                    image_url=str(asset),
                    preview_url=str(asset),
                    width=width,
                    height=height,
                    metadata={"local_file": True},
                ).to_dict()
            )
            if len(items) >= limit:
                break

        return items

    def list_online_candidates(
        self, limit: int = 20, market: str = "zh-CN", force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        cache_key = f"online:{limit}:{market}"
        if not force_refresh:
            cached = self._cache.get(cache_key, ttl=self._online_ttl)
            if cached is not None:
                return cached

        try:
            response = requests.get(
                self.online_endpoint,
                params={
                    "placement": "88000820",
                    "bcnt": 4,
                    "country": "CN",
                    "locale": market,
                    "fmt": "json",
                },
                timeout=20,
                headers={
                    "User-Agent": "LittleTreeWallpaperNext/0.1.0",
                    "Accept-Language": market,
                },
            )
            response.raise_for_status()
            payload = response.json().get("batchrsp", {})
        except Exception:
            stale = self._cache.get_stale(cache_key)
            if stale is not None:
                return stale
            raise

        items: list[dict[str, Any]] = []
        for entry in payload.get("items", []):
            raw_item = entry.get("item", "")
            if not raw_item:
                continue
            try:
                ad = json.loads(raw_item).get("ad", {})
            except json.JSONDecodeError:
                continue
            landscape = ad.get("landscapeImage", {}) or {}
            image_url = self._absolute_url(landscape.get("asset", ""))
            if not image_url:
                continue
            title = ad.get("title") or ad.get("description") or ad.get("copyright") or "Windows Spotlight 在线壁纸"
            items.append(
                WallpaperItem(
                    id=f"spotlight:online:{hashlib.sha1(image_url.encode('utf-8')).hexdigest()}",
                    source_id="builtin.windows_spotlight_online",
                    source_name="Windows Spotlight 在线",
                    title=title,
                    image_url=image_url,
                    preview_url=image_url,
                    width=1920,
                    height=1080,
                    description=ad.get("description", ""),
                    metadata={
                        "copyright": ad.get("copyright", ""),
                        "click_url": ad.get("ctaUri", "").replace("microsoft-edge:", ""),
                        "local_file": False,
                        "payload": ad,
                    },
                ).to_dict()
            )
            if len(items) >= limit:
                break
        self._cache.set(cache_key, items)
        return items

    def _absolute_url(self, url: str) -> str:
        if not url:
            return ""
        return urljoin(self.online_endpoint, url)
