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
import io
import ipaddress
import json
import socket
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from anyio import CapacityLimiter, to_thread
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from backend.app_meta import APP_NAME_EN, VERSION

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
        "cnu_service",
        "pexels_service",
        "pixivel_service",
        "spotlight_service",
        "sniff_service",
        "timeline_service",
        "dynamic_wallpaper_service",
        "automation_service",
        "im_service",
        "ltws_service",
        "theme_service",
        "plugin_manager",
        "set_api_token",
        "configure_dynamic_wallpaper_runtime",
        "shutdown_dynamic_wallpaper",
        "shutdown_automation",
        "start_automation_runtime",
        "update_dynamic_wallpaper_telemetry",
        "safe_roots",
        "is_path_safe",
        "serve_image_bytes",
        "resolve_plugin_asset",
        "resolve_dynamic_wallpaper_media",
    }
)

_MAX_BODY_BYTES = 16 * 1024 * 1024  # 16 MiB guard for RPC payloads
# 200 MiB cap for the /api/save-* image uploads. 8K JPEGs top out around 25 MiB
# so this leaves a comfortable margin without enabling truly unbounded writes.
_MAX_UPLOAD_BYTES = 200 * 1024 * 1024

# CNU CDN hostnames allowed for the /api/cnu-image proxy (SSRF guard).
_CNU_IMAGE_HOSTS = frozenset({"imgoss.cnu.cc", "img.cnu.cc"})

# Pixiv CDN hostnames allowed for the /api/pixiv-image proxy (SSRF guard).
_PIXIV_IMAGE_HOSTS = frozenset({"i.pximg.net", "i.pximg.org", "pximg.cocomi.eu.org", "i.yuki.sh"})

# Bounds for the general sniff-image proxy. The endpoint is authenticated, but
# it still must not become an unbounded memory sink or an SSRF primitive.
_SNIFF_IMAGE_MAX_BYTES = 64 * 1024 * 1024
_SNIFF_IMAGE_CONTENT_TYPES = frozenset(
    {
        "image/avif",
        "image/bmp",
        "image/gif",
        "image/vnd.microsoft.icon",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/webp",
        "image/x-icon",
    }
)

# Remote image fetching is synchronous and can wait on slow third-party hosts.
# Keep it out of the default AnyIO limiter used by RPC calls so settings and
# other control-plane requests remain responsive while a gallery is loading.
_IMAGE_PROXY_LIMITER = CapacityLimiter(8)

# Data-source RPCs can spend tens of seconds waiting on third-party services.
# Both RPC groups are independent from AnyIO's default limiter, which is used by
# local previews and file endpoints. A gallery therefore cannot consume the
# workers needed by settings/status RPCs at either layer.
_DATA_RPC_LIMITER = CapacityLimiter(12)
_CONTROL_RPC_LIMITER = CapacityLimiter(16)
_DATA_RPC_METHODS = frozenset(
    {
        "bootstrap",
        "download_file",
        "execute_intelligent_market_source",
        "execute_wallpaper_source",
        "get_automation_resource_catalog",
        "get_bing_wallpaper",
        "get_cnu_work",
        "get_hitokoto",
        "get_pixivel_work",
        "get_sentence",
        "get_spotlight_wallpapers",
        "list_intelligent_market_sources",
        "list_system_fonts",
        "list_timeline_topics",
        "query_bing",
        "query_cnu_selected",
        "query_cnu_works",
        "query_pixivel_ranking",
        "query_spotlight",
        "query_timeline_wallpapers",
        "search_baidu_images",
        "search_pexels_images",
        "search_pixiv_images",
        "sniff_images",
        "check_intelligent_market_sources_health",
    }
)


def _rpc_limiter_for_method(method: str) -> CapacityLimiter:
    """Keep data loading and control-plane RPCs on independent worker budgets."""
    return _DATA_RPC_LIMITER if method in _DATA_RPC_METHODS else _CONTROL_RPC_LIMITER


