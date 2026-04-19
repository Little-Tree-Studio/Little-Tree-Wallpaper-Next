from __future__ import annotations

from pathlib import Path
from typing import Any

import orjson

from little_tree_wallpaper.models import PluginRuntimeInfo


class PluginManager:
    def __init__(self, plugins_dir: Path, state_file: Path):
        self.plugins_dir = plugins_dir
        self.plugins_dir.mkdir(parents=True, exist_ok=True)
        self.state_file = state_file
        if not self.state_file.exists():
            self.state_file.write_bytes(orjson.dumps({"plugins": {}}, option=orjson.OPT_INDENT_2))

    def _load_state(self) -> dict[str, Any]:
        return orjson.loads(self.state_file.read_bytes())

    def _save_state(self, payload: dict[str, Any]) -> None:
        self.state_file.write_bytes(orjson.dumps(payload, option=orjson.OPT_INDENT_2))

    def discover(self) -> list[dict[str, Any]]:
        state = self._load_state().get("plugins", {})
        runtime_plugins: list[dict[str, Any]] = []
        for path in sorted(self.plugins_dir.iterdir()) if self.plugins_dir.exists() else []:
            if path.name.startswith("_"):
                continue
            identifier = path.stem
            plugin_state = state.get(identifier, {})
            runtime_plugins.append(
                PluginRuntimeInfo(
                    identifier=identifier,
                    name=identifier.replace("_", " ").title(),
                    version="0.1.0",
                    description="插件目录中发现的扩展包",
                    enabled=plugin_state.get("enabled", False),
                    permissions=plugin_state.get("permissions", []),
                ).to_dict()
            )

        if not runtime_plugins:
            runtime_plugins.append(
                PluginRuntimeInfo(
                    identifier="example.generator",
                    name="示例生成插件",
                    version="0.1.0",
                    description="用于挂载生成页和设置页的示例插件条目",
                    enabled=True,
                    permissions=["navigation.register", "wallpaper.set"],
                ).to_dict()
            )
        return runtime_plugins

    def set_enabled(self, plugin_id: str, enabled: bool) -> list[dict[str, Any]]:
        payload = self._load_state()
        payload.setdefault("plugins", {}).setdefault(plugin_id, {})["enabled"] = enabled
        self._save_state(payload)
        return self.discover()
