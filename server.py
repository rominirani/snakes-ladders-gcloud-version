#!/usr/bin/env python3
"""Preview & Hardened Cloud Run server for Snakes & Ladders: Cloud Architect Edition.

Security & Cost-Protection Controls:
1. Local testing binds strictly to 127.0.0.1:8765 (mandatory-secure-web-skills).
2. In Cloud Run (K_SERVICE set or --cloud-run), pre-loads and pre-compresses
   (gzip level 9) the 3 static assets once at startup (zero per-request CPU
   compression overhead) and serves strong SHA-256 ETags (304 Not Modified).
3. Memory-bounded per-IP rate limiter (using rightmost Google-Front-End-appended
   X-Forwarded-For IP on Cloud Run): max 60 asset requests/min per IP, max 4,096
   tracked IPs per minute bucket to prevent OOM exhaustion.
4. Global hourly outbound bandwidth circuit breaker: caps total served bytes
   across all IPs combined to 150 MiB/hour (~6,000 full gzipped game loads/hour,
   worst-case egress < $0.02/hour).

TODO(security): User authentication, session cookies, and CSRF tokens are
omitted because this server serves only static public game assets over GET/HEAD
with all state-changing HTTP methods rejected (405).
"""

import gzip
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import sys
import threading
import time
from typing import NamedTuple
from urllib.parse import urlparse

LOCAL_HOST = "127.0.0.1"
LOCAL_DEFAULT_PORT = 8765
WEB_ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
PACKS_ROOT = os.path.realpath(os.path.join(WEB_ROOT, "packs"))

# Rate-limit & Denials-of-Wallet guardrails (Cloud Run mode)
PER_IP_LIMIT_PER_MINUTE = 60
MAX_TRACKED_IPS_PER_MINUTE = 4096
MAX_HOURLY_EGRESS_BYTES = 150 * 1024 * 1024  # 150 MiB/hour hard cap

ALLOWED_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/scenarios.js": ("scenarios.js", "application/javascript; charset=utf-8"),
    "/game.js": ("game.js", "application/javascript; charset=utf-8"),
}

CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "font-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'none'; "
    "frame-ancestors 'self';"
)


class CachedAsset(NamedTuple):
    raw: bytes
    gzipped: bytes
    etag: str
    content_type: str


