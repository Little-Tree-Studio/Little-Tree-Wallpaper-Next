from __future__ import annotations

import unittest
from typing import Any

import requests
from backend.services.sniff import SniffService
from loguru import logger


class _FakeResponse:
    def __init__(
        self,
        *,
        text: str = "",
        url: str = "https://example.com/gallery/index.html",
        content_type: str = "text/html; charset=utf-8",
        status_code: int = 200,
    ) -> None:
        self.text = text
        self.url = url
        self.headers = {"Content-Type": content_type}
        self.status_code = status_code

    def raise_for_status(self) -> None:
        return None


class _FakeSession:
    def __init__(self, response: _FakeResponse) -> None:
        self.response = response
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.calls.append((url, kwargs))
        return self.response


class _FailingSession:
    def __init__(self, error: requests.exceptions.RequestException) -> None:
        self.error = error

    def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        raise self.error


class SniffServiceTests(unittest.TestCase):
    def _capture_logs(self) -> tuple[list[str], int]:
        messages: list[str] = []
        handler_id = logger.add(lambda message: messages.append(message.record["message"]), level="DEBUG")
        return messages, handler_id

    def test_extracts_modern_html_css_and_embedded_state_images(self) -> None:
        html = r"""
            <html>
              <head>
                <base href="https://cdn.example/assets/">
                <meta property="og:image:secure_url" content="/social/cover.jpg">
                <link rel="preload" as="image" href="preload.png"
                      imagesrcset="preload-small.webp 1x, preload-large.webp 2x">
                <style>.hero { background-image: url('../background.avif'); }</style>
                <script type="application/ld+json">
                  {"image": "/api/render?id=42", "thumbnailUrl": "schema-thumb.jpeg"}
                </script>
                <script id="__NEXT_DATA__" type="application/json">
                  {"props": {"pageProps": {"wallpaper": "next-image.webp"}}}
                </script>
                <script>
                  window.__INITIAL_STATE__ = {
                    "cover": "https:\/\/images.example.com\/state.png?size=large",
                    "ignored": "https://example.com/not-an-image.txt"
                  };
                  const fallback = "https:\/\/images.example.com\/inline.jxl";
                </script>
              </head>
              <body background="page-background.bmp">
                <img src="hero.jpg" data-src="/lazy/photo.avif"
                     srcset="hero-small.webp 480w, hero-large.webp 1280w">
                <video poster="//media.example.com/poster.jpg"></video>
                <svg><image href="vector.svg"></image></svg>
                <div style="background: url('inline-style.png')"></div>
              </body>
            </html>
        """
        session = _FakeSession(_FakeResponse(text=html, url="https://example.com/redirected/page.html"))

        results = SniffService(session=session).sniff_images(
            "https://example.com/start",
            user_agent="TestAgent/1.0",
        )

        urls = {item["image_url"] for item in results}
        expected_urls = {
            "https://cdn.example/social/cover.jpg",
            "https://cdn.example/assets/preload.png",
            "https://cdn.example/assets/preload-small.webp",
            "https://cdn.example/assets/preload-large.webp",
            "https://cdn.example/background.avif",
            "https://cdn.example/api/render?id=42",
            "https://cdn.example/assets/schema-thumb.jpeg",
            "https://cdn.example/assets/next-image.webp",
            "https://images.example.com/state.png?size=large",
            "https://images.example.com/inline.jxl",
            "https://cdn.example/assets/page-background.bmp",
            "https://cdn.example/assets/hero.jpg",
            "https://cdn.example/lazy/photo.avif",
            "https://cdn.example/assets/hero-small.webp",
            "https://cdn.example/assets/hero-large.webp",
            "https://media.example.com/poster.jpg",
            "https://cdn.example/assets/vector.svg",
            "https://cdn.example/assets/inline-style.png",
        }
        self.assertEqual(expected_urls - urls, set())
        self.assertTrue(all(item["metadata"]["page_url"] == session.response.url for item in results))
        self.assertTrue(all(item["metadata"]["referer"] == session.response.url for item in results))

        requested_url, request_options = session.calls[0]
        self.assertEqual(requested_url, "https://example.com/start")
        self.assertEqual(request_options["headers"]["Referer"], "https://example.com/start")
        self.assertIn("image/avif", request_options["headers"]["Accept"])
        self.assertTrue(request_options["allow_redirects"])

    def test_direct_image_response_returns_the_final_url(self) -> None:
        response = _FakeResponse(
            url="https://cdn.example.com/render?id=123",
            content_type="image/webp",
        )

        results = SniffService(session=_FakeSession(response)).sniff_images(
            "https://example.com/image",
            user_agent="TestAgent/1.0",
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["image_url"], response.url)
        self.assertEqual(results[0]["metadata"]["page_url"], response.url)

    def test_custom_referer_is_preserved_after_redirect(self) -> None:
        session = _FakeSession(
            _FakeResponse(
                text='<img src="/wallpaper.jpg">',
                url="https://redirected.example.com/page",
            )
        )

        results = SniffService(session=session).sniff_images(
            "https://example.com/start",
            user_agent="TestAgent/1.0",
            referer="https://referer.example/source",
            use_source_as_referer=False,
        )

        self.assertEqual(
            session.calls[0][1]["headers"]["Referer"],
            "https://referer.example/source",
        )
        self.assertEqual(results[0]["metadata"]["referer"], "https://referer.example/source")

    def test_json_response_and_feed_media_are_supported(self) -> None:
        json_session = _FakeSession(
            _FakeResponse(
                text='{"data": {"coverImage": "/render?id=9"}}',
                content_type="application/problem+json",
            )
        )
        json_results = SniffService(session=json_session).sniff_images(
            "https://example.com/api",
            user_agent="TestAgent/1.0",
        )

        self.assertEqual(
            {item["image_url"] for item in json_results},
            {"https://example.com/render?id=9"},
        )

        feed_session = _FakeSession(
            _FakeResponse(
                text="""
                    <media:thumbnail url="/feed/thumb.webp"></media:thumbnail>
                    <enclosure type="image/jpeg" url="/feed/original.jpg"></enclosure>
                    <amp-img src="/amp/render?id=3"></amp-img>
                """,
                content_type="application/xml",
            )
        )
        feed_results = SniffService(session=feed_session).sniff_images(
            "https://example.com/feed.xml",
            user_agent="TestAgent/1.0",
        )

        self.assertEqual(
            {item["image_url"] for item in feed_results},
            {
                "https://example.com/feed/thumb.webp",
                "https://example.com/feed/original.jpg",
                "https://example.com/amp/render?id=3",
            },
        )

    def test_filters_unsafe_and_tracking_urls_and_deduplicates_tracking_parameters(self) -> None:
        service = SniffService(session=_FakeSession(_FakeResponse()))
        results = service._process_results(
            "https://example.com/page/",
            {
                "javascript:alert(1)",
                "data:image/png;base64,abc",
                "https://tracker.example/1x1.gif",
                "https://cdn.example/photo.jpg",
                "https://cdn.example/photo.jpg?utm_source=test",
                "../relative/image.png#section",
            },
        )

        urls = {item["image_url"] for item in results}
        self.assertEqual(
            urls,
            {
                "https://cdn.example/photo.jpg",
                "https://example.com/relative/image.png",
            },
        )

    def test_logs_response_extraction_filtering_and_completion_summary(self) -> None:
        session = _FakeSession(
            _FakeResponse(
                text='<img src="/wallpaper.jpg"><img src="/wallpaper.jpg?utm_source=test">',
                url="https://example.com/final",
            )
        )
        messages, handler_id = self._capture_logs()
        try:
            results = SniffService(session=session).sniff_images(
                "https://example.com/start",
                user_agent="TestAgent/1.0",
            )
        finally:
            logger.remove(handler_id)

        output = "\n".join(messages)
        self.assertEqual(len(results), 1)
        self.assertIn(
            "Sniff started: url=https://example.com/start timeout=15s referer_mode=source",
            output,
        )
        self.assertIn("status=200 content_type=text/html redirected=True", output)
        self.assertIn("Sniff extraction: page=https://example.com/final", output)
        self.assertIn("raw=2 accepted=1 invalid=0 tracking=0 duplicate=1", output)
        self.assertIn("Sniff completed: page=https://example.com/final images=1 elapsed_ms=", output)

    def test_request_failure_returns_empty_results_and_logs_diagnostics(self) -> None:
        messages, handler_id = self._capture_logs()
        try:
            results = SniffService(
                session=_FailingSession(requests.exceptions.Timeout("request timed out"))
            ).sniff_images(
                "example.com/gallery",
                user_agent="TestAgent/1.0",
                timeout_seconds=3,
            )
        finally:
            logger.remove(handler_id)

        output = "\n".join(messages)
        self.assertEqual(results, [])
        self.assertIn("Sniff fetch failed: url=http://example.com/gallery", output)
        self.assertIn("error_type=Timeout", output)
        self.assertIn("error=request timed out", output)
        self.assertIn("elapsed_ms=", output)

    def test_invalid_timeout_returns_empty_results_without_request(self) -> None:
        session = _FakeSession(_FakeResponse())
        messages, handler_id = self._capture_logs()
        try:
            results = SniffService(session=session).sniff_images(
                "https://example.com/gallery",
                user_agent="TestAgent/1.0",
                timeout_seconds="invalid",  # type: ignore[arg-type]
            )
        finally:
            logger.remove(handler_id)

        self.assertEqual(results, [])
        self.assertEqual(session.calls, [])
        self.assertIn("invalid_timeout='invalid'", "\n".join(messages))


if __name__ == "__main__":
    unittest.main()
