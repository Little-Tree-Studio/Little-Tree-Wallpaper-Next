from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import rtoml
import yaml
from backend.services.ltws import LTWSService


class LTWSExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.sources_dir = self.root / "sources"
        self.service = LTWSService(
            sources_dir=self.sources_dir,
            cache_dir=self.root / "cache",
            builtin_examples_dir=self.root / "builtin",
        )
        self.source_dir = self.sources_dir / "example"
        (self.source_dir / "apis").mkdir(parents=True)
        (self.source_dir / "source.toml").write_text(
            rtoml.dumps(
                {
                    "scheme": "littletree_wallpaper_source_v3",
                    "identifier": "com.example.wallpapers",
                    "name": "Example Wallpapers",
                    "version": "1.2.3",
                    "description": "Example source",
                    "categories": "categories.toml",
                    "apis": ["apis/*.toml"],
                    "config": "config.toml",
                }
            ),
            encoding="utf-8",
        )
        (self.source_dir / "categories.toml").write_text(
            rtoml.dumps({"categories": [{"id": "daily", "name": "Daily"}]}),
            encoding="utf-8",
        )
        (self.source_dir / "config.toml").write_text(
            rtoml.dumps(
                {
                    "request": {
                        "timeout_seconds": 15,
                        "headers": {"X-Client": "LittleTree"},
                        "retry": {"max_attempts": 2, "initial_delay_ms": 500},
                    }
                }
            ),
            encoding="utf-8",
        )
        (self.source_dir / "apis" / "daily.toml").write_text(
            rtoml.dumps(
                {
                    "name": "Daily image",
                    "description": "Daily image API description",
                    "categories": ["daily"],
                    "parameters": [
                        {
                            "key": "locale",
                            "label": "Locale",
                            "type": "choice",
                            "default": "en-US",
                            "choices": ["en-US", "zh-CN"],
                        }
                    ],
                    "request": {
                        "url": "https://example.com/wallpapers?locale={{locale}}",
                        "method": "GET",
                    },
                    "response": {"format": "json", "type": "multi"},
                    "mapping": {
                        "items": "/data/items",
                        "image": "/url",
                        "title": "/title",
                    },
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_lwps_v4_1_package_has_manifest_and_round_trips(self) -> None:
        package = self.root / "example.lwps"
        result = self.service.export_source("com.example.wallpapers", str(package), "lwps_v4_1")

        self.assertEqual(result["format"], "lwps_v4_1")
        with zipfile.ZipFile(package) as archive:
            names = archive.namelist()
            self.assertEqual(names.count("source.toml"), 1)
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["format"], "LWPS")
            self.assertEqual(manifest["format_version"], "4.1")
            for item in manifest["files"]:
                self.assertEqual(hashlib.sha256(archive.read(item["path"])).hexdigest(), item["sha256"])

        imported = self.service.import_source(str(package))
        self.assertEqual(imported["identifier"], "com.example.wallpapers")
        self.assertEqual(imported["apis"][0]["name"], "Daily image")

    def test_apicore_v2_1_bundle_contains_one_schema_compatible_file_per_api(self) -> None:
        package = self.root / "example.zip"
        result = self.service.export_source("com.example.wallpapers", str(package), "apicore_v2_1")

        self.assertEqual(result["file_count"], 1)
        with zipfile.ZipFile(package) as archive:
            names = archive.namelist()
            self.assertEqual(len(names), 1)
            self.assertTrue(names[0].endswith(".api.json"))
            document = json.loads(archive.read(names[0]))
        self.assertEqual(document["APICORE_version"], "2.1")
        self.assertEqual(document["friendly_name"], "Daily image")
        self.assertEqual(document["intro"], "Daily image API description")
        self.assertEqual(document["parameters"][0]["options"], ["en-US", "zh-CN"])
        self.assertEqual(document["parameters"][0]["value"], "en-US")
        self.assertEqual(document["link"], "https://example.com/wallpapers?locale={{parameters.locale}}")
        self.assertEqual(document["response"]["media"]["type"], "image")
        self.assertNotIn("body_type", document["configs"]["request"])
        for field in ("friendly_name", "link", "func", "APICORE_version", "parameters", "response"):
            self.assertIn(field, document)

        exported_config = self.root / "daily.api.json"
        exported_config.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        imported = self.service.import_source_as_payload(str(exported_config))
        self.assertEqual(imported["apis"][0]["parameters"][0]["choices"], ["en-US", "zh-CN"])

    def test_apicore_binary_responses_do_not_require_an_image_mapping(self) -> None:
        api_path = self.source_dir / "apis" / "daily.toml"
        api_document = rtoml.load(api_path)
        api_document.pop("mapping", None)
        api_document.pop("parameters", None)

        for response_format in ("binary", "BINARY", "raw", "image_raw"):
            with self.subTest(response_format=response_format):
                api_document["response"] = {"format": response_format, "type": "single"}
                api_path.write_text(rtoml.dumps(api_document), encoding="utf-8")
                package = self.root / f"{response_format.lower()}.zip"
                self.service.export_source("com.example.wallpapers", str(package), "apicore_v2_1")
                with zipfile.ZipFile(package) as archive:
                    document = json.loads(archive.read(archive.namelist()[0]))
                self.assertEqual(document["parameters"], [])
                self.assertEqual(document["response"]["media"]["content_type"], "BINARY")
                self.assertEqual(document["response"]["media"]["path"], "$body")

    def test_apicore_bundle_uses_each_api_metadata(self) -> None:
        second_api = rtoml.load(self.source_dir / "apis" / "daily.toml")
        second_api["name"] = "Featured image"
        second_api["description"] = "Featured image API description"
        second_api["request"]["url"] = "https://example.com/featured?locale={{locale}}"
        (self.source_dir / "apis" / "featured.toml").write_text(rtoml.dumps(second_api), encoding="utf-8")

        package = self.root / "multiple.zip"
        result = self.service.export_source("com.example.wallpapers", str(package), "apicore_v2_1")

        self.assertEqual(result["file_count"], 2)
        with zipfile.ZipFile(package) as archive:
            documents = [json.loads(archive.read(name)) for name in archive.namelist()]
        metadata = {(document["friendly_name"], document["intro"]) for document in documents}
        self.assertEqual(
            metadata,
            {
                ("Daily image", "Daily image API description"),
                ("Featured image", "Featured image API description"),
            },
        )

    def test_openapi_export_uses_3_2_and_preserves_ltws_extensions(self) -> None:
        target = self.root / "openapi.yaml"
        result = self.service.export_source("com.example.wallpapers", str(target), "openapi_3_2")
        document = yaml.safe_load(Path(result["saved_path"]).read_text(encoding="utf-8"))

        self.assertEqual(document["openapi"], "3.2.0")
        self.assertEqual(document["info"]["version"], "1.2.3")
        operation = document["paths"]["/wallpapers"]["get"]
        self.assertEqual(operation["parameters"][0]["name"], "locale")
        self.assertIn("x-ltws-mapping", operation)


if __name__ == "__main__":
    unittest.main()
