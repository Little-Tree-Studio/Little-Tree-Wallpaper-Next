"""Synchronise project metadata.

`build.json` is the single source of truth for version and build provenance.
This script keeps downstream files in sync:

* backend/pyproject.toml  -> project.version
* frontend/package.json   -> version

Common invocations
------------------
    python tools/sync_meta.py
    python tools/sync_meta.py --bump patch
    python tools/sync_meta.py --version 2.1.0
    python tools/sync_meta.py --build-type stable --built-by pyinstaller
    python tools/sync_meta.py --dry-run
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILD_JSON = REPO_ROOT / "build.json"
PYPROJECT = REPO_ROOT / "backend" / "pyproject.toml"
PACKAGE_JSON = REPO_ROOT / "frontend" / "package.json"

_SEMVER = re.compile(
    r"^(?P<major>0|[1-9]\d*)"
    r"\.(?P<minor>0|[1-9]\d*)"
    r"\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?"
    r"(?:\+(?P<build>[0-9A-Za-z.-]+))?$"
)

_DEFAULT_BUILD_TYPE = "beta"


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def bump_version(current: str, kind: str) -> str:
    m = _SEMVER.match(current)
    if not m:
        raise ValueError(f"current version {current!r} is not SemVer")
    major, minor, patch = int(m["major"]), int(m["minor"]), int(m["patch"])
    if kind == "major":
        major, minor, patch = major + 1, 0, 0
    elif kind == "minor":
        minor, patch = minor + 1, 0
    elif kind == "patch":
        patch += 1
    else:
        raise ValueError(f"unknown bump kind: {kind!r}")
    return f"{major}.{minor}.{patch}"


def git_short_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def sync_pyproject(version: str, dry_run: bool) -> str | None:
    text = PYPROJECT.read_text(encoding="utf-8")
    new_text, n = re.subn(
        r'(?m)^version\s*=\s*"[^"]*"',
        f'version = "{version}"',
        text,
        count=1,
    )
    if not n:
        return None
    if not dry_run:
        PYPROJECT.write_text(new_text, encoding="utf-8")
    return f"backend/pyproject.toml: version -> {version}"


def sync_package_json(version: str, dry_run: bool) -> str | None:
    pkg = load_json(PACKAGE_JSON)
    if pkg.get("version") == version:
        return None
    pkg["version"] = version
    if not dry_run:
        save_json(PACKAGE_JSON, pkg)
    return f"frontend/package.json: version -> {version}"


def update_build_json(args: argparse.Namespace) -> dict[str, Any]:
    data = load_json(BUILD_JSON)

    if args.bump:
        data["version"] = bump_version(data["version"], args.bump)
    if args.version:
        data["version"] = args.version
    if args.build_type:
        data["build_type"] = args.build_type
    else:
        data["build_type"] = data.get("build_type") or _DEFAULT_BUILD_TYPE

    data["build_time"] = args.build_time or _dt.datetime.now().astimezone().isoformat(timespec="seconds")
    data["git_commit"] = args.git if args.git is not None else (git_short_sha() or data.get("git_commit", ""))
    data["built_by"] = args.built_by or data.get("built_by", "manual")

    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sync_meta.py",
        description=__doc__.splitlines()[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", help="set version (e.g. 2.1.0)")
    parser.add_argument("--bump", choices=["major", "minor", "patch"], help="bump existing version")
    parser.add_argument("--build-type", choices=["beta", "stable"], help="set build_type")
    parser.add_argument("--build-time", help="set build_time (ISO 8601, default: now)")
    parser.add_argument("--git", help="set git_commit (default: current short HEAD)")
    parser.add_argument("--built-by", help="set built_by (e.g. pyinstaller / manual / ci)")
    parser.add_argument("--dry-run", action="store_true", help="preview only")
    args = parser.parse_args(argv)

    if args.bump and args.version:
        parser.error("--bump and --version are mutually exclusive")

    data = update_build_json(args)
    version = data["version"]

    if not args.dry_run:
        save_json(BUILD_JSON, data)

    diffs: list[str | None] = [
        f"build.json: version={version} build_type={data['build_type']} build_time={data['build_time']} git_commit={data['git_commit']} built_by={data['built_by']}",
        sync_pyproject(version, args.dry_run),
        sync_package_json(version, args.dry_run),
    ]

    for line in diffs:
        if line:
            print(line)
    if args.dry_run:
        print("(dry-run, no files written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
