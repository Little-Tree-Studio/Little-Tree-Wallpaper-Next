from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.services.conflict import detect_conflicting_processes, terminate_conflicting_processes


class FakeNoSuchProcess(Exception):
    """Stand-in for psutil.NoSuchProcess on the patched module."""


class FakeProcess:
    """Process double whose lifetime depends on the simulated close mode.

    ``normal`` dies on terminate(), ``stall`` only dies on kill(), and
    ``unkillable`` survives both.
    """

    def __init__(self, name: str, pid: int, mode: str = "normal") -> None:
        self.info = {"name": name}
        self.pid = pid
        self.mode = mode
        self.dead = False
        self.terminated = False
        self.killed = False

    def terminate(self) -> None:
        self.terminated = True
        if self.mode == "normal":
            self.dead = True

    def kill(self) -> None:
        self.killed = True
        if self.mode != "unkillable":
            self.dead = True

    def wait(self, timeout: float | None = None) -> None:
        if self.dead:
            return None
        raise TimeoutError


def patch_psutil(snapshots: list[list[FakeProcess]]):
    return patch(
        "backend.services.conflict.psutil",
        **{"process_iter.side_effect": snapshots, "NoSuchProcess": FakeNoSuchProcess},
    )


class ConflictDetectionTests(unittest.TestCase):
    def test_detects_only_conflicting_processes(self) -> None:
        processes = [
            FakeProcess("wallpaper64.exe", 101),
            FakeProcess("explorer.exe", 12),
            FakeProcess("WallPaper32.EXE", 102),
        ]
        with patch_psutil([processes]):
            result = detect_conflicting_processes()

        self.assertEqual(result, [
            {"name": "wallpaper64.exe", "pid": 101},
            {"name": "wallpaper32.exe", "pid": 102},
        ])

    def test_detect_returns_empty_list_without_matches(self) -> None:
        with patch_psutil([[FakeProcess("explorer.exe", 12)]]):
            result = detect_conflicting_processes()

        self.assertEqual(result, [])


class ConflictTerminationTests(unittest.TestCase):
    def test_terminates_conflicting_processes_and_reports_remaining(self) -> None:
        wallpaper = FakeProcess("wallpaper64.exe", 101)
        other = FakeProcess("explorer.exe", 12)
        with patch_psutil([[wallpaper, other], []]):
            result = terminate_conflicting_processes()

        self.assertTrue(wallpaper.terminated)
        self.assertFalse(other.terminated)
        self.assertEqual(result["terminated"], [{"name": "wallpaper64.exe", "pid": 101}])
        self.assertEqual(result["failed"], [])
        self.assertEqual(result["remaining"], [])

    def test_escalates_to_kill_when_terminate_stalls(self) -> None:
        wallpaper = FakeProcess("wallpaper32.exe", 202, mode="stall")
        with patch_psutil([[wallpaper], []]):
            result = terminate_conflicting_processes()

        self.assertTrue(wallpaper.terminated)
        self.assertTrue(wallpaper.killed)
        self.assertEqual(result["terminated"], [{"name": "wallpaper32.exe", "pid": 202}])
        self.assertEqual(result["failed"], [])

    def test_reports_failure_when_process_survives_kill(self) -> None:
        wallpaper = FakeProcess("wallpaper64.exe", 303, mode="unkillable")
        with patch_psutil([[wallpaper], [wallpaper]]):
            result = terminate_conflicting_processes()

        self.assertTrue(wallpaper.terminated)
        self.assertTrue(wallpaper.killed)
        self.assertEqual(result["failed"], [{"name": "wallpaper64.exe", "pid": 303}])
        self.assertEqual(result["terminated"], [])
        self.assertEqual(result["remaining"], [{"name": "wallpaper64.exe", "pid": 303}])


if __name__ == "__main__":
    unittest.main()
