from __future__ import annotations

from typing import Any


class CompleteExamplePlugin:
    def on_start(self, context: Any) -> None:
        starts = context.get_setting("lifecycle.starts", 0) + 1
        context.set_setting("lifecycle.starts", starts)
        context.set_setting("lifecycle.running", True)
        context.logger.info("Complete example started for the %s time", starts)

    def on_stop(self, context: Any) -> None:
        stops = context.get_setting("lifecycle.stops", 0) + 1
        context.set_setting("lifecycle.stops", stops)
        context.set_setting("lifecycle.running", False)
        context.logger.info("Complete example stopped")


def setup(context: Any) -> CompleteExamplePlugin:
    if context.get_setting("counter.value", None) is None:
        context.set_setting("counter.value", 0)

    def increment(payload: Any) -> dict[str, Any]:
        request = payload if isinstance(payload, dict) else {}
        step = request.get("step", 1)
        if type(step) is not int or not -1000 <= step <= 1000:
            raise ValueError("step must be an integer between -1000 and 1000")
        value = context.get_setting("counter.value", 0) + step
        context.set_setting("counter.value", value)
        return {
            "count": value,
            "source": request.get("source", "action"),
            "plugin_id": context.plugin_id,
        }

    def get_status(_payload: Any) -> dict[str, Any]:
        return {
            "count": context.get_setting("counter.value", 0),
            "starts": context.get_setting("lifecycle.starts", 0),
            "stops": context.get_setting("lifecycle.stops", 0),
            "running": context.get_setting("lifecycle.running", False),
            "data_path": str(context.data_path),
        }

    context.register_action("increment", increment)
    context.register_action("get-status", get_status)
    return CompleteExamplePlugin()
