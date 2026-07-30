from __future__ import annotations

import copy
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

from backend.services.theme import DEFAULT_THEME, DEFAULT_THEME_ID, ThemeService


class ThemeServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "themes"
        self.service = ThemeService(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def custom_theme(self, theme_id: str = "forest") -> dict:
        theme = copy.deepcopy(DEFAULT_THEME)
        theme.update({"id": theme_id, "name": "Forest", "is_builtin": False})
        return theme

    def test_default_theme_is_virtual_and_immutable(self) -> None:
        themes = self.service.list_themes()
        self.assertEqual(themes[0]["id"], DEFAULT_THEME_ID)
        with self.assertRaises(ValueError):
            self.service.save_theme(copy.deepcopy(DEFAULT_THEME))
        with self.assertRaises(ValueError):
            self.service.delete_theme(DEFAULT_THEME_ID)

    def test_crud_and_duplicate_use_distinct_ids(self) -> None:
        saved = self.service.save_theme(self.custom_theme())
        duplicated = self.service.duplicate_theme(saved["id"])

        self.assertEqual(self.service.get_theme("forest")["name"], "Forest")
        self.assertNotEqual(duplicated["id"], saved["id"])
        self.service.delete_theme(saved["id"])
        self.assertFalse(self.service.exists(saved["id"]))

    def test_rejects_invalid_css_tokens_and_missing_paths(self) -> None:
        theme = self.custom_theme()
        theme["colors"]["accent"] = "red; background: black"
        with self.assertRaises(ValueError):
            self.service.save_theme(theme)

        theme = self.custom_theme()
        theme["background"].update({
            "type": "image",
            "source": {"mode": "path", "value": str(self.root / "missing.png")},
        })
        with self.assertRaises(ValueError):
            self.service.save_theme(theme)

    def test_package_round_trip_preserves_bundled_asset(self) -> None:
        theme = self.custom_theme()
        source = Path(self.temporary.name) / "background.png"
        source.write_bytes(b"not-decoded-by-theme-service")
        picked = self.service.pick_asset(theme["id"], "image", "bundled", source)
        theme["background"].update({"type": "image", "source": picked["source"]})
        self.service.save_theme(theme)

        package = Path(self.temporary.name) / "forest.lttheme"
        self.service.export_theme(theme["id"], package)
        imported = self.service.import_theme(package)

        self.assertNotEqual(imported["id"], theme["id"])
        resolved = self.service.resolve_asset(imported["id"], "background")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved[0].read_bytes(), source.read_bytes())

    def test_import_rejects_traversal(self) -> None:
        package = Path(self.temporary.name) / "unsafe.lttheme"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("theme.json", json.dumps(self.custom_theme()))
            archive.writestr("../escape.png", b"unsafe")
        with self.assertRaises(ValueError):
            self.service.import_theme(package)

    def test_system_font_names_are_read_once_and_cached(self) -> None:
        fonts_dir = Path(self.temporary.name) / "fonts"
        fonts_dir.mkdir()
        (fonts_dir / "example.ttf").write_bytes(b"font-placeholder")
        name_table = Mock()
        name_table.getBestFamilyName.return_value = "Example Sans"
        name_table.getBestSubFamilyName.return_value = "Bold"
        name_table.getBestFullName.return_value = "Example Sans Bold"
        font = MagicMock()
        font.__getitem__.return_value = name_table

        with (
            patch.object(self.service, "_system_font_directories", return_value=[fonts_dir]),
            patch("fontTools.ttLib.TTFont", return_value=font) as tt_font,
        ):
            expected = [{"family": "Example Sans", "full_name": "Example Sans Bold", "style": "Bold"}]
            self.assertEqual(self.service.list_system_fonts(), expected)
            self.assertEqual(self.service.list_system_fonts(), expected)

        tt_font.assert_called_once()

    def test_missing_theme_asset_resolves_to_none(self) -> None:
        self.assertIsNone(self.service.resolve_asset("unsaved-theme", "background"))

    def test_video_volume_defaults_to_muted_and_is_validated(self) -> None:
        theme = self.custom_theme()
        theme["background"].pop("video_volume", None)
        self.assertEqual(self.service.save_theme(theme)["background"]["video_volume"], 0)

        theme = self.custom_theme("loud-theme")
        theme["background"]["video_volume"] = 1.1
        with self.assertRaises(ValueError):
            self.service.save_theme(theme)

    def test_installed_font_is_a_distinct_font_source(self) -> None:
        theme = self.custom_theme()
        theme["typography"]["source"] = {"mode": "installed", "value": "Example Sans"}
        saved = self.service.save_theme(theme)
        self.assertEqual(saved["typography"]["source"], {"mode": "installed", "value": "Example Sans"})

        theme["background"].update({
            "type": "image",
            "source": {"mode": "installed", "value": "Example Sans"},
        })
        with self.assertRaises(ValueError):
            self.service.save_theme(theme)


if __name__ == "__main__":
    unittest.main()
