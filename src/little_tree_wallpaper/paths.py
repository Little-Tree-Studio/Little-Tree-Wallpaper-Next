from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from platformdirs import PlatformDirs


APP_NAME = "Little Tree Wallpaper Refactor"
APP_AUTHOR = "Little Tree Studio"


@dataclass(slots=True)
class AppPaths:
    base_dir: Path
    config_dir: Path
    data_dir: Path
    cache_dir: Path
    log_dir: Path
    themes_dir: Path
    plugins_dir: Path
    sources_dir: Path
    history_dir: Path
    favorites_dir: Path
    auto_change_dir: Path
    downloads_dir: Path
    frontend_dir: Path
    frontend_dist_dir: Path
    examples_dir: Path

    @classmethod
    def create(cls, workspace_root: Path) -> "AppPaths":
        dirs = PlatformDirs(appname=APP_NAME, appauthor=APP_AUTHOR, ensure_exists=True)
        config_dir = Path(dirs.user_config_dir)
        data_dir = Path(dirs.user_data_dir)
        cache_dir = Path(dirs.user_cache_dir)
        log_dir = data_dir / "logs"
        themes_dir = data_dir / "themes"
        plugins_dir = data_dir / "plugins"
        sources_dir = data_dir / "wallpaper_sources"
        history_dir = data_dir / "wallpaper_history"
        favorites_dir = data_dir / "favorites"
        auto_change_dir = data_dir / "auto_change"
        downloads_dir = data_dir / "downloads"
        frontend_dir = workspace_root / "frontend"
        frontend_dist_dir = frontend_dir / "dist"
        examples_dir = workspace_root / "examples"

        for path in [
            config_dir,
            data_dir,
            cache_dir,
            log_dir,
            themes_dir,
            plugins_dir,
            sources_dir,
            history_dir,
            favorites_dir,
            auto_change_dir,
            downloads_dir,
        ]:
            path.mkdir(parents=True, exist_ok=True)

        return cls(
            base_dir=workspace_root,
            config_dir=config_dir,
            data_dir=data_dir,
            cache_dir=cache_dir,
            log_dir=log_dir,
            themes_dir=themes_dir,
            plugins_dir=plugins_dir,
            sources_dir=sources_dir,
            history_dir=history_dir,
            favorites_dir=favorites_dir,
            auto_change_dir=auto_change_dir,
            downloads_dir=downloads_dir,
            frontend_dir=frontend_dir,
            frontend_dist_dir=frontend_dist_dir,
            examples_dir=examples_dir,
        )