def _validate_public_http_url(value: str) -> tuple[str, str, int]:
    """Validate a remote URL before the backend makes an outbound request."""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise ValueError("remote URL is not allowed")
    host = parsed.hostname
    if not host:
        raise ValueError("remote URL has no hostname")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise ValueError("remote URL has an invalid port") from exc

    try:
        addresses = {
            ipaddress.ip_address(info[4][0]) for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        }
    except (OSError, ValueError) as exc:
        raise ValueError("remote URL hostname could not be resolved") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("remote URL resolves to a non-public address")
    return parsed.geturl(), host.lower(), port


def _validate_referer(value: str | None) -> str:
    """Accept only a bounded HTTP(S) Referer; never forward credentials."""
    referer = (value or "").strip()
    if not referer:
        return ""
    if len(referer) > 2048:
        raise ValueError("referer is too long")
    parsed = urlparse(referer)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or not parsed.hostname:
        raise ValueError("referer is not allowed")
    return referer


# RPC methods that must not themselves produce log entries. Inspecting the logs
# (e.g. the stats/count shown on the Help page) would otherwise inflate its own
# numbers on every refresh, since each call is logged by the middleware and the
# RPC dispatcher.
_QUIET_RPC_METHODS = frozenset({"get_log_stats", "get_debug_log"})


