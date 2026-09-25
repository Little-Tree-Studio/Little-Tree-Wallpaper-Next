"""Cross-platform desktop integration boundary.

Application code should import desktop capabilities from this package instead
of depending on operating-system-specific implementations.
"""

from backend.desktop_bridge.environment import DesktopEnvironment, DesktopNotification, NotificationSink

__all__ = ["DesktopEnvironment", "DesktopNotification", "NotificationSink"]
