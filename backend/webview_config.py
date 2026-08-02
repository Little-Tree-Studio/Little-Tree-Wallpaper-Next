from __future__ import annotations

import os

WEBVIEW2_DISABLED_FEATURES = ("ElasticOverscroll", "PullToRefresh")
WEBVIEW2_GESTURE_ARGUMENTS = ("--disable-pinch", "--overscroll-history-navigation=0")


def configure_webview2_gesture_arguments() -> str:
    """Disable native zoom and overscroll before WebView2 is initialized."""
    existing = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "").strip()
    arguments = existing.split() if existing else []
    disabled_features: list[str] = []
    remaining: list[str] = []
    for argument in arguments:
        if argument.startswith("--disable-features="):
            disabled_features.extend(
                feature for feature in argument.partition("=")[2].split(",") if feature
            )
        else:
            remaining.append(argument)
    for argument in WEBVIEW2_GESTURE_ARGUMENTS:
        if argument not in remaining:
            remaining.append(argument)
    for feature in WEBVIEW2_DISABLED_FEATURES:
        if feature not in disabled_features:
            disabled_features.append(feature)
    remaining.append(f"--disable-features={','.join(disabled_features)}")
    value = " ".join(remaining)
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = value
    return value
