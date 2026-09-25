from __future__ import annotations

from unittest.mock import Mock, patch

from backend.services.spotlight import SpotlightService


def _fake_response(payload: dict) -> Mock:
    response = Mock()
    response.raise_for_status = Mock()
    response.json.return_value = payload
    return response


def test_request_country_derives_region_from_market() -> None:
    assert SpotlightService._request_country("zh-CN") == "CN"
    assert SpotlightService._request_country("zh-TW") == "TW"
    assert SpotlightService._request_country("en-US") == "US"
    assert SpotlightService._request_country("ja-JP") == "JP"
    assert SpotlightService._request_country("en") == "CN"


def test_list_online_candidates_requests_market_specific_country() -> None:
    service = SpotlightService()

    with patch(
        "backend.services.spotlight.requests.get",
        return_value=_fake_response({"batchrsp": {"items": []}}),
    ) as get:
        assert service.list_online_candidates(limit=7, market="ja-JP", force_refresh=True) == []

    _, kwargs = get.call_args
    assert kwargs["params"]["country"] == "JP"
    assert kwargs["params"]["locale"] == "ja-JP"
    assert kwargs["headers"]["Accept-Language"] == "ja-JP"