class TrafficGuard:
    """Thread-safe, O(1), memory-bounded per-IP limiter & hourly egress breaker."""

    def __init__(
        self,
        per_ip_per_min: int = PER_IP_LIMIT_PER_MINUTE,
        max_ips: int = MAX_TRACKED_IPS_PER_MINUTE,
        max_hourly_bytes: int = MAX_HOURLY_EGRESS_BYTES,
    ) -> None:
        self._per_ip_per_min = per_ip_per_min
        self._max_ips = max_ips
        self._max_hourly_bytes = max_hourly_bytes
        self._lock = threading.Lock()
        self._minute_bucket = -1
        self._ip_counts: dict[str, int] = {}
        self._hour_bucket = -1
        self._hourly_bytes = 0

    def check_request(self, client_ip: str, now_mono: float | None = None) -> tuple[int, str]:
        """Returns (200, '') if allowed, or (status_code, reason) if throttled."""
        now = time.monotonic() if now_mono is None else now_mono
        minute = int(now // 60)
        hour = int(now // 3600)

        with self._lock:
            if minute != self._minute_bucket:
                self._minute_bucket = minute
                self._ip_counts.clear()

            if hour != self._hour_bucket:
                self._hour_bucket = hour
                self._hourly_bytes = 0

            if self._hourly_bytes >= self._max_hourly_bytes:
                return (503, "Hourly bandwidth guardrail reached. Please try again shortly.")

            current = self._ip_counts.get(client_ip, 0)
            if current == 0 and len(self._ip_counts) >= self._max_ips:
                return (429, "Server busy; rate limit active.")

            if current >= self._per_ip_per_min:
                return (429, "Rate limit exceeded. Please wait a minute.")

            self._ip_counts[client_ip] = current + 1
            return (200, "")

    def record_egress(self, num_bytes: int, now_mono: float | None = None) -> bool:
        """Reserves `num_bytes` from the hourly budget; returns False if exceeded."""
        now = time.monotonic() if now_mono is None else now_mono
        hour = int(now // 3600)
        with self._lock:
            if hour != self._hour_bucket:
                self._hour_bucket = hour
                self._hourly_bytes = 0
            if self._hourly_bytes + num_bytes > self._max_hourly_bytes:
                return False
            self._hourly_bytes += num_bytes
            return True


IN_CLOUD_RUN = False
ASSET_CACHE: dict[str, CachedAsset] = {}
TRAFFIC_GUARD = TrafficGuard()


def load_asset_from_disk(rel_name: str, content_type: str) -> CachedAsset | None:
    if rel_name.startswith("packs/"):
        safe_base = os.path.basename(rel_name)
        if not safe_base.endswith(".json"):
            return None
        resolved = os.path.realpath(os.path.join(PACKS_ROOT, safe_base))
        if not resolved.startswith(PACKS_ROOT + os.sep) or not os.path.isfile(resolved):
            return None
    else:
        safe_name = os.path.basename(rel_name)
        resolved = os.path.realpath(os.path.join(WEB_ROOT, safe_name))
        if not resolved.startswith(WEB_ROOT + os.sep) or not os.path.isfile(resolved):
            return None

    with open(resolved, "rb") as fh:
        raw = fh.read()
    digest = hashlib.sha256(raw).hexdigest()[:20]
    etag = f'"{digest}"'
    gzipped = gzip.compress(raw, compresslevel=9)
    return CachedAsset(raw=raw, gzipped=gzipped, etag=etag, content_type=content_type)


def warm_cloud_run_cache() -> None:
    if os.path.isdir(PACKS_ROOT):
        for fname in os.listdir(PACKS_ROOT):
            if fname.endswith(".json"):
                ALLOWED_FILES[f"/packs/{fname}"] = (f"packs/{fname}", "application/json; charset=utf-8")

    unique_files: dict[str, CachedAsset] = {}
    for route, (rel_name, ctype) in ALLOWED_FILES.items():
        if rel_name not in unique_files:
            loaded = load_asset_from_disk(rel_name, ctype)
            if loaded is None:
                raise RuntimeError(f"Missing required static asset: {rel_name}")
            unique_files[rel_name] = loaded
        ASSET_CACHE[route] = unique_files[rel_name]


class HardenedStaticHandler(BaseHTTPRequestHandler):
    """Serves allow-listed static assets with strict headers, gzip, ETag & rate caps."""

    server_version = "CloudArchitectGame/1.1"
    sys_version = ""

    def _client_ip(self) -> str:
        if IN_CLOUD_RUN:
            # Google Front End appends the true client IP at the end of X-Forwarded-For
            xff = self.headers.get("X-Forwarded-For", "")
            if xff:
                parts = [p.strip() for p in xff.split(",") if p.strip()]
                if parts:
                    return parts[-1][:64]
        return (self.client_address[0] if self.client_address else "unknown")[:64]

    def _send_security_headers(self, cache_header: str) -> None:
        self.send_header("Content-Security-Policy", CSP_POLICY)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cache-Control", cache_header)

    def _send_short_error(self, code: int, message: str, include_body: bool, retry_after: int = 0) -> None:
        body = message.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if retry_after > 0:
            self.send_header("Retry-After", str(retry_after))
        self._send_security_headers("no-store")
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def _serve_asset(self, include_body: bool) -> None:
        parsed_path = urlparse(self.path).path

        # Unthrottled readiness endpoint for Cloud Run health probes
        if parsed_path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "2")
            self._send_security_headers("no-store")
            self.end_headers()
            if include_body:
                self.wfile.write(b"ok")
            return

        if IN_CLOUD_RUN:
            status, reason = TRAFFIC_GUARD.check_request(self._client_ip())
            if status != 200:
                retry = 60 if status == 429 else 300
                self._send_short_error(status, reason, include_body, retry_after=retry)
                return

        entry = ALLOWED_FILES.get(parsed_path)
        if entry is None and parsed_path.startswith("/packs/") and parsed_path.endswith(".json"):
            safe_pack = os.path.basename(parsed_path)
            if safe_pack and "/" not in safe_pack and "\\" not in safe_pack:
                entry = (f"packs/{safe_pack}", "application/json; charset=utf-8")

        if entry is None:
            self._send_short_error(404, "Not Found", include_body)
            return

        if IN_CLOUD_RUN:
            asset = ASSET_CACHE.get(parsed_path)
            cache_ctrl = "public, max-age=3600"
        else:
            asset = load_asset_from_disk(entry[0], entry[1])
            cache_ctrl = "no-store"

        if asset is None:
            self._send_short_error(403, "Forbidden", include_body)
            return

        # Conditional ETag check -> 0-byte 304 Not Modified
        inm = self.headers.get("If-None-Match", "")
        if IN_CLOUD_RUN and asset.etag in inm:
            self.send_response(304)
            self.send_header("ETag", asset.etag)
            self.send_header("Vary", "Accept-Encoding")
            self._send_security_headers(cache_ctrl)
            self.end_headers()
            return

        accept_enc = self.headers.get("Accept-Encoding", "")
        use_gzip = "gzip" in accept_enc.lower()
        payload = asset.gzipped if use_gzip else asset.raw

        if IN_CLOUD_RUN and include_body:
            if not TRAFFIC_GUARD.record_egress(len(payload)):
                self._send_short_error(
                    503,
                    "Hourly bandwidth guardrail reached. Please try again shortly.",
                    include_body,
                    retry_after=300,
                )
                return

        self.send_response(200)
        self.send_header("Content-Type", asset.content_type)
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("ETag", asset.etag)
        self.send_header("Content-Length", str(len(payload)))
        self._send_security_headers(cache_ctrl)
        self.end_headers()
        if include_body:
            self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        self._serve_asset(include_body=True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._serve_asset(include_body=False)

    def _reject_method(self) -> None:
        self.send_response(405)
        self.send_header("Allow", "GET, HEAD")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self._send_security_headers("no-store")
        self.end_headers()

    do_POST = _reject_method  # noqa: N815
    do_PUT = _reject_method  # noqa: N815
    do_DELETE = _reject_method  # noqa: N815
    do_PATCH = _reject_method  # noqa: N815
    do_OPTIONS = _reject_method  # noqa: N815
    do_TRACE = _reject_method  # noqa: N815

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stdout.write(f"[http] {self.command} {urlparse(self.path).path}\n")
        sys.stdout.flush()


def resolve_bind_target(argv: list[str]) -> tuple[str, int, bool]:
    in_cloud_run = bool(os.environ.get("K_SERVICE")) or ("--cloud-run" in argv)
    if in_cloud_run:
        port = int(os.environ.get("PORT", "8080"))
        return ("", port, True)

    port = LOCAL_DEFAULT_PORT
    for arg in argv[1:]:
        if arg.isdigit():
            candidate = int(arg)
            if 1024 <= candidate <= 65535:
                port = candidate
                break
    return (LOCAL_HOST, port, False)


def main() -> None:
    global IN_CLOUD_RUN
    host, port, is_cr = resolve_bind_target(sys.argv)
    IN_CLOUD_RUN = is_cr
    if IN_CLOUD_RUN:
        warm_cloud_run_cache()

    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((host, port), HardenedStaticHandler)
    shown_host = host or "0.0.0.0 (Cloud Run hardened)"
    print(f"Serving Snakes & Ladders: Cloud Architect Edition at http://{shown_host}:{port}")
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
