"""Application metadata.

Reads two committed/project files:

* build/app_info.json  - static identity (name, package, author, repo)
* build.json           - build provenance (version, build_type, build_time, ...)

When build.json is missing (source run), provenance is synthesised with
version=0.0.0, build_type=beta and build_time set to process start time.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
_APP_INFO_JSON = _REPO_ROOT / "build" / "app_info.json"
_BUILD_JSON = _REPO_ROOT / "build.json"

_PROCESS_START = datetime.now().astimezone()


def _default_app_info() -> dict[str, str]:
    return {
        "name": "小树壁纸 Next",
        "name_en": "Little Tree Wallpaper Next",
        "package_name": "little-tree-wallpaper",
        "description": "A modern cross-platform wallpaper manager.",
        "author": "LittleTreeStudio",
        "repo_url": "https://github.com/xiaoshuapp/little-tree-wallpaper-next",
    }


def _default_build() -> dict[str, str]:
    return {
        "version": "0.0.0",
        "build_type": "beta",
        "build_time": _PROCESS_START.isoformat(timespec="seconds"),
        "git_commit": "source",
        "built_by": "source",
    }


def _load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.is_file():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return default
    if not isinstance(data, dict):
        return default
    return {k: str(data[k]) if isinstance(data.get(k), (str, int, float)) else default.get(k, "") for k in default}


def _load_app_info() -> dict[str, str]:
    return _load_json(_APP_INFO_JSON, _default_app_info())


def _load_build() -> dict[str, str]:
    build = _load_json(_BUILD_JSON, _default_build())
    if not _BUILD_JSON.is_file():
        build.update(_default_build())
    build["build_type"] = build["build_type"] if build["build_type"] in ("beta", "stable") else "beta"
    return build


_APP_INFO = _load_app_info()
_BUILD = _load_build()

APP_NAME: str = _APP_INFO["name"]
APP_NAME_EN: str = _APP_INFO["name_en"]
PACKAGE_NAME: str = _APP_INFO["package_name"]
DESCRIPTION: str = _APP_INFO["description"]
AUTHOR: str = _APP_INFO["author"]
REPO_URL: str = _APP_INFO["repo_url"]

VERSION: str = _BUILD["version"]
BUILD_TYPE: str = _BUILD["build_type"]
BUILD_TIME: str = _BUILD["build_time"]
GIT_COMMIT: str = _BUILD["git_commit"]
BUILT_BY: str = _BUILD["built_by"]


def is_beta() -> bool:
    return BUILD_TYPE == "beta"


def is_source_run() -> bool:
    return not _BUILD_JSON.is_file()


def get_app_info() -> dict[str, str]:
    return dict(_APP_INFO)


def get_build_info() -> dict[str, Any]:
    info = dict(_BUILD)
    info["source_run"] = is_source_run()
    return info


def get_metadata() -> dict[str, Any]:
    return {**_APP_INFO, **get_build_info()}


def reload() -> dict[str, Any]:
    global _APP_INFO, _BUILD
    global APP_NAME, APP_NAME_EN, PACKAGE_NAME, DESCRIPTION, AUTHOR, REPO_URL
    global VERSION, BUILD_TYPE, BUILD_TIME, GIT_COMMIT, BUILT_BY
    _APP_INFO = _load_app_info()
    _BUILD = _load_build()
    APP_NAME = _APP_INFO["name"]
    APP_NAME_EN = _APP_INFO["name_en"]
    PACKAGE_NAME = _APP_INFO["package_name"]
    DESCRIPTION = _APP_INFO["description"]
    AUTHOR = _APP_INFO["author"]
    REPO_URL = _APP_INFO["repo_url"]
    VERSION = _BUILD["version"]
    BUILD_TYPE = _BUILD["build_type"]
    BUILD_TIME = _BUILD["build_time"]
    GIT_COMMIT = _BUILD["git_commit"]
    BUILT_BY = _BUILD["built_by"]
    return get_metadata()
