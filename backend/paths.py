import re
from pathlib import Path

from platformdirs import user_cache_dir, user_config_dir, user_data_dir

APP_NAME = "LittleTreeWallpaper"
APP_AUTHOR = "LittleTreeStudio"

BASE_DIR = Path(__file__).parent.parent.resolve()
ASSET_DIR = BASE_DIR / "assets"
PLUGIN_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")


def get_cache_dir() -> Path:
    return Path(user_cache_dir(APP_NAME, APP_AUTHOR))


def get_config_dir() -> Path:
    return Path(user_config_dir(APP_NAME, APP_AUTHOR))


def get_data_dir() -> Path:
    return Path(user_data_dir(APP_NAME, APP_AUTHOR))


def get_plugins_dir(data_dir: Path | None = None) -> Path:
    return (data_dir or get_data_dir()) / "plugins"


def get_plugins_data_dir(data_dir: Path | None = None) -> Path:
    return (data_dir or get_data_dir()) / "plugin_data"


def get_plugins_config_dir(config_dir: Path | None = None) -> Path:
    return (config_dir or get_config_dir()) / "plugins"


def get_plugins_cache_dir(cache_dir: Path | None = None) -> Path:
    return (cache_dir or get_cache_dir()) / "plugins"


def get_plugin_state_path(config_dir: Path | None = None) -> Path:
    return get_plugins_config_dir(config_dir) / "state.json"


def _validate_plugin_namespace(plugin_id: str) -> str:
    if not isinstance(plugin_id, str) or not PLUGIN_ID_PATTERN.fullmatch(plugin_id):
        raise ValueError("Invalid plugin ID")
    return plugin_id


def get_plugin_data_dir(plugin_id: str, data_dir: Path | None = None) -> Path:
    return get_plugins_data_dir(data_dir) / _validate_plugin_namespace(plugin_id)


def get_plugin_config_dir(plugin_id: str, config_dir: Path | None = None) -> Path:
    return get_plugins_config_dir(config_dir) / _validate_plugin_namespace(plugin_id)


def get_plugin_cache_dir(plugin_id: str, cache_dir: Path | None = None) -> Path:
    return get_plugins_cache_dir(cache_dir) / _validate_plugin_namespace(plugin_id)


def ensure_dirs() -> None:
    for d in [
        get_cache_dir(),
        get_config_dir(),
        get_data_dir(),
        get_plugins_dir(),
        get_plugins_data_dir(),
        get_plugins_config_dir(),
        get_plugins_cache_dir(),
    ]:
        d.mkdir(parents=True, exist_ok=True)
    (get_cache_dir() / "logs").mkdir(exist_ok=True)
    (get_cache_dir() / "sniff").mkdir(exist_ok=True)
    (get_data_dir() / "downloads").mkdir(exist_ok=True)
    (get_data_dir() / "wallpaper_sources").mkdir(exist_ok=True)
    (get_config_dir() / "themes").mkdir(exist_ok=True)
