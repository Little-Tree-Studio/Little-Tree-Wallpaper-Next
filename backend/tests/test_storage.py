from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.services.storage import StorageService


class StorageServiceTests(unittest.TestCase):
    def test_corrupt_manifest_blocks_destructive_reads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service = StorageService.__new__(StorageService)
            service._manifest_path = Path(directory) / "storage_downloads.json"
            service._manifest_path.write_text('{"files":"invalid"}', encoding="utf-8")

            self.assertEqual(service._read_download_manifest(strict=False), {})
            with self.assertRaisesRegex(RuntimeError, "清单损坏"):
                service._read_download_manifest(strict=True)

    def test_managed_download_requires_unchanged_file_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "downloads"
            root.mkdir()
            image = root / "wallpaper.jpg"
            image.write_bytes(b"original")
            service = StorageService.__new__(StorageService)
            service._downloads_dir = lambda: root
            service._manifest_path = Path(directory) / "storage_downloads.json"
            service._write_download_manifest(
                {service._normalized(image): service._file_identity(image)},
                {service._normalized(root)},
            )

            self.assertEqual(service._managed_download_files(strict=True), [service._normalized(image)])
            image.write_bytes(b"changed content")
            self.assertEqual(service._managed_download_files(strict=True), [])

    def test_clear_directory_preserves_protected_part_and_removes_regular_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            removable = root / "remove.bin"
            protected = root / "keep.bin"
            partial = root / "download.part"
            removable.write_bytes(b"remove")
            protected.write_bytes(b"keep")
            partial.write_bytes(b"partial")
            service = StorageService.__new__(StorageService)

            result = service._clear_directory(root, {service._normalized(protected)})

            self.assertEqual(result, {"removed": 1, "skipped": 2, "failed": 0})
            self.assertFalse(removable.exists())
            self.assertTrue(protected.exists())
            self.assertTrue(partial.exists())

    def test_available_destination_numbers_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            requested = Path(directory) / "wallpaper.jpg"
            requested.write_bytes(b"first")
            requested.with_name("wallpaper (2).jpg").write_bytes(b"second")

            self.assertEqual(
                StorageService.available_destination(requested),
                requested.with_name("wallpaper (3).jpg"),
            )


if __name__ == "__main__":
    unittest.main()
