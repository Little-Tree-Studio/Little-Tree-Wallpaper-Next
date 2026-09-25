from __future__ import annotations

from backend.services.pixivel import PixivelService


def test_pixiv_image_urls_use_selected_proxy() -> None:
    image = "https://i.pximg.net/img-master/img/2024/01/01/00/00/00/123_p0_master1200.jpg"

    for proxy_id, expected_host in (
        ("yuki", "i.yuki.sh"),
        ("azuremio", "pixiv.azuremio.top"),
        ("qiusyan", "pximg.0080417.xyz"),
    ):
        service = PixivelService(image_proxy=proxy_id)
        rewritten = service._rewrite_image_url(image)

        assert rewritten == image.replace("i.pximg.net", expected_host)


def test_pixiv_image_urls_can_switch_between_known_proxy_hosts() -> None:
    image = "https://pixiv.azuremio.top/img-master/img/example.jpg"
    service = PixivelService(image_proxy="qiusyan")

    assert service._rewrite_image_url(image) == image.replace("pixiv.azuremio.top", "pximg.0080417.xyz")
