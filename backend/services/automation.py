from __future__ import annotations

import contextlib
import copy
import hashlib
import json
import math
import operator
import os
import platform
import random
import re
import shlex
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from loguru import logger

MAX_EXECUTION_STEPS = 10_000
MAX_EXPRESSION_DEPTH = 64
MAX_AUTOMATIONS = 200
MAX_NODES = 500
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
MAX_DIRECTORY_ENTRIES = 2000
MAX_MATCH_CASES = 32


class AutomationCancelledError(Exception):
    pass


class AutomationService:
    """Persist and execute bounded node graphs independently from the UI."""

    def __init__(
        self,
        path: Path,
        set_wallpaper: Callable[[str], dict[str, Any]],
        fetch_resource: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]],
        normalize_setting_input: Callable[[str, str, Any, dict[str, Any]], Any],
        start_dynamic_wallpaper: Callable[[str, bool, bool, float], dict[str, Any]],
        control_dynamic_wallpaper: Callable[[str], dict[str, Any]],
        stop_dynamic_wallpaper: Callable[[], dict[str, Any]],
        data_root: Path | None = None,
        notify: Callable[[str, str], None] | None = None,
        manage_dynamic_wallpaper: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self._path = path
        self._set_wallpaper = set_wallpaper
        self._fetch_resource = fetch_resource
        self._normalize_setting_input = normalize_setting_input
        self._start_dynamic_wallpaper = start_dynamic_wallpaper
        self._control_dynamic_wallpaper = control_dynamic_wallpaper
        self._stop_dynamic_wallpaper = stop_dynamic_wallpaper
        self._data_root = data_root or path.parent / "automation_data"
        self._notify = notify
        self._manage_dynamic_wallpaper = manage_dynamic_wallpaper
        self._lock = threading.RLock()
        self._execution_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._cancel_event = threading.Event()
        self._automations: list[dict[str, Any]] = []
        self._schedule_state: dict[str, float] = {}
        self._pending_runs: deque[tuple[str, str, str]] = deque()
        self._pending_run_keys: set[str] = set()
        self._run: dict[str, Any] = self._empty_run()
        self._events: deque[dict[str, Any]] = deque(maxlen=300)
        self._load()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._scheduler_loop, name="automation-scheduler", daemon=True)
            self._thread.start()

    @staticmethod
    def _empty_run() -> dict[str, Any]:
        return {
            "id": "",
            "automation_id": "",
            "automation_name": "",
            "running": False,
            "status": "idle",
            "current_node_id": "",
            "steps": 0,
            "started_at": "",
            "finished_at": "",
            "error": "",
            "variables": {},
        }

    def _load(self) -> None:
        with self._lock:
            try:
                if self._path.exists():
                    payload = json.loads(self._path.read_text(encoding="utf-8"))
                    items = payload.get("automations", []) if isinstance(payload, dict) else []
                    self._automations = [self._normalize(item) for item in items if isinstance(item, dict)]
            except Exception as exc:
                logger.error("Failed to load automations from {}: {}", self._path, exc)
                self._automations = []

    def _save_locked(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_name(f"{self._path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps({"version": 1, "automations": self._automations}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(temporary, self._path)
        finally:
            if temporary.exists():
                temporary.unlink(missing_ok=True)

    @staticmethod
    def _normalize(document: dict[str, Any]) -> dict[str, Any]:
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        normalized = copy.deepcopy(document)
        normalized["id"] = str(normalized.get("id") or uuid.uuid4().hex)
        normalized["name"] = str(normalized.get("name") or "未命名自动化")[:100]
        normalized["description"] = str(normalized.get("description") or "")[:500]
        normalized["enabled"] = bool(normalized.get("enabled", False))
        normalized["version"] = 1
        normalized["automation_type"] = (
            normalized.get("automation_type")
            if normalized.get("automation_type") in {"simple", "blocks", "advanced"}
            else "advanced"
        )
        normalized["nodes"] = normalized.get("nodes") if isinstance(normalized.get("nodes"), list) else []
        normalized["edges"] = normalized.get("edges") if isinstance(normalized.get("edges"), list) else []
        normalized["created_at"] = str(normalized.get("created_at") or now)
        normalized["updated_at"] = now
        return normalized

    @staticmethod
    def _summary(document: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": document["id"],
            "name": document["name"],
            "description": document.get("description", ""),
            "enabled": bool(document.get("enabled")),
            "automation_type": document.get("automation_type", "advanced"),
            "node_count": len(document.get("nodes", [])),
            "updated_at": document.get("updated_at", ""),
        }

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._summary(item) for item in self._automations]

    def get(self, automation_id: str) -> dict[str, Any]:
        with self._lock:
            item = next((item for item in self._automations if item["id"] == automation_id), None)
            if item is None:
                raise ValueError("自动化不存在")
            return copy.deepcopy(item)

    def save(self, document: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(document, dict):
            raise ValueError("自动化文档格式无效")
        normalized = self._normalize(document)
        validation = self.validate(normalized)
        if not validation["valid"]:
            raise ValueError("；".join(validation["errors"]))
        with self._lock:
            index = next((i for i, item in enumerate(self._automations) if item["id"] == normalized["id"]), -1)
            if index < 0:
                if len(self._automations) >= MAX_AUTOMATIONS:
                    raise ValueError(f"最多创建 {MAX_AUTOMATIONS} 个自动化")
                self._automations.append(normalized)
            else:
                normalized["created_at"] = self._automations[index].get("created_at", normalized["created_at"])
                self._automations[index] = normalized
            self._save_locked()
        self._wake_event.set()
        return copy.deepcopy(normalized)

    def delete(self, automation_id: str) -> None:
        with self._lock:
            before = len(self._automations)
            self._automations = [item for item in self._automations if item["id"] != automation_id]
            if len(self._automations) == before:
                raise ValueError("自动化不存在")
            self._remove_pending_locked(automation_id)
            self._save_locked()
        if self._run.get("automation_id") == automation_id:
            self._cancel_event.set()
        self._wake_event.set()

    def set_enabled(self, automation_id: str, enabled: bool) -> dict[str, Any]:
        document = self.get(automation_id)
        document["enabled"] = bool(enabled)
        saved = self.save(document)
        if not enabled:
            with self._lock:
                self._remove_pending_locked(automation_id)
        return saved

    def _remove_pending_locked(self, automation_id: str) -> None:
        self._pending_runs = deque(item for item in self._pending_runs if item[0] != automation_id)
        self._pending_run_keys = {item[2] for item in self._pending_runs}

    def validate(self, document: dict[str, Any]) -> dict[str, Any]:
        errors: list[str] = []
        nodes = document.get("nodes", [])
        edges = document.get("edges", [])
        if len(nodes) > MAX_NODES:
            errors.append(f"节点数量不能超过 {MAX_NODES}")
        node_ids: set[str] = set()
        supported = {
            "trigger", "condition", "set_variable", "function", "wait", "fetch_resource", "local_file", "set_wallpaper",
            "dynamic_wallpaper", "log", "stop", "loop", "match", "calculate", "notification", "command", "open_target",
            "system_action", "read_file", "write_file", "delete_file", "data_directory", "list_directory", "datetime",
        }
        for node in nodes:
            if not isinstance(node, dict):
                errors.append("节点格式无效")
                continue
            node_id = str(node.get("id") or "")
            if not node_id or node_id in node_ids:
                errors.append("节点 ID 为空或重复")
            node_ids.add(node_id)
            if node.get("type") not in supported:
                errors.append(f"节点 {node_id or '?'} 类型不受支持")
            if node.get("type") == "match":
                cases = node.get("config", {}).get("cases", {}) if isinstance(node.get("config"), dict) else {}
                if not isinstance(cases, dict) or len(cases) > MAX_MATCH_CASES:
                    errors.append(f"多分支节点 {node_id or '?'} 最多包含 {MAX_MATCH_CASES} 个分支")
        trigger_count = sum(1 for node in nodes if isinstance(node, dict) and node.get("type") == "trigger")
        if trigger_count != 1:
            errors.append("自动化必须且只能包含一个触发器节点")
        trigger_ids = {
            str(node.get("id")) for node in nodes if isinstance(node, dict) and node.get("type") == "trigger"
        }
        for edge in edges:
            if not isinstance(edge, dict) or str(edge.get("source")) not in node_ids or str(edge.get("target")) not in node_ids:
                errors.append("连接引用了不存在的节点")
                continue
            if str(edge.get("target")) in trigger_ids:
                errors.append("触发器是执行起点，不能连接上游输入")
            target_port = edge.get("target_port")
            if target_port is not None and (not isinstance(target_port, str) or not target_port.startswith("/")):
                errors.append("设置输入端口必须是以 / 开头的路径")
        return {"valid": not errors, "errors": errors}

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "run": copy.deepcopy(self._run),
                "events": list(self._events),
                "enabled_count": sum(1 for item in self._automations if item.get("enabled")),
                "total_count": len(self._automations),
                "queued_count": len(self._pending_runs),
            }

    def run(self, automation_id: str, variables: dict[str, Any] | None = None, trigger: str = "manual") -> dict[str, Any]:
        document = self.get(automation_id)
        if not self._execution_lock.acquire(blocking=False):
            raise RuntimeError("已有自动化正在执行")
        run_id = uuid.uuid4().hex
        self._cancel_event.clear()
        with self._lock:
            self._run = self._empty_run()
            self._run.update(
                id=run_id,
                automation_id=document["id"],
                automation_name=document["name"],
                running=True,
                status="running",
                started_at=datetime.now().astimezone().isoformat(timespec="seconds"),
                variables=copy.deepcopy(variables or {}),
            )
        threading.Thread(
            target=self._execute,
            args=(document, variables or {}, trigger),
            name=f"automation-{automation_id[:8]}",
            daemon=True,
        ).start()
        return self.snapshot()

    def cancel(self) -> dict[str, Any]:
        self._cancel_event.set()
        return self.snapshot()

    def _event(self, level: str, message: str, node_id: str = "") -> None:
        entry = {
            "time": datetime.now().astimezone().isoformat(timespec="seconds"),
            "level": level,
            "message": str(message)[:1000],
            "node_id": node_id,
        }
        with self._lock:
            self._events.appendleft(entry)
        getattr(logger, level if level in {"debug", "info", "warning", "error"} else "info")(
            "Automation: {}", message
        )

    @staticmethod
    def _system_values() -> dict[str, Any]:
        now = datetime.now().astimezone()
        return {
            "datetime": now.isoformat(),
            "date": now.date().isoformat(),
            "time": now.strftime("%H:%M:%S"),
            "hour": now.hour,
            "minute": now.minute,
            "weekday": now.weekday(),
            "timestamp": now.timestamp(),
            "platform": platform.system().lower(),
        }

    def _evaluate(self, expression: Any, variables: dict[str, Any], depth: int = 0) -> Any:
        if depth > MAX_EXPRESSION_DEPTH:
            raise ValueError("表达式嵌套过深")
        if not isinstance(expression, dict):
            return expression
        kind = expression.get("type", "literal")
        if kind == "literal":
            return expression.get("value")
        if kind == "variable":
            return variables.get(str(expression.get("name") or ""), expression.get("default"))
        if kind == "system":
            return self._system_values().get(str(expression.get("name") or ""))
        if kind == "list":
            return [self._evaluate(item, variables, depth + 1) for item in expression.get("items", [])]
        if kind == "not":
            return not bool(self._evaluate(expression.get("value"), variables, depth + 1))
        if kind in {"all", "any"}:
            values = expression.get("values", [])
            evaluated = (bool(self._evaluate(item, variables, depth + 1)) for item in values)
            return all(evaluated) if kind == "all" else any(evaluated)
        if kind == "compare":
            left = self._evaluate(expression.get("left"), variables, depth + 1)
            right = self._evaluate(expression.get("right"), variables, depth + 1)
            operation = str(expression.get("operator") or "eq")
            if operation in {"eq", "ne", "gt", "gte", "lt", "lte"}:
                left, right = self._coerce_comparison_values(left, right)
            comparisons: dict[str, Callable[[Any, Any], bool]] = {
                "eq": operator.eq,
                "ne": operator.ne,
                "gt": operator.gt,
                "gte": operator.ge,
                "lt": operator.lt,
                "lte": operator.le,
                "contains": lambda a, b: b in a,
                "in": lambda a, b: a in b,
                "starts_with": lambda a, b: str(a).startswith(str(b)),
                "ends_with": lambda a, b: str(a).endswith(str(b)),
                "matches": lambda a, b: re.search(str(b), str(a)) is not None,
            }
            if operation not in comparisons:
                raise ValueError(f"不支持的比较操作：{operation}")
            return comparisons[operation](left, right)
        if kind == "call":
            name = str(expression.get("name") or "")
            args = [self._evaluate(item, variables, depth + 1) for item in expression.get("args", [])]
            functions: dict[str, Callable[..., Any]] = {
                "add": lambda *values: sum(values),
                "subtract": operator.sub,
                "multiply": lambda *values: math.prod(values),
                "divide": operator.truediv,
                "mod": operator.mod,
                "round": round,
                "min": min,
                "max": max,
                "abs": abs,
                "length": len,
                "lower": lambda value: str(value).lower(),
                "upper": lambda value: str(value).upper(),
                "concat": lambda *values: "".join(str(value) for value in values),
                "random": lambda low=0, high=1: random.uniform(float(low), float(high)),
                "random_int": lambda low, high: random.randint(int(low), int(high)),
            }
            if name not in functions:
                raise ValueError(f"不支持的函数：{name}")
            return functions[name](*args)
        raise ValueError(f"不支持的表达式类型：{kind}")

    @staticmethod
    def _coerce_comparison_values(left: Any, right: Any) -> tuple[Any, Any]:
        """Compare connected numbers with numeric text without changing normal text semantics."""
        if isinstance(left, bool) or isinstance(right, bool):
            return left, right

        def numeric(value: Any) -> int | float | None:
            if isinstance(value, (int, float)):
                return value
            if not isinstance(value, str):
                return None
            text = value.strip()
            if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", text):
                return None
            number = float(text)
            return int(number) if number.is_integer() else number

        numeric_left = numeric(left)
        numeric_right = numeric(right)
        if numeric_left is not None and numeric_right is not None:
            return numeric_left, numeric_right
        return left, right

    def _automation_data_directory(self, automation_id: str) -> Path:
        namespace = hashlib.sha256(automation_id.encode("utf-8")).hexdigest()[:32]
        directory = (self._data_root / namespace).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def _resolve_automation_path(self, automation_id: str, raw_path: Any) -> Path:
        value = str(raw_path or ".").strip()
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = self._automation_data_directory(automation_id) / path
        return path.resolve()

    @staticmethod
    def _bounded_text(value: Any, limit: int = MAX_FILE_BYTES) -> str:
        text = str(value if value is not None else "")
        if len(text.encode("utf-8")) > limit:
            raise ValueError(f"文本内容不能超过 {limit // 1024 // 1024} MiB")
        return text

    def _run_command(self, config: dict[str, Any], automation_id: str) -> dict[str, Any]:
        executable = str(config.get("executable") or "").strip()
        if not executable:
            raise ValueError("执行命令缺少可执行文件")
        raw_arguments = config.get("arguments", "")
        arguments = [str(item) for item in raw_arguments] if isinstance(raw_arguments, list) else shlex.split(str(raw_arguments), posix=sys.platform != "win32")
        working_directory = self._resolve_automation_path(automation_id, config.get("working_directory") or ".")
        if not working_directory.is_dir():
            raise FileNotFoundError(f"命令工作目录不存在：{working_directory}")
        timeout = max(1.0, min(float(config.get("timeout_seconds", 60)), 3600.0))
        process = subprocess.Popen(
            [executable, *arguments],
            cwd=working_directory,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            shell=False,
        )
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            if self._cancel_event.wait(0.05) or self._stop_event.is_set():
                process.terminate()
                with contextlib.suppress(subprocess.TimeoutExpired):
                    process.wait(timeout=2)
                if process.poll() is None:
                    process.kill()
                raise AutomationCancelledError()
            if time.monotonic() >= deadline:
                process.kill()
                process.wait()
                raise TimeoutError(f"命令执行超过 {timeout:g} 秒")
        stdout, stderr = process.communicate()
        if len(stdout) > MAX_COMMAND_OUTPUT_BYTES or len(stderr) > MAX_COMMAND_OUTPUT_BYTES:
            raise ValueError("命令输出超过 1 MiB 限制")
        result = {
            "returncode": process.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
        }
        if process.returncode != 0 and bool(config.get("check", True)):
            raise RuntimeError(result["stderr"].strip() or f"命令退出码：{process.returncode}")
        return result

    @staticmethod
    def _open_target(kind: str, target: str) -> None:
        if not target:
            raise ValueError("打开目标不能为空")
        if kind == "url" or (kind == "auto" and re.match(r"^https?://", target, re.IGNORECASE)):
            if not re.match(r"^https?://", target, re.IGNORECASE):
                raise ValueError("仅允许打开 HTTP 或 HTTPS 链接")
            if not webbrowser.open(target):
                raise RuntimeError("系统未能打开链接")
            return
        path = Path(target).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"目标不存在：{path}")
        if sys.platform == "win32":
            os.startfile(str(path))
        elif sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=True, timeout=15)
        else:
            subprocess.run(["xdg-open", str(path)], check=True, timeout=15)

    @staticmethod
    def _perform_system_action(action: str) -> None:
        commands: dict[str, dict[str, list[str]]] = {
            "win32": {
                "shutdown": ["shutdown", "/s", "/t", "0"],
                "restart": ["shutdown", "/r", "/t", "0"],
                "logout": ["shutdown", "/l"],
                "sleep": ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"],
            },
            "darwin": {
                "shutdown": ["osascript", "-e", 'tell application "System Events" to shut down'],
                "restart": ["osascript", "-e", 'tell application "System Events" to restart'],
                "logout": ["osascript", "-e", 'tell application "System Events" to log out'],
                "sleep": ["pmset", "sleepnow"],
            },
            "linux": {
                "shutdown": ["systemctl", "poweroff"],
                "restart": ["systemctl", "reboot"],
                "logout": ["loginctl", "terminate-user", str(getattr(os, "getuid", lambda: 0)())],
                "sleep": ["systemctl", "suspend"],
            },
        }
        platform_key = "win32" if sys.platform == "win32" else "darwin" if sys.platform == "darwin" else "linux"
        command = commands[platform_key].get(action)
        if command is None:
            raise ValueError(f"不支持的系统操作：{action}")
        subprocess.Popen(command, shell=False, close_fds=sys.platform != "win32")

    @staticmethod
    def _set_config_pointer(config: dict[str, Any], pointer: str, value: Any) -> None:
        if not pointer.startswith("/"):
            raise ValueError(f"设置输入端口无效：{pointer}")
        parts = [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]
        if not parts or any(not part for part in parts):
            raise ValueError(f"设置输入端口无效：{pointer}")
        current = config
        for part in parts[:-1]:
            child = current.get(part)
            if not isinstance(child, dict):
                child = {}
                current[part] = child
            current = child
        current[parts[-1]] = value

    @staticmethod
    def _selected_edges(edges: list[dict[str, Any]], source: str, port: str, legacy_fallback: bool = False) -> list[dict[str, Any]]:
        outgoing = [edge for edge in edges if str(edge.get("source")) == source]
        exact = [edge for edge in outgoing if str(edge.get("source_port") or "default") == port]
        if exact or port == "default" or not legacy_fallback:
            return exact
        return [edge for edge in outgoing if str(edge.get("source_port") or "default") == "default"]

    def _execute(self, document: dict[str, Any], initial_variables: dict[str, Any], trigger: str) -> None:
        status = "completed"
        error = ""
        variables = copy.deepcopy(initial_variables)
        variables.update({"trigger": trigger, "automation_id": document["id"]})
        try:
            nodes = {str(node["id"]): node for node in document.get("nodes", [])}
            edges = document.get("edges", [])
            trigger_nodes = [
                node for node in nodes.values()
                if node.get("type") == "trigger" and str(node.get("config", {}).get("kind", "manual")) == trigger
            ]
            if not trigger_nodes:
                trigger_nodes = [node for node in nodes.values() if node.get("type") == "trigger"]
            if not trigger_nodes:
                raise ValueError("未找到可执行的触发器节点")
            queue: deque[tuple[str, Any, bool, dict[str, Any]]] = deque(
                [(str(trigger_nodes[0]["id"]), None, False, {})]
            )
            loop_state: dict[str, dict[str, Any]] = {}
            while queue:
                if self._cancel_event.is_set() or self._stop_event.is_set():
                    raise AutomationCancelledError()
                current_id, current_value, legacy_input, overrides = queue.popleft()
                with self._lock:
                    steps = int(self._run["steps"])
                    if steps >= MAX_EXECUTION_STEPS:
                        raise RuntimeError("执行步数超过安全上限，可能存在无限循环")
                    steps += 1
                    self._run.update(
                        current_node_id=current_id,
                        steps=steps,
                        variables=copy.deepcopy(variables),
                    )
                if len(queue) > MAX_EXECUTION_STEPS - steps:
                    raise RuntimeError("执行步数超过安全上限，可能存在无限循环")
                node = nodes.get(current_id)
                if node is None:
                    raise ValueError(f"节点不存在：{current_id}")
                node_type = str(node.get("type"))
                raw_config = node.get("config", {}) if isinstance(node.get("config"), dict) else {}
                config = copy.deepcopy(raw_config)
                for pointer, raw_value in overrides.items():
                    normalized = self._normalize_setting_input(node_type, pointer, raw_value, config)
                    self._set_config_pointer(config, pointer, normalized)
                next_port = "default"
                passthrough_value = current_value
                if node_type == "trigger":
                    pass
                elif node_type == "condition":
                    expression = config.get("expression", True)
                    if legacy_input and current_value is not None and isinstance(expression, dict):
                        expression = copy.deepcopy(expression)
                        expression["left"] = {"type": "literal", "value": current_value}
                    next_port = "true" if bool(self._evaluate(expression, variables)) else "false"
                elif node_type == "match":
                    match_value = current_value if legacy_input and current_value is not None else self._evaluate(config.get("value"), variables)
                    next_port = "default"
                    cases = config.get("cases", {})
                    for case_id, case in (cases.items() if isinstance(cases, dict) else []):
                        if not isinstance(case, dict):
                            continue
                        expression = {
                            "type": "compare",
                            "operator": case.get("operator", "eq"),
                            "left": {"type": "literal", "value": match_value},
                            "right": {"type": "literal", "value": case.get("value")},
                        }
                        if self._evaluate(expression, variables):
                            next_port = f"case:{case_id}"
                            break
                    current_value = match_value
                elif node_type == "loop":
                    state = loop_state.get(current_id)
                    if state is None:
                        mode = str(config.get("mode") or "count")
                        if mode == "while":
                            state = {"mode": mode, "index": 0, "max": max(1, min(int(config.get("max_iterations", 1000)), 10_000))}
                        else:
                            source = current_value if legacy_input else self._evaluate(config.get("items"), variables)
                            if mode == "count":
                                count = max(0, min(int(self._evaluate(config.get("count", 1), variables)), 10_000))
                                source = list(range(count))
                            elif isinstance(source, str):
                                source = [item.strip() for item in source.split(",") if item.strip()]
                            elif not isinstance(source, (list, tuple)):
                                source = []
                            state = {"mode": mode, "items": list(source)[:10_000], "index": 0}
                        loop_state[current_id] = state
                    index = int(state["index"])
                    if state["mode"] == "while":
                        should_continue = index < int(state["max"]) and bool(self._evaluate(config.get("condition", True), variables))
                        item = index
                    else:
                        items = state["items"]
                        should_continue = index < len(items)
                        item = items[index] if should_continue else None
                    if should_continue:
                        variables[str(config.get("item_variable") or "item")] = item
                        variables[str(config.get("index_variable") or "index")] = index
                        state["index"] = index + 1
                        current_value = item
                        next_port = "body"
                    else:
                        loop_state.pop(current_id, None)
                        current_value = passthrough_value
                        next_port = "done"
                elif node_type == "set_variable":
                    name = str(config.get("name") or "").strip()
                    if not name:
                        raise ValueError("变量节点缺少变量名")
                    variables[name] = self._evaluate(config.get("value"), variables)
                    current_value = variables[name]
                elif node_type == "function":
                    name = str(config.get("result_variable") or "result")
                    variables[name] = self._evaluate(
                        {"type": "call", "name": config.get("name"), "args": config.get("args", [])}, variables
                    )
                    current_value = variables[name]
                elif node_type == "calculate":
                    operation_name = str(config.get("operation") or "add")
                    left = self._evaluate(config.get("left", 0), variables)
                    right = self._evaluate(config.get("right", 0), variables)
                    operations: dict[str, Callable[[Any, Any], Any]] = {
                        "add": operator.add,
                        "subtract": operator.sub,
                        "multiply": operator.mul,
                        "divide": operator.truediv,
                        "mod": operator.mod,
                        "power": operator.pow,
                        "min": min,
                        "max": max,
                    }
                    if operation_name not in operations:
                        raise ValueError(f"不支持的计算操作：{operation_name}")
                    current_value = operations[operation_name](left, right)
                    if isinstance(current_value, float) and not math.isfinite(current_value):
                        raise ValueError("计算结果不是有限数值")
                    result_name = str(config.get("result_variable") or "result")
                    variables[result_name] = current_value
                elif node_type == "wait":
                    seconds = float(self._evaluate(config.get("seconds", 1), variables))
                    if self._cancel_event.wait(max(0.0, min(seconds, 86400.0))):
                        raise AutomationCancelledError()
                elif node_type == "fetch_resource":
                    result = self._fetch_resource(config, {
                        "automation_id": str(document["id"]),
                        "node_id": current_id,
                        "data_directory": str(self._automation_data_directory(str(document["id"]))),
                    })
                    if not result.get("success") or not result.get("path"):
                        raise RuntimeError(str(result.get("error") or "获取壁纸资源失败"))
                    current_value = str(result["path"])
                    variables["resource"] = copy.deepcopy(result.get("item") or {})
                    variables["resource_path"] = current_value
                elif node_type == "local_file":
                    path = Path(str(config.get("path") or "")).expanduser().resolve()
                    if not path.is_file():
                        raise FileNotFoundError(f"本地图片不存在：{path}")
                    if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".avif"}:
                        raise ValueError("本地文件节点仅支持图片")
                    current_value = str(path)
                    variables["resource_path"] = current_value
                elif node_type == "data_directory":
                    current_value = str(self._automation_data_directory(str(document["id"])))
                elif node_type == "read_file":
                    selected_path = config.get("path") or current_value
                    path = self._resolve_automation_path(str(document["id"]), selected_path)
                    if not path.is_file():
                        raise FileNotFoundError(f"文本文件不存在：{path}")
                    if path.stat().st_size > MAX_FILE_BYTES:
                        raise ValueError("读取文件不能超过 4 MiB")
                    current_value = path.read_text(encoding=str(config.get("encoding") or "utf-8"), errors=str(config.get("errors") or "strict"))
                    variables[str(config.get("result_variable") or "file_content")] = current_value
                elif node_type == "write_file":
                    path = self._resolve_automation_path(str(document["id"]), config.get("path"))
                    content = current_value if legacy_input and current_value is not None else self._evaluate(config.get("content", ""), variables)
                    text = self._bounded_text(content)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    action = str(config.get("action") or "write")
                    if action == "append":
                        with path.open("a", encoding=str(config.get("encoding") or "utf-8")) as handle:
                            handle.write(text)
                    elif action == "create":
                        with path.open("x", encoding=str(config.get("encoding") or "utf-8")) as handle:
                            handle.write(text)
                    else:
                        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
                        try:
                            temporary.write_text(text, encoding=str(config.get("encoding") or "utf-8"))
                            os.replace(temporary, path)
                        finally:
                            temporary.unlink(missing_ok=True)
                    current_value = str(path)
                elif node_type == "delete_file":
                    selected_path = config.get("path") or current_value
                    path = self._resolve_automation_path(str(document["id"]), selected_path)
                    if path.is_dir():
                        if any(path.iterdir()):
                            raise ValueError("仅允许删除空文件夹")
                        path.rmdir()
                    else:
                        path.unlink(missing_ok=bool(config.get("missing_ok", False)))
                    current_value = str(path)
                elif node_type == "list_directory":
                    selected_path = config.get("path") or current_value
                    path = self._resolve_automation_path(str(document["id"]), selected_path)
                    if not path.is_dir():
                        raise NotADirectoryError(f"文件夹不存在：{path}")
                    pattern = str(config.get("pattern") or "*")
                    iterator = path.rglob(pattern) if bool(config.get("recursive", False)) else path.glob(pattern)
                    entries: list[dict[str, Any]] = []
                    for entry in iterator:
                        if len(entries) >= MAX_DIRECTORY_ENTRIES:
                            break
                        if entry.is_symlink():
                            continue
                        is_directory = entry.is_dir()
                        if is_directory and not bool(config.get("include_directories", True)):
                            continue
                        if not is_directory and not bool(config.get("include_files", True)):
                            continue
                        stat = entry.stat()
                        entries.append({
                            "name": entry.name,
                            "path": str(entry),
                            "relative_path": str(entry.relative_to(path)),
                            "type": "directory" if is_directory else "file",
                            "size": 0 if is_directory else stat.st_size,
                            "modified_at": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds"),
                        })
                    current_value = sorted(entries, key=lambda item: str(item["relative_path"]).casefold())
                    variables[str(config.get("result_variable") or "entries")] = current_value
                elif node_type == "datetime":
                    raw_value = current_value if legacy_input and isinstance(current_value, (str, int, float)) and current_value != "" else config.get("value")
                    zone = UTC if str(config.get("timezone") or "local") == "utc" else None
                    if raw_value is None or raw_value == "":
                        value = datetime.now(zone).astimezone() if zone is None else datetime.now(zone)
                    elif isinstance(raw_value, (int, float)):
                        value = datetime.fromtimestamp(float(raw_value), tz=zone).astimezone() if zone is None else datetime.fromtimestamp(float(raw_value), tz=zone)
                    else:
                        value = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
                        value = value.astimezone(zone) if zone is not None else value.astimezone()
                    current_value = value.strftime(str(config.get("format") or "%Y-%m-%d %H:%M:%S"))
                    variables[str(config.get("result_variable") or "datetime")] = current_value
                elif node_type == "notification":
                    if self._notify is None:
                        raise RuntimeError("当前环境不支持系统通知")
                    self._notify(
                        self._bounded_text(self._evaluate(config.get("title", "小树壁纸"), variables), 2000)[:100],
                        self._bounded_text(self._evaluate(config.get("message", current_value), variables), 100_000)[:1000],
                    )
                elif node_type == "command":
                    current_value = self._run_command(config, str(document["id"]))
                    variables[str(config.get("result_variable") or "command_result")] = current_value
                elif node_type == "open_target":
                    target = current_value if legacy_input else self._evaluate(config.get("target", ""), variables)
                    self._open_target(str(config.get("kind") or "auto"), str(target or ""))
                    current_value = target
                elif node_type == "system_action":
                    delay = max(0.0, min(float(config.get("delay_seconds", 0)), 3600.0))
                    if delay and self._cancel_event.wait(delay):
                        raise AutomationCancelledError()
                    self._perform_system_action(str(config.get("action") or "sleep"))
                elif node_type == "set_wallpaper":
                    configured_path = config.get("path")
                    selected_path = current_value if legacy_input else configured_path
                    if not isinstance(selected_path, str) or not selected_path.strip():
                        raise RuntimeError("设置壁纸节点需要连接图片路径或选择回退文件")
                    result = self._set_wallpaper(selected_path)
                    if not result.get("success"):
                        raise RuntimeError(str(result.get("error") or "设置壁纸失败"))
                    current_value = selected_path
                elif node_type == "dynamic_wallpaper":
                    action = str(config.get("action") or "play")
                    if self._manage_dynamic_wallpaper is not None:
                        result = self._manage_dynamic_wallpaper(config)
                        current_value = result.get("type") if action == "get_type" else result
                        result_variable = str(config.get("result_variable") or "")
                        if result_variable:
                            variables[result_variable] = current_value
                    elif action == "start":
                        path = str(self._evaluate(config.get("path", ""), variables) or "")
                        self._start_dynamic_wallpaper(
                            path,
                            bool(config.get("muted", True)),
                            bool(config.get("loop", True)),
                            float(config.get("playback_rate", 1.0)),
                        )
                    elif action == "stop":
                        self._stop_dynamic_wallpaper()
                    else:
                        self._control_dynamic_wallpaper(action)
                elif node_type == "log":
                    self._event(str(config.get("level") or "info"), self._evaluate(config.get("message", ""), variables), current_id)
                elif node_type == "stop":
                    continue

                selected_edges = self._selected_edges(edges, current_id, next_port, legacy_fallback=node_type == "condition")
                grouped: dict[str, list[dict[str, Any]]] = {}
                for edge in selected_edges:
                    grouped.setdefault(str(edge.get("target") or ""), []).append(edge)
                for target_id, target_edges in grouped.items():
                    if not target_id:
                        continue
                    target_overrides: dict[str, Any] = {}
                    target_legacy_input = False
                    for edge in target_edges:
                        target_port = edge.get("target_port")
                        if target_port is None or str(target_port) == "":
                            target_legacy_input = True
                        else:
                            target_overrides[str(target_port)] = copy.deepcopy(current_value)
                    queue.append(
                        (
                            target_id,
                            copy.deepcopy(current_value),
                            target_legacy_input,
                            target_overrides,
                        )
                    )
        except AutomationCancelledError:
            status = "cancelled"
            self._event("warning", f"自动化已取消：{document['name']}")
        except Exception as exc:
            status = "failed"
            error = str(exc)
            self._event("error", f"自动化执行失败：{document['name']}：{exc}")
        else:
            self._event("info", f"自动化执行完成：{document['name']}")
        finally:
            with self._lock:
                self._run.update(
                    running=False,
                    status=status,
                    current_node_id="",
                    finished_at=datetime.now().astimezone().isoformat(timespec="seconds"),
                    error=error,
                    variables=copy.deepcopy(variables),
                )
            self._execution_lock.release()
            self._wake_event.set()

    def _scheduler_loop(self) -> None:
        startup_pending = True
        while not self._stop_event.is_set():
            now = datetime.now().astimezone()
            with self._lock:
                documents = copy.deepcopy(self._automations)
            for document in documents:
                try:
                    if not document.get("enabled"):
                        continue
                    for node in document.get("nodes", []):
                        if node.get("type") != "trigger":
                            continue
                        config = node.get("config", {})
                        kind = str(config.get("kind") or "manual")
                        key = f"{document['id']}:{node.get('id')}"
                        due = False
                        if kind == "startup" and startup_pending:
                            due = True
                        elif kind == "interval":
                            seconds = max(1.0, float(config.get("seconds", 60)))
                            due = time.monotonic() >= self._schedule_state.get(key, 0.0)
                            if due:
                                self._schedule_state[key] = time.monotonic() + seconds
                        elif kind == "schedule":
                            weekdays = config.get("weekdays", list(range(7)))
                            scheduled_time = str(config.get("time") or "00:00")
                            stamp = now.strftime("%Y-%m-%d %H:%M")
                            due = now.weekday() in weekdays and now.strftime("%H:%M") == scheduled_time and self._schedule_state.get(key) != stamp
                            if due:
                                self._schedule_state[key] = stamp
                        if due:
                            pending_key = f"{key}:{kind}"
                            with self._lock:
                                if pending_key not in self._pending_run_keys:
                                    self._pending_runs.append((document["id"], kind, pending_key))
                                    self._pending_run_keys.add(pending_key)
                            break
                except Exception as exc:
                    self._event("error", f"自动化调度配置无效：{document.get('name', document.get('id', '?'))}：{exc}")
            startup_pending = False
            if not self._execution_lock.locked():
                with self._lock:
                    pending = self._pending_runs[0] if self._pending_runs else None
                if pending is not None:
                    try:
                        self.run(pending[0], trigger=pending[1])
                    except RuntimeError:
                        pass
                    except Exception as exc:
                        self._event("error", f"自动化排队执行失败：{pending[0]}：{exc}")
                        with self._lock:
                            if self._pending_runs and self._pending_runs[0] == pending:
                                self._pending_runs.popleft()
                                self._pending_run_keys.discard(pending[2])
                    else:
                        with self._lock:
                            if self._pending_runs and self._pending_runs[0] == pending:
                                self._pending_runs.popleft()
                                self._pending_run_keys.discard(pending[2])
            self._wake_event.wait(1.0)
            self._wake_event.clear()

    def shutdown(self) -> None:
        self._stop_event.set()
        self._cancel_event.set()
        self._wake_event.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=3.0)
