from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.api import BackendAPI


class FavoriteFolderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = object.__new__(BackendAPI)
        self.data = {
            "folders": [
                {"id": "default", "name": "默认收藏夹", "description": "", "order": 0},
            ],
            "items": [],
        }
        self.api._load_favorites = MagicMock(return_value=self.data)
        self.api._save_favorites = MagicMock()

    def test_create_folder_accepts_null_description(self) -> None:
        folder = BackendAPI.create_favorite_folder.__wrapped__(self.api, " 轮播 ", None)

        self.assertEqual(folder["name"], "轮播")
        self.assertEqual(folder["description"], "")
        self.api._save_favorites.assert_called_once_with(self.data)

    def test_update_folder_accepts_null_description(self) -> None:
        self.data["folders"].append(
            {"id": "slideshow", "name": "旧名称", "description": "旧描述", "order": 1}
        )

        folder = BackendAPI.update_favorite_folder.__wrapped__(
            self.api, "slideshow", " 轮播 ", None
        )

        self.assertEqual(folder["name"], "轮播")
        self.assertEqual(folder["description"], "")
        self.api._save_favorites.assert_called_once_with(self.data)


if __name__ == "__main__":
    unittest.main()
