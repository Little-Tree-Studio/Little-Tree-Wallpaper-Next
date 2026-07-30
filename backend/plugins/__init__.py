"""Trusted, in-process plugin support.

Plugins execute with the same OS and Python privileges as the application. Package
validation reduces accidental and UI-facing risk, but it is not a sandbox and must
not be used to run untrusted code.
"""

from .context import PluginContext
from .manager import PluginManager
from .validation import PluginError, PluginValidationError

__all__ = ["PluginContext", "PluginError", "PluginManager", "PluginValidationError"]
