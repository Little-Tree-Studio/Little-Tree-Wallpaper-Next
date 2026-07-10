import os
import sys
from pathlib import Path
from platformdirs import user_cache_dir, user_config_dir, user_data_dir

APP_NAME = "LittleTreeWallpaper"
APP_AUTHOR = "LittleTreeStudio"

BASE_DIR = Path(__file__).parent.parent.resolve()
ASSET_DIR = BASE_DIR / "assets"

def get_cache_dir() -> Path:
    return Path(user_cache_dir(APP_NAME, APP_AUTHOR))

def get_config_dir() -> Path:
    return Path(user_config_dir(APP_NAME, APP_AUTHOR))

def get_data_dir() -> Path:
    return Path(user_data_dir(APP_NAME, APP_AUTHOR))

def ensure_dirs() -> None:
    for d in [get_cache_dir(), get_config_dir(), get_data_dir()]:
        d.mkdir(parents=True, exist_ok=True)
    (get_cache_dir() / "logs").mkdir(exist_ok=True)
    (get_cache_dir() / "sniff").mkdir(exist_ok=True)
    (get_data_dir() / "downloads").mkdir(exist_ok=True)
    (get_data_dir() / "wallpaper_sources").mkdir(exist_ok=True)
    (get_config_dir() / "themes").mkdir(exist_ok=True)
