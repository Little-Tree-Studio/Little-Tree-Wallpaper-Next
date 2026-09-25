from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.api import BackendAPI


class FrontendLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = BackendAPI.__new__(BackendAPI)

    def test_normalizes_levels(self) -> None:
        with patch("backend.api.logger") as logger:
            self.assertEqual(self.api.log_frontend("warn", "镜像不可用"), {"ok": True})
            self.assertEqual(logger.log.call_args.args[0], "WARNING")

            self.api.log_frontend("error", "下载失败")
            self.assertEqual(logger.log.call_args.args[0], "ERROR")

            self.api.log_frontend("bogus", "下载失败")
            self.assertEqual(logger.log.call_args.args[0], "ERROR")

            self.api.log_frontend(None, "下载失败")  # type: ignore[arg-type]
            self.assertEqual(logger.log.call_args.args[0], "ERROR")

    def test_collapses_whitespace_and_appends_details(self) -> None:
        with patch("backend.api.logger") as logger:
            self.api.log_frontend("error", "  下载   失败  ", "stack line")
            level, template, message, suffix = logger.log.call_args.args
            self.assertEqual(level, "ERROR")
            self.assertEqual(template, "[前端] {}{}")
            self.assertEqual(message, "下载 失败")
            self.assertEqual(suffix, "\nstack line")

    def test_bounds_message_and_details(self) -> None:
        with patch("backend.api.logger") as logger:
            self.api.log_frontend("error", "x" * 5000, "y" * 9000)
            _, _, message, suffix = logger.log.call_args.args
            self.assertEqual(len(message), 1000)
            self.assertEqual(suffix, "\n" + "y" * 4000)

    def test_empty_message_falls_back(self) -> None:
        with patch("backend.api.logger") as logger:
            self.api.log_frontend("error", "   ", None)
            _, _, message, suffix = logger.log.call_args.args
            self.assertEqual(message, "(空消息)")
            self.assertEqual(suffix, "")


if __name__ == "__main__":
    unittest.main()
