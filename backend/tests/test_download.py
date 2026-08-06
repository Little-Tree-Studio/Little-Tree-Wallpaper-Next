from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services.download import (
    DownloadError,
    sanitize_filename,
    stream_to_file_atomic,
    write_blob_atomic,
)
from PIL import Image


def _png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 1), color=(20, 80, 140)).save(output, format="PNG")
    return output.getvalue()


class DownloadHelpersTests(unittest.TestCase):
    def test_sanitize_filename_handles_traversal_invalid_characters_and_devices(self) -> None:
        cases = {
            "": "download",
            "../../wallpaper.jpg": "wallpaper.jpg",
            r"..\folder\bad:name?.png": "bad_name_.png",
            " . ": "download",
            "CON": "_CON",
            "lpt9.txt": "_lpt9.txt",
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(sanitize_filename(value), expected)

    def test_stream_adds_image_extension_and_writes_valid_image(self) -> None:
        data = _png_bytes()
        with tempfile.TemporaryDirectory() as directory:
            result = stream_to_file_atomic(
                Path(directory) / "wallpaper",
                io.BytesIO(data),
                expected_size=len(data),
                content_type="image/png; charset=binary",
            )

            self.assertEqual(result.path.name, "wallpaper.png")
            self.assertEqual(result.size, len(data))
            self.assertEqual(result.path.read_bytes(), data)
            self.assertFalse(result.path.with_name("wallpaper.png.part").exists())

    def test_incomplete_stream_preserves_existing_destination_and_removes_part(self) -> None:
        data = _png_bytes()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "wallpaper.png"
            destination.write_bytes(b"existing")

            with self.assertRaises(DownloadError) as raised:
                stream_to_file_atomic(destination, io.BytesIO(data), expected_size=len(data) + 1)

            self.assertEqual(raised.exception.code, "incomplete_download")
            self.assertEqual(destination.read_bytes(), b"existing")
            self.assertFalse(destination.with_name("wallpaper.png.part").exists())

    def test_invalid_image_is_rejected_without_leaving_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "wallpaper.png"

            with self.assertRaises(DownloadError) as raised:
                stream_to_file_atomic(destination, io.BytesIO(b"not an image"))

            self.assertEqual(raised.exception.code, "invalid_image")
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_name("wallpaper.png.part").exists())

    def test_atomic_blob_write_cleans_up_when_replace_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "wallpaper.bin"
            destination.write_bytes(b"existing")

            with (
                patch("backend.services.download.os.replace", side_effect=PermissionError("locked")),
                self.assertRaises(PermissionError),
            ):
                write_blob_atomic(destination, b"replacement")

            self.assertEqual(destination.read_bytes(), b"existing")
            self.assertFalse(destination.with_name("wallpaper.bin.part").exists())


if __name__ == "__main__":
    unittest.main()
