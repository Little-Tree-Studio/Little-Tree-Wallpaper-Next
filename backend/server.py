"""FastAPI backend server.

Serves the built frontend (single origin) and exposes a JSON-RPC dispatcher that
delegates to the existing :class:`BackendAPI`. The server is intended to run on
``127.0.0.1`` only and is gated by a per-session secret token, so it is never
reachable from the network.

Security notes
--------------
* Bind the underlying server to ``127.0.0.1`` (done in ``main.py``).
* A Host-header allow-list (loopback only) blocks DNS-rebinding attacks.
* Every ``/api/*`` route is protected by a constant-time token comparison.
* RPC dispatch only exposes public, callable members of the API object;
  private members, service objects and the token setter are blocked.
* Docs/OpenAPI endpoints are disabled to avoid leaking the surface area.
"""

from __future__ import annotations

import hmac
import json
import time
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

# API members that must never be callable over RPC even though they are public.
# * service objects -> would bypass the intended API surface
# * set_api_token   -> could change the preview-URL token (integrity/DoS) and is
#                      only meant to be called by the launcher at startup
# * internal helpers (safe_roots / is_path_safe / serve_image_bytes) -> not part
#                      of the public contract; served via dedicated endpoints
_BLOCKED_MEMBERS = frozenset(
    {
        "store",
        "bing_service",
        "spotlight_service",
        "sniff_service",
        "im_service",
        "ltws_service",
        "set_api_token",
        "safe_roots",
        "is_path_safe",
        "serve_image_bytes",
    }
)

_MAX_BODY_BYTES = 16 * 1024 * 1024  # 16 MiB guard for RPC payloads

# RPC methods that must not themselves produce log entries. Inspecting the logs
# (e.g. the stats/count shown on the Help page) would otherwise inflate its own
# numbers on every refresh, since each call is logged by the middleware and the
# RPC dispatcher.
_QUIET_RPC_METHODS = frozenset({"get_log_stats", "get_debug_log"})


def _rpc_method_from_path(path: str) -> str | None:
    """Return the RPC method name for a ``/api/rpc/{method}`` path, else None."""
    prefix = "/api/rpc/"
    return path[len(prefix):] if path.startswith(prefix) else None


def _token_matches(supplied: str | None, expected: str) -> bool:
    """Constant-time comparison so token checks are not timing-leaky."""
    if not supplied:
        return False
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def _verify_token_factory(expected_token: str):
    async def _verify_token(request: Request) -> None:
        supplied = request.headers.get("x-api-token") or request.query_params.get("token")
        client = request.client.host if request.client else "unknown"
        if not _token_matches(supplied, expected_token):
            logger.warning("Unauthorized API access attempt from {} {} {}", client, request.method, request.url.path)
            raise HTTPException(status_code=401, detail="unauthorized")

    return _verify_token


def _log_level_for_status(status_code: int) -> str:
    """Map an HTTP status code to a loguru level.

    * 2xx/3xx -> INFO (normal operation)
    * 4xx     -> WARNING (client error: bad request, not found, unauthorized)
    * 5xx     -> ERROR (server error)
    """
    if status_code >= 500:
        return "ERROR"
    if status_code >= 400:
        return "WARNING"
    return "INFO"


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log every HTTP request with method, path, status code and duration.

    The level is chosen from the status code so that 4xx client errors (e.g. 404
    not found, 401 unauthorized) stand out from successful 2xx traffic.
    """

    async def dispatch(self, request: StarletteRequest, call_next):  # type: ignore[override]
        # Quiet RPC methods (log inspection) must not be access-logged, otherwise
        # every refresh would add entries and inflate the displayed count.
        quiet = _rpc_method_from_path(request.url.path) in _QUIET_RPC_METHODS
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except HTTPException as exc:
            # FastAPI raises these before a Response is built; log by status.
            if not quiet:
                duration_ms = (time.perf_counter() - start) * 1000
                logger.log(
                    _log_level_for_status(exc.status_code),
                    "{} {} -> {} ({:.1f}ms)",
                    request.method,
                    request.url.path,
                    exc.status_code,
                    duration_ms,
                )
            raise
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.exception("Request {} {} crashed after {:.1f}ms", request.method, request.url.path, duration_ms)
            raise
        if quiet:
            return response
        duration_ms = (time.perf_counter() - start) * 1000
        # Health checks are polled frequently; keep them at DEBUG.
        level = "DEBUG" if request.url.path == "/api/health" else _log_level_for_status(response.status_code)
        logger.log(
            level,
            "{} {} -> {} ({:.1f}ms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response


# Hostnames that may legitimately target this loopback-only server. pywebview
# loads the UI from ``http://127.0.0.1:<port>``, so every genuine request carries
# one of these as its Host header.
_ALLOWED_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _host_is_allowed(raw_host: str) -> bool:
    """True when ``raw_host`` is a loopback host, with or without a port.

    Handles IPv4 (``127.0.0.1:port``), bracketed IPv6 (``[::1]:port``) and bare
    hostnames (``localhost``).
    """
    host = raw_host.lower()
    return any(host == h or host.startswith(f"{h}:") or host.startswith(f"[{h}]") for h in _ALLOWED_HOSTS)


class HostCheckMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Host header is not a loopback address.

    The server is bound to 127.0.0.1, but that alone does not stop a remote web
    page from performing a DNS-rebinding attack (resolving its own domain to
    127.0.0.1 and then issuing cross-origin requests from the user's browser).
    Enforcing that the Host header is loopback closes that vector even if a token
    were to leak.
    """

    async def dispatch(self, request: StarletteRequest, call_next):  # type: ignore[override]
        raw_host = request.headers.get("host", "")
        if not _host_is_allowed(raw_host):
            client = request.client.host if request.client else "unknown"
            logger.warning(
                "Rejected request with disallowed Host header {!r} from {} {} {}",
                raw_host,
                client,
                request.method,
                request.url.path,
            )
            return JSONResponse(status_code=403, content={"detail": "forbidden host"})
        return await call_next(request)


