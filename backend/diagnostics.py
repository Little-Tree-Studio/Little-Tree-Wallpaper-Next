"""Diagnostics export helpers.

Bundles everything commonly needed to triage a bug report -- build metadata,
OS/Python details, runtime state, redacted settings, log files and crash
reports -- into a single ZIP archive. Settings are sanitized before export so
API keys, tokens and proxy passwords never leave the machine.

The module is deliberately independent from :class:`backend.api.BackendAPI`:
the API layer collects the runtime-specific parts and calls
:func:`write_diagnostics_archive` to produce the file.
"""

from __future__ import annotations

import contextlib
import copy
import json
import locale
import os
import platform
import re
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from loguru import logger

from backend import logging_setup
from backend.app_meta import get_metadata
from backend.paths import BASE_DIR, get_cache_dir, get_config_dir, get_data_dir

SCHEMA_VERSION = 1

# Per-attachment and total caps so one runaway log file cannot produce an
# unusable (or unreadable) export. Oversized files are listed in the manifest
# with the reason instead of being copied.
MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024
MAX_ATTACHMENT_COUNT = 64

# Historical log files copied in addition to the active session logs.
MAX_HISTORICAL_LOGS = 3
# Crash reports are small; keep a generous but bounded number.
MAX_CRASH_REPORTS = 20

REDACTED = "<已脱敏>"

_SENSITIVE_KEY_RE = re.compile(
    r"(api[_-]?key|access[_-]?token|refresh[_-]?token|(?:^|[_-])key$|token|secret|password|passwd|credential|authorization|cookie)",
    re.IGNORECASE,
)


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _sanitize_url(value: str) -> str:
    """Mask credentials in URLs (userinfo and sensitive query parameters)."""
    if "://" not in value:
        return value
    try:
        parts = urlsplit(value)
    except ValueError:
        return value
    netloc = parts.netloc
    query = parts.query
    if "@" in netloc:
        userinfo, _, host = netloc.rpartition("@")
        netloc = f"{REDACTED}@{host}" if userinfo else netloc
    if query and "=" in query:
        pairs: list[str] = []
        changed = False
        for pair in query.split("&"):
            name, separator, raw_value = pair.partition("=")
            if separator and raw_value and _SENSITIVE_KEY_RE.search(name):
                pairs.append(f"{name}={REDACTED}")
                changed = True
            else:
                pairs.append(pair)
        if changed:
            query = "&".join(pairs)
    if netloc == parts.netloc and query == parts.query:
        return value
    return urlunsplit(parts._replace(netloc=netloc, query=query))


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            if _SENSITIVE_KEY_RE.search(str(key)) and not _is_empty(item):
                result[key] = REDACTED
            else:
                result[key] = _redact(item)
        return result
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, tuple):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        return _sanitize_url(value)
    return copy.deepcopy(value)