def _rpc_method_from_path(path: str) -> str | None:
    """Return the RPC method name for a ``/api/rpc/{method}`` path, else None."""
    prefix = "/api/rpc/"
    return path[len(prefix) :] if path.startswith(prefix) else None


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
        quiet = (
            _rpc_method_from_path(request.url.path) in _QUIET_RPC_METHODS
            or request.url.path == "/api/dynamic-wallpaper/telemetry"
        )
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
        title=APP_NAME_EN,
        version=VERSION,
        # Disable auto docs so the API surface is not discoverable.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    # Media URLs use localhost while RPC stays on 127.0.0.1. These are distinct
    # browser origins (and therefore distinct HTTP connection pools), but only
    # the loopback application origin may read responses across that boundary.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://127\.0\.0\.1(?::\d+)?$",
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["X-Api-Token"],
    )
    # Register HostCheck first so RequestLogging wraps it (added next) and still
    # logs the 403 responses produced by rejected Host headers.
    app.add_middleware(HostCheckMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    verify_token = _verify_token_factory(token)

    @app.on_event("startup")
    async def _on_startup() -> None:  # pragma: no cover - lifecycle hook
        result = await run_in_threadpool(api.plugin_manager.start_enabled)
        logger.info("Started {} enabled plugin(s)", len(result.get("plugins", [])))
        logger.info("FastAPI backend started (serving frontend from {})", frontend_dir)

    @app.on_event("shutdown")
    async def _on_shutdown() -> None:  # pragma: no cover - lifecycle hook
        await run_in_threadpool(api.plugin_manager.shutdown)
        logger.info("FastAPI backend shutting down")

    @app.get("/api/health")
    async def health(_: None = Depends(verify_token)) -> dict[str, Any]:
        return {"ok": True}

    @app.get("/api/dynamic-wallpaper/player")
    async def dynamic_wallpaper_player(
        muted: bool = True,
        loop: bool = True,
        rate: float = 1.0,
        revision: int = 0,
        _: None = Depends(verify_token),
    ) -> HTMLResponse:
        media_url = f"/api/dynamic-wallpaper/media?token={token}&revision={revision}"
        telemetry_url = f"/api/dynamic-wallpaper/telemetry?token={token}"
        safe_rate = max(0.25, min(4.0, float(rate)))
        muted_json = "true" if muted else "false"
        loop_json = "true" if loop else "false"
        html = f"""<!doctype html>
<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<style>html,body,video{{width:100%;height:100%;margin:0;background:#000;overflow:hidden}}video{{display:block;object-fit:cover}}</style>
</head><body><video id=\"wallpaper\" src={json.dumps(media_url)} autoplay playsinline></video>
<script>
const video=document.getElementById('wallpaper');
const telemetryUrl={json.dumps(telemetry_url)};
const revision={int(revision)};
let lastReport=0;
let fps=0;
let fpsSource='';
let frameCount=0;
let frameSampleStarted=performance.now();
let previousTotalFrames=0;
let previousFrameTime=performance.now();
function finite(value) {{ return Number.isFinite(value) ? value : 0; }}
function report(event, force=false) {{
  const now=Date.now();
  if (!force && now-lastReport < 750) return;
  lastReport=now;
  const quality=video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
  const ranges=video.buffered.length;
  const duration=finite(video.duration);
  const payload={{
    event, media_revision:revision, current_time:finite(video.currentTime), duration,
    progress:duration > 0 ? finite(video.currentTime)/duration : 0,
    paused:video.paused, ended:video.ended, seeking:video.seeking,
    ready_state:video.readyState, network_state:video.networkState,
    video_width:video.videoWidth, video_height:video.videoHeight,
    buffered_start:ranges ? finite(video.buffered.start(0)) : 0,
    buffered_end:ranges ? finite(video.buffered.end(ranges-1)) : 0,
    buffered_ranges:ranges, muted:video.muted, volume:video.volume, loop:video.loop,
    playback_rate:video.playbackRate,
    fps, fps_source:fpsSource,
    dropped_frames:quality ? quality.droppedVideoFrames : 0,
    total_frames:quality ? quality.totalVideoFrames : 0,
    error_code:video.error ? video.error.code : 0,
    error_message:video.error ? video.error.message : '',
    visibility:document.visibilityState
  }};
  fetch(telemetryUrl, {{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(payload),keepalive:true}}).catch(()=>{{}});
}}
for (const event of ['loadedmetadata','loadeddata','canplay','playing','pause','waiting','stalled','seeking','seeked','ended','error','emptied','ratechange','volumechange']) {{
  video.addEventListener(event, () => report(event, true));
}}
video.addEventListener('timeupdate', () => report('timeupdate'));
video.addEventListener('progress', () => report('progress'));
document.addEventListener('visibilitychange', () => report('visibilitychange', true));
window.__ltwPlayer={{
  play:()=>video.play(), pause:()=>video.pause(),
  reload:()=>{{video.load();return video.play();}}, snapshot:()=>{{report('snapshot',true);return true;}}
}};
if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {{
  fpsSource='requestVideoFrameCallback';
  const countFrame=(now)=>{{
    frameCount++;
    const elapsed=now-frameSampleStarted;
    if (elapsed >= 1000) {{ fps=frameCount*1000/elapsed; frameCount=0; frameSampleStarted=now; }}
    video.requestVideoFrameCallback(countFrame);
  }};
  video.requestVideoFrameCallback(countFrame);
}} else {{
  fpsSource='getVideoPlaybackQuality';
  setInterval(()=>{{
    const now=performance.now();
    const quality=video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    if (quality) {{
      const elapsed=now-previousFrameTime;
      fps=elapsed > 0 ? Math.max(0, quality.totalVideoFrames-previousTotalFrames)*1000/elapsed : 0;
      previousTotalFrames=quality.totalVideoFrames; previousFrameTime=now;
    }}
  }},1000);
}}
video.muted={muted_json}; video.loop={loop_json}; video.playbackRate={safe_rate};
video.play().catch(() => {{ video.muted=true; report('autoplay-muted',true); video.play().catch(()=>report('error',true)); }});
report('player-ready',true);
</script></body></html>"""
        return HTMLResponse(
            html,
            headers={
                "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'none'; media-src 'self'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
            },
        )

    @app.get("/api/dynamic-wallpaper/media")
    async def dynamic_wallpaper_media(revision: int = 0, _: None = Depends(verify_token)) -> FileResponse:
        resolved = await run_in_threadpool(api.resolve_dynamic_wallpaper_media, revision)
        if resolved is None:
            raise HTTPException(status_code=404, detail="dynamic wallpaper media not available")
        path, content_type = resolved
        return FileResponse(
            path,
            media_type=content_type,
            content_disposition_type="inline",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Wallpaper-Revision": str(revision),
            },
        )

    @app.post("/api/dynamic-wallpaper/telemetry")
    async def dynamic_wallpaper_telemetry(request: Request, _: None = Depends(verify_token)) -> dict[str, bool]:
        raw = await request.body()
        if len(raw) > 64 * 1024:
            raise HTTPException(status_code=413, detail="telemetry body too large")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="invalid telemetry json") from None
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="telemetry must be an object")
        await run_in_threadpool(api.update_dynamic_wallpaper_telemetry, payload)
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
        # BackendAPI methods are synchronous (requests/file IO). Keep slow data
        # loading on its own worker budget so control-plane RPC stays responsive.
        try:
            result = await to_thread.run_sync(target, *args, limiter=_rpc_limiter_for_method(method))
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

    @app.get("/api/plugin-assets/{plugin_id}/{asset_path:path}")
    async def plugin_asset(
        plugin_id: str,
        asset_path: str,
        _: None = Depends(verify_token),
    ) -> Response:
        resolved = await run_in_threadpool(api.resolve_plugin_asset, plugin_id, asset_path)
        if resolved is None:
            raise HTTPException(status_code=404, detail="plugin asset not available")
        data, content_type = resolved
        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/cnu-image")
    async def cnu_image(
        url: str,
        _: None = Depends(verify_token),
    ) -> Response:
        """Proxy a CNU CDN image so the webview can load it same-origin.

        The browser blocks cross-origin HTTP images from ``imgoss.cnu.cc``;
        this endpoint fetches with the correct Referer/UA and streams the
        bytes back, letting ``<img>`` and ``fetch()`` work transparently.
        """
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in ("http", "https") or host not in _CNU_IMAGE_HOSTS:
            raise HTTPException(status_code=403, detail="forbidden image source")

        def _fetch() -> tuple[bytes, str]:
            resp = requests.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LittleTreeWallpaperNext/2.0",
                    "Referer": "http://www.cnu.cc/",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
                timeout=30,
            )
            resp.raise_for_status()
            content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
            return resp.content, content_type or "image/jpeg"

        try:
            data, content_type = await to_thread.run_sync(_fetch, limiter=_IMAGE_PROXY_LIMITER)
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 502
            logger.warning("CNU image proxy upstream error {} for {}", status, url)
            raise HTTPException(status_code=502, detail=f"upstream returned {status}") from exc
        except Exception as exc:
            logger.warning("CNU image proxy failed for {}: {}", url, exc)
            raise HTTPException(status_code=502, detail="image fetch failed") from exc

        return Response(
            content=data,
            media_type=content_type,
            headers={"Cache-Control": "private, max-age=86400"},
        )

    @app.get("/api/sniff-image")
    async def sniff_image(
        url: str,
        referer: str | None = None,
        _: None = Depends(verify_token),
    ) -> Response:
        """Proxy a sniffed image with the source page's Referer.

        Browsers cannot set a cross-origin Referer for an image reliably, and
        they cannot fetch many hotlink-protected images because of CORS. This
        same-origin endpoint keeps the remote request server-side.
        """
        try:
            upstream_url, initial_host, _ = _validate_public_http_url(url)
            upstream_referer = _validate_referer(referer)
        except ValueError as exc:
            raise HTTPException(status_code=403, detail="forbidden image source") from exc

        def _fetch() -> tuple[bytes, str]:
            current_url = upstream_url
            visited: set[str] = set()
            try:
                configured_timeout = int(api.store.get("sniff.timeout_seconds", 40))
            except (TypeError, ValueError):
                configured_timeout = 40
            timeout_seconds = max(5, min(configured_timeout, 120))
            user_agent = str(api.store.get("sniff.user_agent", "Mozilla/5.0"))[:512]

            for _ in range(5):
                current_url, current_host, _ = _validate_public_http_url(current_url)
                if current_url in visited:
                    raise requests.RequestException("sniff image redirect loop detected")
                visited.add(current_url)

                headers = {
                    "User-Agent": user_agent,
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                }
                if upstream_referer:
                    headers["Referer"] = upstream_referer

                response = requests.get(
                    current_url,
                    headers=headers,
                    timeout=(min(10, timeout_seconds), timeout_seconds),
                    allow_redirects=False,
                    stream=True,
                )
                try:
                    if response.is_redirect or response.is_permanent_redirect:
                        location = response.headers.get("Location")
                        if not location:
                            raise requests.RequestException("sniff image redirect has no target")
                        current_url = urljoin(current_url, location)
                        continue

                    response.raise_for_status()
                    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                    if content_type == "image/jpg":
                        content_type = "image/jpeg"
                    generic_content_types = {"", "application/octet-stream", "binary/octet-stream"}
                    if content_type == "image/svg+xml" or (
                        content_type not in _SNIFF_IMAGE_CONTENT_TYPES and content_type not in generic_content_types
                    ):
                        raise requests.RequestException("sniff image upstream returned non-image content")

                    content_length = response.headers.get("Content-Length", "")
                    if content_length.isdigit() and int(content_length) > _SNIFF_IMAGE_MAX_BYTES:
                        raise requests.RequestException("sniff image is too large")

                    chunks: list[bytes] = []
                    received = 0
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        received += len(chunk)
                        if received > _SNIFF_IMAGE_MAX_BYTES:
                            raise requests.RequestException("sniff image is too large")
                        chunks.append(chunk)
                    if received == 0:
                        raise requests.RequestException("sniff image is empty")
                    data = b"".join(chunks)
                    if content_type in generic_content_types:
                        from PIL import Image

                        try:
                            with Image.open(io.BytesIO(data)) as image:
                                image_format = image.format or ""
                                image.verify()
                            content_type = Image.MIME.get(image_format, "")
                        except Exception as exc:
                            raise requests.RequestException("sniff image could not be decoded") from exc
                        if content_type not in _SNIFF_IMAGE_CONTENT_TYPES:
                            raise requests.RequestException("sniff image format is not supported")
                    return data, content_type
                finally:
                    response.close()

            raise requests.RequestException("too many sniff image redirects")

        try:
            data, content_type = await to_thread.run_sync(_fetch, limiter=_IMAGE_PROXY_LIMITER)
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 502
            logger.warning("Sniff image proxy upstream error {} for {}", status, initial_host)
            raise HTTPException(status_code=502, detail=f"upstream returned {status}") from exc
        except Exception as exc:
            logger.warning("Sniff image proxy failed for {}: {}", initial_host, exc)
            raise HTTPException(status_code=502, detail="image fetch failed") from exc

        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/pixiv-image")
    async def pixiv_image(
        url: str,
        _: None = Depends(verify_token),
    ) -> Response:
        """Proxy a Pixiv CDN image so the webview can load it same-origin.

        Pixiv's CDN blocks requests without a ``pixiv.net`` Referer; this
        endpoint fetches with the correct headers and streams the bytes back.
        """
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme not in ("http", "https") or host not in _PIXIV_IMAGE_HOSTS:
            raise HTTPException(status_code=403, detail="forbidden image source")

        upstream_url = url
        if host in {"i.pximg.net", "pximg.cocomi.eu.org"}:
            upstream_url = parsed._replace(scheme="https", netloc="i.yuki.sh").geturl()

        def _fetch() -> tuple[bytes, str]:
            current_url = upstream_url
            visited: set[str] = set()
            for _ in range(4):
                if current_url in visited:
                    raise requests.RequestException("Pixiv image redirect loop detected")
                visited.add(current_url)
                current_parsed = urlparse(current_url)
                current_host = (current_parsed.hostname or "").lower()
                if current_parsed.scheme not in ("http", "https") or current_host not in _PIXIV_IMAGE_HOSTS:
                    raise requests.RequestException("Pixiv image redirect target is not allowed")
                referer = (
                    "https://pxelk.cocomi.eu.org/"
                    if current_host in {"pximg.cocomi.eu.org", "i.yuki.sh"}
                    else "https://www.pixiv.net/"
                )
                resp = requests.get(
                    current_url,
                    headers={
                        "User-Agent": (
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        ),
                        "Referer": referer,
                        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    },
                    timeout=30,
                    allow_redirects=False,
                )
                if resp.is_redirect or resp.is_permanent_redirect:
                    location = resp.headers.get("Location")
                    resp.close()
                    if not location:
                        raise requests.RequestException("Pixiv image redirect has no target")
                    current_url = urljoin(current_url, location)
                    continue
                resp.raise_for_status()
                content_type = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if content_type not in {
                    "image/avif",
                    "image/bmp",
                    "image/gif",
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                }:
                    raise requests.RequestException("Pixiv image upstream returned non-image content")
                data = resp.content
                from PIL import Image

                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
                return data, content_type
            raise requests.RequestException("Too many Pixiv image redirects")

        try:
            data, content_type = await to_thread.run_sync(_fetch, limiter=_IMAGE_PROXY_LIMITER)
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 502
            logger.warning("Pixiv image proxy upstream error {} for {}", status, upstream_url)
            raise HTTPException(status_code=502, detail=f"upstream returned {status}") from exc
        except Exception as exc:
            logger.warning("Pixiv image proxy failed for {}: {}", upstream_url, exc)
            raise HTTPException(status_code=502, detail="image fetch failed") from exc

        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control": "private, max-age=86400",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.post("/api/save-download")
    async def save_download(
        filename: str,
        request: Request,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Persist a raw binary upload into the downloads directory.

        Uses its own (much larger) body cap so 4K/8K JPEGs can be uploaded
        without colliding with the RPC JSON envelope limit.
        """
        body = await request.body()
        if len(body) > _MAX_UPLOAD_BYTES:
            logger.warning("save-download rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        saved_path = await run_in_threadpool(api.save_blob_to_downloads, body, filename)
        if not saved_path:
            raise HTTPException(status_code=500, detail="save failed")
        logger.info("Saved download to {}", saved_path)
        return {"path": saved_path}

    @app.post("/api/save-generated")
    async def save_generated(
        filename: str,
        request: Request,
        meta: str | None = None,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Persist a generated image and register its generation record."""
        body = await request.body()
        if len(body) > _MAX_UPLOAD_BYTES:
            logger.warning("save-generated rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        meta_dict: dict[str, Any] | None = None
        if meta:
            try:
                parsed = json.loads(meta)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="invalid meta json") from None
            if not isinstance(parsed, dict):
                raise HTTPException(status_code=400, detail="meta must be an object")
            meta_dict = parsed
        record = await run_in_threadpool(api.save_generated_image, body, filename, meta_dict)
        if not record:
            raise HTTPException(status_code=500, detail="save failed")
        return {"record": record}

    @app.post("/api/save-as")
    async def save_as(
        filename: str,
        request: Request,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Prompt for a save location and persist a raw binary upload there.

        Uses its own body cap independent of the RPC envelope. Returns
        ``{"path": null}`` when the user cancels the dialog.
        """
        body = await request.body()
        if len(body) > _MAX_UPLOAD_BYTES:
            logger.warning("save-as rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        saved_path = await run_in_threadpool(api.save_blob_as, body, filename)
        if saved_path:
            logger.info("Saved file as {}", saved_path)
        return {"path": saved_path}

    @app.post("/api/save-file")
    async def save_file(
        path: str,
        request: Request,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Overwrite a file path returned by a previous save-as operation."""
        body = await request.body()
        if len(body) > _MAX_UPLOAD_BYTES:
            logger.warning("save-file rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        saved_path = await run_in_threadpool(api.save_blob_to_path, body, path)
        if not saved_path:
            raise HTTPException(status_code=500, detail="save failed")
        return {"path": saved_path}

    @app.post("/api/copy-image")
    async def copy_image(
        request: Request,
        _: None = Depends(verify_token),
    ) -> dict[str, Any]:
        """Copy a raw binary image upload to the system clipboard.

        Uses its own body cap independent of the RPC envelope.
        """
        body = await request.body()
        if len(body) > _MAX_UPLOAD_BYTES:
            logger.warning("copy-image rejected oversized body ({} bytes)", len(body))
            raise HTTPException(status_code=413, detail="request body too large")
        ok = await run_in_threadpool(api.copy_image_to_clipboard, body)
        return {"ok": ok}

    @app.get("/api/theme-media/{theme_id}/{role}")
    async def theme_media(
        theme_id: str,
        role: str,
        _: None = Depends(verify_token),
    ) -> FileResponse:
        resolved = await run_in_threadpool(api.theme_service.resolve_asset, theme_id, role)
        if resolved is None:
            raise HTTPException(status_code=404, detail="theme asset not available")
        path, content_type = resolved
        return FileResponse(
            path,
            media_type=content_type,
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/theme-preview/{preview_token}")
    async def theme_preview(
        preview_token: str,
        _: None = Depends(verify_token),
    ) -> FileResponse:
        resolved = await run_in_threadpool(api.theme_service.resolve_preview, preview_token)
        if resolved is None:
            raise HTTPException(status_code=404, detail="theme preview not available")
        path, content_type = resolved
        return FileResponse(
            path,
            media_type=content_type,
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    # Serve the built frontend last so /api/* routes always take precedence.
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
    return app
