from __future__ import annotations

from unittest.mock import Mock, patch

from backend.services.bing import BingService


def _fake_response(payload: dict) -> Mock:
    response = Mock()
    response.raise_for_status = Mock()
    response.json.return_value = payload
    return response


def test_daily_endpoint_uses_china_mirror_only_for_zh_cn() -> None:
    service = BingService()

    assert service._daily_endpoint("zh-CN") == BingService.cn_endpoint
    assert service._daily_endpoint("en-US") == BingService.endpoint
    assert service._daily_endpoint("ja-JP") == BingService.endpoint


def test_get_daily_wallpaper_requests_market_specific_host() -> None:
    service = BingService()
    image = {"startdate": "20260101", "urlbase": "/th?id=OHR.Test"}
    payload = {"images": [image]}

    with patch("backend.services.bing.requests.get", return_value=_fake_response(payload)) as get:
        assert service._get_daily_wallpaper("en-US") == image
    args, kwargs = get.call_args
    assert args[0] == BingService.endpoint
    assert kwargs["params"]["mkt"] == "en-US"
    assert kwargs["headers"]["Accept-Language"] == "en-US"

    with patch("backend.services.bing.requests.get", return_value=_fake_response(payload)) as get:
        assert service._get_daily_wallpaper("zh-CN") == image
    args, kwargs = get.call_args
    assert args[0] == BingService.cn_endpoint
    assert kwargs["params"]["mkt"] == "zh-CN"