def _resolve_rpc_target(api: Any, method: str) -> Any:
    """Return the callable for ``method`` or raise a 404 if it is not exposed."""
    target = getattr(api, method, None)
    if not callable(target) or method.startswith("_") or method in _BLOCKED_MEMBERS:
        logger.warning("RPC rejected unknown/inaccessible method: {}", method)
        raise HTTPException(status_code=404, detail="method not found")
    return target


def create_app(api: Any, token: str, frontend_dir: Path) -> FastAPI:
    """Build the FastAPI application.

    Args:
        api: BackendAPI instance whose public methods become RPC targets.
        token: Per-session secret token used to authorize API calls.
        frontend_dir: Directory containing the built frontend (``index.html``).
    """
    app = FastAPI(
        title="Little Tree Wallpaper",
        version="2.0.0",
        # Disable auto docs so the API surface is not discoverable.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    # Register HostCheck first so RequestLogging wraps it (added next) and still
    # logs the 403 responses produced by rejected Host headers.
    app.add_middleware(HostCheckMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    verify_token = _verify_token_factory(token)

    @app.on_event("startup")
    async def _on_startup() -> None:  # pragma: no cover - lifecycle hook
        logger.info("FastAPI backend started (serving frontend from {})", frontend_dir)

    @app.on_event("shutdown")
    async def _on_shutdown() -> None:  # pragma: no cover - lifecycle hook
        logger.info("FastAPI backend shutting down")

    @app.get("/api/health")
    async def health(_: None = Depends(verify_token)) -> dict[str, Any]:
        return {"ok": True}

    @app.post("/api/rpc/{method}")
    async def rpc(method: str, request: Request, _: None = Depends(verify_token)) -> Any:
        target = _resolve_rpc_target(api, method)

        raw = await request.body()
        if len(raw) > _MAX_BODY_BYTES:
            logger.warning("RPC {} rejected oversized body ({} bytes)", method, len(raw))
            raise HTTPException(status_code=413, detail="request body too large")

        args: list[Any] = []
        if raw:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="invalid json body") from None
            if isinstance(payload, dict):
                args = payload.get("args") or []
            elif isinstance(payload, list):
                args = payload
        if not isinstance(args, list):
            raise HTTPException(status_code=400, detail="args must be a list")

        if method not in _QUIET_RPC_METHODS:
            logger.debug("RPC {} called with {} argument(s)", method, len(args))
        # BackendAPI methods are synchronous (requests/file IO). Run them in the
        # Starlette threadpool so the event loop is never blocked.
        try:
            result = await run_in_threadpool(target, *args)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any backend error to the client
            logger.exception("RPC '{}' raised an exception", method)
            return JSONResponse(
                status_code=500,
                content={"error": {"message": str(exc), "type": type(exc).__name__}},
            )
        if method not in _QUIET_RPC_METHODS:
            logger.debug("RPC {} completed", method)
        return {"result": result}

    @app.get("/api/preview")
    async def preview(
        path: str,
        max: int | None = None,
        _: None = Depends(verify_token),
    ) -> Response:
        """Stream a local image (optionally a resized thumbnail) as raw bytes.

        Replaces the previous base64 data-URL preview approach: images are now
        served directly so they can be cached and streamed efficiently.
        """
        # Clamp the thumbnail size to a sane range.
        max_size = max if (isinstance(max, int) and 16 <= max <= 4096) else None
        served = await run_in_threadpool(api.serve_image_bytes, path, max_size)
        if served is None:
            raise HTTPException(status_code=404, detail="image not available")
        data, content_type = served
        # Thumbnails are cheap to regenerate but originals can be cached briefly.
        return Response(
            content=data,
            media_type=content_type,
            headers={"Cache-Control": "private, max-age=600"},
        )

    @app.post("/api/save-download")
    async def save_download(
        filename: str,
        request: Request,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Persist a raw binary upload into the downloads directory."""
        body = await request.body()
        if len(body) > _MAX_BODY_BYTES:
            logger.warning("save-download rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        saved_path = await run_in_threadpool(api.save_blob_to_downloads, body, filename)
        if not saved_path:
            raise HTTPException(status_code=500, detail="save failed")
        logger.info("Saved download to {}", saved_path)
        return {"path": saved_path}

    @app.post("/api/save-as")
    async def save_as(
        filename: str,
        request: Request,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Prompt for a save location and persist a raw binary upload there.

        Returns ``{"path": null}`` when the user cancels the dialog.
        """
        body = await request.body()
        if len(body) > _MAX_BODY_BYTES:
            logger.warning("save-as rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        saved_path = await run_in_threadpool(api.save_blob_as, body, filename)
        if saved_path:
            logger.info("Saved file as {}", saved_path)
        return {"path": saved_path}

    @app.post("/api/copy-image")
    async def copy_image(
        request: Request,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Copy a raw binary image upload to the system clipboard."""
        body = await request.body()
        if len(body) > _MAX_BODY_BYTES:
            logger.warning("copy-image rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        ok = await run_in_threadpool(api.copy_image_to_clipboard, body)
        return {"ok": ok}

    # Serve the built frontend last so /api/* routes always take precedence.
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
    return app
