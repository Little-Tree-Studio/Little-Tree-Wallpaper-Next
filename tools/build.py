"""End-to-end build pipeline.

1. Stamp build provenance into build.json (via tools/sync_meta.py).
2. Build the React frontend with npm.
3. Run PyInstaller if available.

Run from the repository root:

    python tools/build.py
    python tools/build.py --build-type stable
    python tools/build.py --no-frontend
    python tools/build.py --no-binary
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
BUILD_SPEC = REPO_ROOT / "build.spec"
PYPROJECT = REPO_ROOT / "backend" / "pyproject.toml"


def log(msg: str) -> None:
    print(f"[build] {msg}", flush=True)


def resolve_executable(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    if platform.system() == "Windows":
        for ext in (".cmd", ".bat", ".exe", ".ps1"):
            candidate = shutil.which(name + ext)
            if candidate:
                return candidate
    return name


def run(cmd: list[str], cwd: Path | None = None) -> None:
    workdir = cwd or REPO_ROOT
    resolved = [resolve_executable(cmd[0]), *cmd[1:]]
    log(f"$ {' '.join(resolved)}")
    try:
        result = subprocess.run(resolved, cwd=workdir)
    except FileNotFoundError as exc:
        log(f"ERROR: command not found: {cmd[0]!r}")
        raise SystemExit(127) from exc
    if result.returncode != 0:
        sys.exit(result.returncode)


def refresh_metadata(args: argparse.Namespace) -> None:
    cmd = [sys.executable, str(REPO_ROOT / "tools" / "sync_meta.py")]
    if args.version:
        cmd += ["--version", args.version]
    if args.build_type:
        cmd += ["--build-type", args.build_type]
    if args.built_by:
        cmd += ["--built-by", args.built_by]
    if args.dry_run:
        cmd += ["--dry-run"]
    run(cmd)


def build_frontend(offline: bool = False) -> None:
    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.is_dir() and not offline:
        run(["npm", "install", "--no-audit", "--no-fund"], cwd=FRONTEND_DIR)
    run(["npm", "run", "build"], cwd=FRONTEND_DIR)


def build_binary() -> None:
    if not BUILD_SPEC.is_file():
        log("ERROR: build.spec not found")
        raise SystemExit(1)
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", str(BUILD_SPEC)])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="build.py",
        description="Stamp build metadata, build the frontend, and run PyInstaller.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python tools/build.py\n"
            "  python tools/build.py --build-type stable\n"
            "  python tools/build.py --no-frontend\n"
            "  python tools/build.py --no-binary\n"
            "  python tools/build.py --dry-run"
        ),
    )
    parser.add_argument("--version", help="set version explicitly")
    parser.add_argument("--build-type", choices=["beta", "stable"], help='set build channel')
    parser.add_argument("--built-by", metavar="WHO", help='set producer')
    parser.add_argument("--no-frontend", action="store_true", help="skip npm build")
    parser.add_argument("--no-binary", action="store_true", help="only stamp metadata")
    parser.add_argument("--offline-frontend", action="store_true", help="skip npm install")
    parser.add_argument("--dry-run", action="store_true", help="preview only")
    args = parser.parse_args(argv)

    log(f"root: {REPO_ROOT}")
    log(f"cwd:  {os.getcwd()}")

    refresh_metadata(args)
    if args.no_binary or args.dry_run:
        log("done (metadata only)")
        return 0

    if not args.no_frontend:
        build_frontend(offline=args.offline_frontend)

    build_binary()
    log("build complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
