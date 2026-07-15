from __future__ import annotations

import unittest
from unittest.mock import Mock

from backend.services.pexels import PexelsService


def _photo() -> dict:
    return {
        "id": 33618815,
        "attributes": {
            "id": 33618815,
            "title": "室内家猫的特写肖像",
            "width": 2252,
            "height": 4000,
            "user": {"id": 1606744, "first_name": "Gogul", "last_name": "S"},
            "tags": [{"name": "猫"}, {"search_term": "宠物"}],
            "image": {
                "medium": (
                    "https://images.pexels.com/photos/33618815/pexels-photo-33618815.jpeg"
                    "?auto=compress&cs=tinysrgb&w=750"
                ),
                "download_link": (
                    "https://images.pexels.com/photos/33618815/pexels-photo-33618815.jpeg"
                    "?cs=srgb&dl=pexels-gogul-s-1606744-33618815.jpg&fm=jpg"
                ),
            },
        },
    }


class PexelsServiceTests(unittest.TestCase):
    def test_original_url_removes_every_transform_parameter(self) -> None:
        value = (
            "https://images.pexels.com/photos/33618815/pexels-photo-33618815.jpeg"
            "?auto=compress&w=600&h=600&fit=crop&fm=webp"
        )

        result = PexelsService._canonical_original_url(value, "33618815")

        self.assertEqual(
            result,
            "https://images.pexels.com/photos/33618815/pexels-photo-33618815.jpeg",
        )

    def test_result_keeps_preview_separate_from_original(self) -> None:
        result = PexelsService._parse_results([_photo()])

        self.assertEqual(len(result), 1)
        item = result[0]
        self.assertEqual(item["id"], "pexels:33618815")
        self.assertEqual(
            item["source_url"],
            "https://images.pexels.com/photos/33618815/pexels-photo-33618815.jpeg",
        )
        self.assertIn("w=750", item["preview_url"])
        self.assertEqual(item["author"], "Gogul S")
        self.assertEqual(item["tags"], ["猫", "宠物"])
        self.assertEqual(item["source_page_url"], "https://www.pexels.com/zh-cn/photo/33618815/")

    def test_search_clamps_page_size_to_web_limit(self) -> None:
        response = Mock()
        response.status_code = 200
        response.json.return_value = {"data": [_photo()]}
        session = Mock()
        session.get.return_value = response

        result = PexelsService(session=session).search("猫", page=2, per_page=100)

        self.assertEqual(len(result), 1)
        _, kwargs = session.get.call_args
        self.assertEqual(kwargs["params"]["page"], 2)
        self.assertEqual(kwargs["params"]["per_page"], 24)
        self.assertEqual(kwargs["headers"]["X-Client-Type"], "react")


if __name__ == "__main__":
    unittest.main()
