"""End-to-end build pipeline.

1. Stamp build provenance into build.json (via tools/sync_meta.py).
2. Build the React frontend with npm.
3. Run PyInstaller (onefile or onedir, see --mode).
4. In installer mode, render NSIS branding assets and compile
   installer/setup.nsi with makensis.

Run from the repository root:

    python tools/build.py
    python tools/build.py --build-type stable
    python tools/build.py --mode folder
    python tools/build.py --mode installer
    python tools/build.py --no-frontend
    python tools/build.py --no-binary
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
BUILD_SPEC = REPO_ROOT / "build.spec"
BUILD_JSON = REPO_ROOT / "build.json"
NSI_SCRIPT = REPO_ROOT / "installer" / "setup.nsi"
LICENSE_FILE = REPO_ROOT / "LICENSES"
DIST_DIR = REPO_ROOT / "dist"

LOGO_PNG = FRONTEND_DIR / "public" / "logo.png"
LOGO_ICO = FRONTEND_DIR / "public" / "logo.ico"

ONEDIR_NAME = "LittleTreeWallpaper" if platform.system() == "Windows" else "小树壁纸 Next"

BUILD_MODES = ("onefile", "folder", "installer")


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


def run(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    workdir = cwd or REPO_ROOT
    resolved = [resolve_executable(cmd[0]), *cmd[1:]]
    log(f"$ {' '.join(resolved)}")
    try:
        result = subprocess.run(resolved, cwd=workdir, env=env, check=False)
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


def build_binary(mode: str) -> None:
    if not BUILD_SPEC.is_file():
        log("ERROR: build.spec not found")
        raise SystemExit(1)
    env = os.environ.copy()
    if mode != "onefile":
        env["LTW_BUILD_MODE"] = "onedir"
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", str(BUILD_SPEC)], env=env)


def _linear_gradient(size: tuple[int, int], start: tuple[int, int, int], end: tuple[int, int, int], *, vertical: bool):
    from PIL import Image, ImageDraw

    w, h = size
    img = Image.new("RGB", size)
    draw = ImageDraw.Draw(img)
    steps = (h if vertical else w) - 1
    for i in range(steps + 1):
        t = i / steps
        color = tuple(round(a + (b - a) * t) for a, b in zip(start, end))
        if vertical:
            draw.line([(0, i), (w, i)], fill=color)
        else:
            draw.line([(i, 0), (i, h)], fill=color)
    return img


def _scaled_logo(max_size: int):
    from PIL import Image

    logo = Image.open(LOGO_PNG).convert("RGBA")
    logo.thumbnail((max_size, max_size), Image.LANCZOS)
    return logo


def generate_installer_assets(assets_dir: Path) -> None:
    """Render the NSIS branding bitmaps (welcome / header) and copy the icon.

    Bitmaps are rendered at 2x the classic dialog size. The installer is
    DPI-aware, so MUI stretches them to the physical control size: crisp at
    up to 200% scaling and cleanly downscaled at 100%.
    """
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except ImportError as exc:
        log("ERROR: Pillow is required to generate installer assets")
        raise SystemExit(1) from exc
    if not LOGO_PNG.is_file() or not LOGO_ICO.is_file():
        log(f"ERROR: logo assets missing under {LOGO_PNG.parent}")
        raise SystemExit(1)

    assets_dir.mkdir(parents=True, exist_ok=True)

    # Welcome / finish page side banner: 328x628 (2x 164x314), deep-green
    # vertical gradient, soft glow behind a centered logo.
    welcome_size = (328, 628)
    banner = _linear_gradient(welcome_size, (16, 54, 30), (46, 125, 50), vertical=True)
    logo = _scaled_logo(192)
    cx, cy = welcome_size[0] // 2, 236
    glow = Image.new("L", welcome_size, 0)
    ImageDraw.Draw(glow).ellipse((cx - 140, cy - 140, cx + 140, cy + 140), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(56))
    banner = Image.composite(Image.new("RGB", welcome_size, (255, 255, 255)), banner, glow)
    banner.paste(logo, (cx - logo.width // 2, cy - logo.height // 2), logo)
    banner.save(assets_dir / "welcome.bmp")

    # Header strip: 300x114 (2x 150x57), white-to-pale-green so it blends into
    # the white header background, logo anchored to the right edge.
    header_size = (300, 114)
    header = _linear_gradient(header_size, (255, 255, 255), (232, 245, 233), vertical=False)
    logo = _scaled_logo(80)
    header.paste(logo, (header_size[0] - logo.width - 16, (header_size[1] - logo.height) // 2), logo)
    header.save(assets_dir / "header.bmp")

    shutil.copyfile(LOGO_ICO, assets_dir / "logo.ico")
    log(f"installer assets -> {assets_dir}")


def find_makensis() -> str | None:
    found = shutil.which("makensis")
    if found:
        return found
    for candidate in (
        r"C:\Program Files (x86)\NSIS\makensis.exe",
        r"C:\Program Files\NSIS\makensis.exe",
    ):
        if Path(candidate).is_file():
            return candidate
    return None


def installer_file_version(version: str) -> str:
    """Reduce a display version to the strict numeric X.X.X.X form.

    ``VIProductVersion`` rejects prerelease suffixes such as ``2.0.0-beta1``.
    The core version is kept (leading ``v`` ignored), truncated or zero-padded
    to exactly four segments, and the prerelease/build metadata is dropped so
    beta builds map to the smallest matching file version (2.0.0-beta1 ->
    2.0.0.0). The full display version is still written via APP_VERSION.
    """
    match = re.match(r"[vV]?(\d+(?:\.\d+){0,3})", str(version).strip())
    numbers = [int(part) for part in match.group(1).split(".")] if match else [0]
    return ".".join(str(number) for number in (numbers + [0, 0, 0, 0])[:4])


def compile_installer() -> Path:
    if platform.system() != "Windows":
        log("ERROR: installer mode is only supported on Windows (NSIS)")
        raise SystemExit(1)
    makensis = find_makensis()
    if not makensis:
        log("ERROR: makensis not found; install NSIS 3 or add it to PATH")
        raise SystemExit(127)
    if not NSI_SCRIPT.is_file():
        log(f"ERROR: {NSI_SCRIPT} not found")
        raise SystemExit(1)

    source_dir = DIST_DIR / ONEDIR_NAME
    if not (source_dir / "LittleTreeWallpaper.exe").is_file():
        log(f"ERROR: onedir bundle missing: {source_dir}; build with --mode folder first")
        raise SystemExit(1)
    if not LICENSE_FILE.is_file():
        log(f"ERROR: license file missing: {LICENSE_FILE}")
        raise SystemExit(1)

    meta = json.loads(BUILD_JSON.read_text(encoding="utf-8"))
    version = meta["version"]
    channel = meta.get("build_type") or "beta"
    suffix = "" if channel == "stable" else f"-{channel}"
    out_name = f"LittleTreeWallpaper-Setup-{version}{suffix}.exe"
    out_file = DIST_DIR / out_name
    assets_dir = DIST_DIR / "installer-assets"

    generate_installer_assets(assets_dir)

    run(
        [
            makensis,
            "/V2",
            f"/DAPP_VERSION={version}",
            f"/DFILE_VERSION={installer_file_version(version)}",
            f"/DBUILD_CHANNEL={channel}",
            f"/DSOURCE_DIR={source_dir}",
            f"/DOUT_FILE={out_file}",
            f"/DOUT_NAME={out_name}",
            f"/DASSETS_DIR={assets_dir}",
            f"/DLICENSE_FILE={LICENSE_FILE}",
            str(NSI_SCRIPT),
        ]
    )
    if not out_file.is_file():
        log(f"ERROR: makensis finished but {out_file} was not created")
        raise SystemExit(1)
    return out_file


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="build.py",
        description="Stamp build metadata, build the frontend, and run PyInstaller.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python tools/build.py\n"
            "  python tools/build.py --build-type stable\n"
            "  python tools/build.py --mode folder\n"
            "  python tools/build.py --mode installer\n"
            "  python tools/build.py --no-frontend\n"
            "  python tools/build.py --no-binary\n"
            "  python tools/build.py --dry-run"
        ),
    )
    parser.add_argument("--version", help="set version explicitly")
    parser.add_argument("--build-type", choices=["beta", "stable"], help="set build channel")
    parser.add_argument("--built-by", metavar="WHO", help="set producer")
    parser.add_argument(
        "--mode",
        choices=BUILD_MODES,
        default="onefile",
        help="artifact layout: onefile = single exe (default), folder = onedir bundle, installer = folder + NSIS setup",
    )
    parser.add_argument("--no-frontend", action="store_true", help="skip npm build")
    parser.add_argument("--no-binary", action="store_true", help="only stamp metadata")
    parser.add_argument("--offline-frontend", action="store_true", help="skip npm install")
    parser.add_argument("--dry-run", action="store_true", help="preview only")
    args = parser.parse_args(argv)

    log(f"root: {REPO_ROOT}")
    log(f"cwd:  {os.getcwd()}")
    log(f"mode: {args.mode}")

    refresh_metadata(args)
    if args.no_binary or args.dry_run:
        log("done (metadata only)")
        return 0

    if not args.no_frontend:
        build_frontend(offline=args.offline_frontend)

    build_binary(args.mode)

    if args.mode == "installer":
        installer = compile_installer()
        log(f"installer: {installer}")

    log("build complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