def redact_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Return a deep copy of ``settings`` with secrets masked."""
    return _redact(settings)


def _locale_name() -> str:
    with contextlib.suppress(Exception):
        language, encoding = locale.getlocale()
        if language:
            return f"{language} ({encoding})" if encoding else language
    return ""


def _hardware_info() -> dict[str, Any]:
    """Best-effort CPU/memory/disk/process details; never raises."""
    info: dict[str, Any] = {}
    try:
        import psutil
    except Exception:  # noqa: BLE001 - diagnostics must not fail on a missing dep
        return info

    with contextlib.suppress(Exception):
        info["cpu"] = {
            "logical_cores": psutil.cpu_count(),
            "physical_cores": psutil.cpu_count(logical=False),
        }
        frequency = psutil.cpu_freq()
        if frequency is not None:
            info["cpu"]["max_frequency_mhz"] = round(frequency.max, 1)

    with contextlib.suppress(Exception):
        memory = psutil.virtual_memory()
        info["memory"] = {
            "total_bytes": memory.total,
            "available_bytes": memory.available,
            "used_percent": memory.percent,
        }

    disks: list[dict[str, Any]] = []
    for path in (get_cache_dir(), get_config_dir(), get_data_dir()):
        with contextlib.suppress(Exception):
            usage = psutil.disk_usage(str(path))
            disks.append(
                {
                    "path": str(path),
                    "total_bytes": usage.total,
                    "free_bytes": usage.free,
                    "used_percent": usage.percent,
                }
            )
    if disks:
        info["disks"] = disks

    with contextlib.suppress(Exception):
        process = psutil.Process(os.getpid())
        with process.oneshot():
            info["process"] = {
                "pid": process.pid,
                "threads": process.num_threads(),
                "uptime_seconds": round(max(0.0, time.time() - process.create_time()), 1),
                "rss_bytes": process.memory_info().rss,
            }
    return info


def _system_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "platform": platform.system(),
        "release": platform.release(),
        "version": platform.version(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
        "locale": _locale_name(),
        "python": {
            "version": platform.python_version(),
            "implementation": platform.python_implementation(),
            "executable": sys.executable,
            "frozen": bool(getattr(sys, "frozen", False)),
            "packaged_runtime": bool(getattr(sys, "_MEIPASS", None)),
        },
    }
    if hasattr(platform, "win32_edition"):
        with contextlib.suppress(Exception):
            info["windows_edition"] = platform.win32_edition()
    info.update(_hardware_info())
    with contextlib.suppress(Exception):
        from backend.services.sys_wallpaper import get_display_resolutions

        info["displays"] = get_display_resolutions()
    return info


def collect_environment() -> dict[str, Any]:
    """Return the static part of the diagnostics report (app/system/paths)."""
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "app": get_metadata(),
        "system": _system_info(),
        "paths": {
            "base_dir": str(BASE_DIR),
            "cache_dir": str(get_cache_dir()),
            "config_dir": str(get_config_dir()),
            "data_dir": str(get_data_dir()),
            "log_dir": str(logging_setup.LOG_DIR),
        },
        "file_log_level": logging_setup.get_file_level(),
    }


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _sorted_files(directory: Path, pattern: str) -> list[Path]:
    try:
        files = [f for f in directory.glob(pattern) if f.is_file()]
    except OSError:
        return []
    files.sort(key=_mtime, reverse=True)
    return files


def collect_attachments(log_dir: Path, crash_report_dir: Path) -> list[tuple[Path, str]]:
    """Return ``(source, archive_path)`` pairs for logs and crash reports.

    The active session's full + error logs are always first; a few newest
    historical logs and crash reports follow. Size/count caps are applied when
    the archive is written so the manifest can report what was skipped.
    """
    attachments: list[tuple[Path, str]] = []
    logs = _sorted_files(log_dir, "*.log")
    app_logs = [f for f in logs if f.name.startswith("app_")]
    error_logs = [f for f in logs if f.name.startswith("error_")]
    if app_logs:
        attachments.append((app_logs[0], f"logs/{app_logs[0].name}"))
    if error_logs:
        attachments.append((error_logs[0], f"logs/{error_logs[0].name}"))
    for path in app_logs[1 : 1 + MAX_HISTORICAL_LOGS]:
        attachments.append((path, f"logs/{path.name}"))
    for path in _sorted_files(crash_report_dir, "crash_report_*.txt")[:MAX_CRASH_REPORTS]:
        attachments.append((path, f"crash_reports/{path.name}"))
    return attachments


def _json_default(value: Any) -> str:
    return str(value)


def _format_bytes(value: Any) -> str:
    try:
        size = float(value)
    except (TypeError, ValueError):
        return "—"
    units = ["B", "KB", "MB", "GB"]
    unit = 0
    while size >= 1024 and unit < len(units) - 1:
        size /= 1024
        unit += 1
    return f"{size:.1f} {units[unit]}"


def _render_markdown(report: dict[str, Any]) -> str:
    app = report.get("app") or {}
    system = report.get("system") or {}
    runtime = report.get("runtime") or {}
    files = report.get("files") or {}

    def row(label: str, value: Any) -> str:
        text = str(value) if value not in (None, "") else "—"
        return f"| {label} | {text} |"

    lines = [
        "# 小树壁纸 诊断报告",
        "",
        f"- 生成时间：{report.get('generated_at', '—')}",
        f"- 应用版本：v{app.get('version', '—')}（{app.get('build_type', '—')}）",
        f"- Git Commit：{app.get('git_commit', '—')}",
        f"- 构建时间：{app.get('build_time', '—')}",
        f"- 运行方式：{'源码运行' if app.get('source_run') else '打包运行'}",
        "",
        "## 运行环境",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        row("操作系统", f"{system.get('platform', '')} {system.get('release', '')}"),
        row("系统版本", system.get("version")),
        row("Windows 版本", system.get("windows_edition")),
        row("架构", system.get("architecture")),
        row("处理器", system.get("processor")),
        row("区域设置", system.get("locale")),
        row("Python", (system.get("python") or {}).get("version")),
        row("打包运行时", (system.get("python") or {}).get("packaged_runtime")),
        row("文件日志级别", report.get("file_log_level")),
        "",
    ]

    paths = report.get("paths") or {}
    if paths:
        lines += ["## 目录", "", "| 项目 | 路径 |", "| --- | --- |"]
        lines += [row(label, value) for label, value in paths.items()]
        lines.append("")

    if runtime:
        lines += ["## 运行状态", ""]
        for label, value in runtime.items():
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, default=_json_default)
            lines.append(f"- {label}: {value}")
        lines.append("")

    included = files.get("attachments") or []
    skipped = files.get("skipped_attachments") or []
    lines += ["## 归档文件", ""]
    if included:
        lines += [f"- {item.get('path')}（{_format_bytes(item.get('size'))}）" for item in included]
    else:
        lines.append("- （无）")
    if skipped:
        lines += ["", "以下文件未包含：", ""]
        lines += [f"- {item.get('path')}：{item.get('reason')}" for item in skipped]
    lines += [
        "",
        "> 设置中的密钥、令牌与代理凭据已脱敏；导出内容不包含壁纸与图片文件。",
        "",
    ]
    return "\n".join(lines)


def write_diagnostics_archive(
    destination: Path,
    *,
    report: dict[str, Any],
    settings: dict[str, Any],
    attachments: list[tuple[Path, str]],
) -> dict[str, Any]:
    """Write the ZIP and return a small summary of what was bundled."""
    included: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    resolved: list[tuple[Path, str]] = []
    for source, arcname in attachments:
        if len(resolved) >= MAX_ATTACHMENT_COUNT:
            skipped.append({"path": arcname, "reason": "文件数量超出上限"})
            continue
        try:
            size = source.stat().st_size
        except OSError as exc:
            skipped.append({"path": arcname, "reason": f"无法读取：{exc}"})
            continue
        if size > MAX_ATTACHMENT_BYTES:
            skipped.append({"path": arcname, "size": size, "reason": "文件过大，未包含"})
            continue
        included.append({"path": arcname, "size": size, "source": str(source)})
        resolved.append((source, arcname))

    payload = dict(report)
    payload["files"] = {
        "included_count": len(included),
        "skipped_count": len(skipped),
        "attachments": included,
        "skipped_attachments": skipped,
    }

    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("diagnostics.json", json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default))
        archive.writestr("settings.json", json.dumps(settings, ensure_ascii=False, indent=2, default=_json_default))
        archive.writestr("report.md", _render_markdown(payload))
        for source, arcname in resolved:
            with contextlib.suppress(OSError):
                archive.write(source, arcname)
    logger.info(
        "Diagnostics exported to {} ({} attachment(s), {} skipped)",
        destination,
        len(included),
        len(skipped),
    )
    return {
        "attachment_count": len(included),
        "skipped_count": len(skipped),
        "size_bytes": destination.stat().st_size if destination.exists() else 0,
    }
