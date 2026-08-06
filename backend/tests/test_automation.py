from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Any

from backend.api import BackendAPI
from backend.services.automation import AutomationService


class AutomationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.wallpapers: list[str] = []
        self.events: list[str] = []
        self.notifications: list[tuple[str, str]] = []
        self.resource_configs: list[dict[str, Any]] = []
        self.resource_contexts: list[dict[str, Any]] = []
        self.dynamic_configs: list[dict[str, Any]] = []
        self.service = AutomationService(
            Path(self.directory.name) / "automations.json",
            lambda path: self._set_wallpaper(path),
            self._fetch_resource,
            lambda _node_type, pointer, value, _config: (
                ["random", "first", "index"][int(value) - 1]
                if pointer == "/selection" and isinstance(value, int)
                else value
            ),
            lambda *_args: {},
            lambda _action: {},
            lambda: {},
            data_root=Path(self.directory.name) / "automation_data",
            notify=lambda title, message: self.notifications.append((title, message)),
            manage_dynamic_wallpaper=self._manage_dynamic_wallpaper,
        )

    def tearDown(self) -> None:
        self.service.shutdown()
        self.directory.cleanup()

    def _set_wallpaper(self, path: str) -> dict[str, Any]:
        self.wallpapers.append(path)
        return {"success": True}

    def _fetch_resource(self, config: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        self.resource_configs.append(config)
        self.resource_contexts.append(context)
        return {"success": True, "path": "resource.jpg", "item": {"title": "resource"}}

    def _manage_dynamic_wallpaper(self, config: dict[str, Any]) -> dict[str, Any]:
        self.dynamic_configs.append(config)
        return {"type": "slideshow", "status": {"running": True}}

    @staticmethod
    def document() -> dict[str, Any]:
        return {
            "id": "test",
            "name": "测试",
            "enabled": False,
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "value", "type": "set_variable", "config": {"name": "hour", "value": 20}},
                {
                    "id": "condition",
                    "type": "condition",
                    "config": {
                        "expression": {
                            "type": "all",
                            "values": [
                                {"type": "compare", "operator": "gte", "left": {"type": "variable", "name": "hour"}, "right": 18},
                                {"type": "not", "value": False},
                            ],
                        }
                    },
                },
                {"id": "resource", "type": "fetch_resource", "config": {"source": "bing"}},
                {"id": "wallpaper", "type": "set_wallpaper", "config": {}},
                {"id": "stop", "type": "stop", "config": {}},
            ],
            "edges": [
                {"source": "start", "target": "value"},
                {"source": "value", "target": "condition"},
                {"source": "condition", "source_port": "true", "target": "resource"},
                {"source": "resource", "target": "wallpaper"},
                {"source": "condition", "source_port": "false", "target": "stop"},
            ],
        }

    def test_save_and_execute_condition_branch(self) -> None:
        self.service.save(self.document())
        self.service.run("test")
        deadline = time.monotonic() + 2
        while self.service.snapshot()["run"]["running"] and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.wallpapers, ["resource.jpg"])
        self.assertEqual(self.service.snapshot()["run"]["status"], "completed")
        self.assertEqual(self.resource_contexts[-1]["automation_id"], "test")
        self.assertEqual(self.resource_contexts[-1]["node_id"], "resource")

    def test_manual_run_uses_the_only_scheduled_trigger(self) -> None:
        document = self.document()
        document["nodes"][0]["config"] = {"kind": "schedule", "time": "08:00"}
        snapshot = self._run_document(document)
        self.assertEqual(snapshot["run"]["status"], "completed")
        self.assertEqual(self.wallpapers, ["resource.jpg"])

    def test_multiple_startup_automations_are_queued(self) -> None:
        for index, automation_type in enumerate(("simple", "blocks", "advanced")):
            document = self.document()
            document["id"] = f"startup-{index}"
            document["name"] = automation_type
            document["automation_type"] = automation_type
            document["enabled"] = True
            document["nodes"][0]["config"] = {"kind": "startup"}
            self.service.save(document)

        self.service.start()
        deadline = time.monotonic() + 3
        while len(self.wallpapers) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)

        self.assertEqual(self.wallpapers, ["resource.jpg"] * 3)
        self.assertEqual(self.service.snapshot()["queued_count"], 0)

    def test_automation_type_defaults_to_advanced_and_is_summarized(self) -> None:
        saved = self.service.save(self.document())
        self.assertEqual(saved["automation_type"], "advanced")
        self.assertEqual(self.service.list()[0]["automation_type"], "advanced")

    def test_rejects_unknown_node_type(self) -> None:
        document = self.document()
        document["nodes"][0]["type"] = "shell"
        result = self.service.validate(document)
        self.assertFalse(result["valid"])

    def test_requires_exactly_one_trigger(self) -> None:
        without_trigger = self.document()
        without_trigger["nodes"] = [node for node in without_trigger["nodes"] if node["type"] != "trigger"]
        self.assertFalse(self.service.validate(without_trigger)["valid"])

        with_two_triggers = self.document()
        with_two_triggers["nodes"].append(
            {"id": "second-trigger", "type": "trigger", "config": {"kind": "interval", "seconds": 60}}
        )
        self.assertFalse(self.service.validate(with_two_triggers)["valid"])

    def test_rejects_connections_into_trigger(self) -> None:
        document = self.document()
        document["edges"].append({"source": "resource", "target": "start"})
        result = self.service.validate(document)
        self.assertFalse(result["valid"])
        self.assertIn("触发器是执行起点，不能连接上游输入", result["errors"])

    def test_one_output_fans_out_to_multiple_nodes(self) -> None:
        document = self.document()
        document["nodes"].extend([
            {"id": "log-a", "type": "log", "config": {"message": "A"}},
            {"id": "log-b", "type": "log", "config": {"message": "B"}},
        ])
        document["edges"] = [
            {"source": "start", "target": "resource"},
            {"source": "resource", "target": "log-a"},
            {"source": "resource", "target": "log-b"},
        ]
        self.service.save(document)
        self.service.run("test")
        deadline = time.monotonic() + 2
        while self.service.snapshot()["run"]["running"] and time.monotonic() < deadline:
            time.sleep(0.01)
        messages = [event["message"] for event in self.service.snapshot()["events"]]
        self.assertTrue(any(message == "A" for message in messages))
        self.assertTrue(any(message == "B" for message in messages))

    def test_connected_setting_overrides_wallpaper_fallback(self) -> None:
        document = {
            "id": "override",
            "name": "覆盖",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "selection", "type": "set_variable", "config": {"name": "selection", "value": 2}},
                {"id": "resource", "type": "fetch_resource", "config": {"source": "bing", "selection": "random"}},
                {"id": "wallpaper", "type": "set_wallpaper", "config": {"path": "fallback.jpg"}},
            ],
            "edges": [
                {"source": "start", "target": "selection"},
                {"source": "selection", "target": "resource", "target_port": "/selection"},
                {"source": "resource", "target": "wallpaper", "target_port": "/path"},
            ],
        }
        # Numeric 2 reaches the select setting and becomes its second option, "first".
        self.service.save(document)
        self.service.run("override")
        deadline = time.monotonic() + 2
        while self.service.snapshot()["run"]["running"] and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.wallpapers, ["resource.jpg"])
        self.assertEqual(self.resource_configs[-1]["selection"], "first")

    def test_wallpaper_uses_configured_fallback_without_input(self) -> None:
        document = {
            "id": "fallback",
            "name": "回退",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "wallpaper", "type": "set_wallpaper", "config": {"path": "fallback.jpg"}},
            ],
            "edges": [{"source": "start", "target": "wallpaper", "target_port": "/unused"}],
        }
        self.service.save(document)
        self.service.run("fallback")
        deadline = time.monotonic() + 2
        while self.service.snapshot()["run"]["running"] and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.wallpapers, ["fallback.jpg"])

    def test_dynamic_wallpaper_type_is_saved_to_variable(self) -> None:
        document = {
            "id": "dynamic-type",
            "name": "动态类型",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "dynamic", "type": "dynamic_wallpaper", "config": {"action": "get_type", "result_variable": "kind"}},
            ],
            "edges": [{"source": "start", "target": "dynamic"}],
        }
        snapshot = self._run_document(document)
        self.assertEqual(snapshot["run"]["variables"]["kind"], "slideshow")
        self.assertEqual(self.dynamic_configs[0]["action"], "get_type")

    def _run_document(self, document: dict[str, Any]) -> dict[str, Any]:
        self.service.save(document)
        self.service.run(str(document["id"]))
        deadline = time.monotonic() + 3
        while self.service.snapshot()["run"]["running"] and time.monotonic() < deadline:
            time.sleep(0.01)
        return self.service.snapshot()

    def test_match_selects_dynamic_port_without_default_fallback(self) -> None:
        document = {
            "id": "match",
            "name": "多分支",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "match", "type": "match", "config": {"value": "image", "cases": {"image": {"operator": "eq", "value": "image"}}}},
                {"id": "hit", "type": "log", "config": {"message": "hit"}},
                {"id": "default", "type": "log", "config": {"message": "default"}},
            ],
            "edges": [
                {"source": "start", "target": "match"},
                {"source": "match", "source_port": "case:image", "target": "hit"},
                {"source": "match", "source_port": "default", "target": "default"},
            ],
        }
        snapshot = self._run_document(document)
        messages = [event["message"] for event in snapshot["events"]]
        self.assertIn("hit", messages)
        self.assertNotIn("default", messages)

    def test_loop_count_and_calculation(self) -> None:
        document = {
            "id": "loop",
            "name": "循环计算",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "loop", "type": "loop", "config": {"mode": "count", "count": 3, "item_variable": "item", "index_variable": "index"}},
                {"id": "calculate", "type": "calculate", "config": {"operation": "add", "left": 2, "right": 3, "result_variable": "sum"}},
                {"id": "done", "type": "notification", "config": {"title": "done", "message": "finished"}},
            ],
            "edges": [
                {"source": "start", "target": "loop"},
                {"source": "loop", "source_port": "body", "target": "calculate"},
                {"source": "calculate", "target": "loop"},
                {"source": "loop", "source_port": "done", "target": "done"},
            ],
        }
        snapshot = self._run_document(document)
        self.assertEqual(snapshot["run"]["status"], "completed")
        self.assertEqual(snapshot["run"]["variables"]["sum"], 5)
        self.assertEqual(snapshot["run"]["variables"]["index"], 2)
        self.assertEqual(self.notifications, [("done", "finished")])

    def test_text_file_directory_and_datetime_nodes(self) -> None:
        document = {
            "id": "files",
            "name": "文件",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "write", "type": "write_file", "config": {"path": "notes/test.txt", "content": "hello", "action": "write"}},
                {"id": "read", "type": "read_file", "config": {"path": "notes/test.txt", "result_variable": "content"}},
                {"id": "list", "type": "list_directory", "config": {"path": "notes", "pattern": "*.txt", "result_variable": "entries"}},
                {"id": "date", "type": "datetime", "config": {"format": "%Y", "result_variable": "year"}},
            ],
            "edges": [
                {"source": "start", "target": "write"},
                {"source": "write", "target": "read"},
                {"source": "read", "target": "list"},
                {"source": "list", "target": "date"},
            ],
        }
        snapshot = self._run_document(document)
        self.assertEqual(snapshot["run"]["status"], "completed")
        self.assertEqual(snapshot["run"]["variables"]["content"], "hello")
        self.assertEqual(snapshot["run"]["variables"]["entries"][0]["relative_path"], "test.txt")
        self.assertEqual(len(snapshot["run"]["variables"]["year"]), 4)

    def test_command_uses_argument_list(self) -> None:
        document = {
            "id": "command",
            "name": "命令",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "command", "type": "command", "config": {"executable": __import__("sys").executable, "arguments": ["-c", "print('ok')"], "result_variable": "command"}},
            ],
            "edges": [{"source": "start", "target": "command"}],
        }
        snapshot = self._run_document(document)
        self.assertEqual(snapshot["run"]["status"], "completed")
        self.assertEqual(snapshot["run"]["variables"]["command"]["stdout"].strip(), "ok")

    def test_condition_compares_number_with_numeric_text(self) -> None:
        document = {
            "id": "numeric-comparison",
            "name": "数值比较",
            "nodes": [
                {"id": "start", "type": "trigger", "config": {"kind": "manual"}},
                {"id": "calculate", "type": "calculate", "config": {"operation": "add", "left": 1, "right": 1, "result_variable": "result"}},
                {"id": "condition", "type": "condition", "config": {"expression": {"type": "compare", "operator": "eq", "left": {"type": "literal", "value": "fallback"}, "right": {"type": "literal", "value": "2"}}}},
                {"id": "true", "type": "log", "config": {"message": "true"}},
                {"id": "false", "type": "log", "config": {"message": "false"}},
            ],
            "edges": [
                {"source": "start", "target": "calculate"},
                {"source": "calculate", "target": "condition"},
                {"source": "condition", "source_port": "true", "target": "true"},
                {"source": "condition", "source_port": "false", "target": "false"},
            ],
        }
        snapshot = self._run_document(document)
        messages = [event["message"] for event in snapshot["events"]]
        self.assertEqual(snapshot["run"]["status"], "completed")
        self.assertIn("true", messages)
        self.assertNotIn("false", messages)

    def test_rotation_queue_persists_and_accepts_new_items(self) -> None:
        api = BackendAPI.__new__(BackendAPI)
        api._automation_rotation_lock = threading.RLock()
        context = {
            "automation_id": "rotation-test",
            "node_id": "resource",
            "data_directory": self.directory.name,
        }
        config = {"source": "favorites", "scope": "folder", "folder_id": "default", "order": "sequential"}
        initial = [{"rotation_id": "a"}, {"rotation_id": "b"}]
        first = api._select_automation_rotation_item(initial, config, context)
        second = api._select_automation_rotation_item(initial, config, context)
        with_addition = [{"rotation_id": "a"}, {"rotation_id": "b"}, {"rotation_id": "c"}]
        third = api._select_automation_rotation_item(with_addition, config, context)
        self.assertEqual([first["rotation_id"], second["rotation_id"], third["rotation_id"]], ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
