#!/usr/bin/env python3
"""
星巢无限 · STARNEST ∞
本地预览服务器

只做一件事：安全地提供当前目录下的静态文件。
- 默认只绑定 127.0.0.1，不对局域网开放
- 传入 --lan 时绑定 0.0.0.0，供同一 Wi-Fi 下的其他设备访问
- 下发 CSP 与一组安全响应头
- 对 HTML/CSS/JS/SVG 按需 gzip，静态资源允许短期缓存
- 固定 MIME 类型，关闭目录列表
- 拒绝路径穿越、隐藏文件与非静态资源
- 每个 IP 每分钟最多 300 个请求

用法：
    python serve.py
    python serve.py 9000
    python serve.py 8765 --lan
    STARNEST_PORT=9000 python serve.py
"""

from __future__ import annotations

import gzip
import mimetypes
import os
import shutil
import socket
import sys
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("STARNEST_PORT", "8765"))
RATE_LIMIT = 300
RATE_WINDOW_SECONDS = 60
MAX_FILE_BYTES = 8 * 1024 * 1024

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)

ALLOWED_EXTENSIONS = {
    ".html",
    ".css",
    ".js",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
}

COMPRESSIBLE_EXTENSIONS = {".html", ".css", ".js", ".svg"}
CACHEABLE_EXTENSIONS = {
    ".css",
    ".js",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
}

MIME_OVERRIDES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}


class RateLimiter:
    """A tiny in-memory sliding-window limiter for a local preview server."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self.lock = threading.Lock()
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            bucket = self.hits[key]
            while bucket and now - bucket[0] > self.window:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(now)
            if len(self.hits) > 4096:
                stale = [ip for ip, q in self.hits.items() if not q or now - q[-1] > self.window]
                for ip in stale[:2048]:
                    self.hits.pop(ip, None)
            return True


LIMITER = RateLimiter(RATE_LIMIT, RATE_WINDOW_SECONDS)


def safe_log(value: str) -> str:
    """Strip control characters so a hostile request cannot forge log lines."""
    return "".join(ch for ch in value if ch >= " " and ch != "\x7f")[:500]


def resolve_request_path(raw_path: str) -> Path | None:
    """Map a URL path to a file inside ROOT, or return None."""
    try:
        path = unquote(urlsplit(raw_path).path, errors="strict")
    except (UnicodeDecodeError, ValueError):
        return None

    if "\x00" in path or "\\" in path:
        return None

    parts = [part for part in path.split("/") if part]
    if any(part in (".", "..") or part.startswith(".") for part in parts):
        return None

    if not parts:
        target = ROOT / "index.html"
    else:
        target = ROOT.joinpath(*parts)

    try:
        resolved = target.resolve(strict=True)
    except (OSError, RuntimeError):
        return None

    try:
        resolved.relative_to(ROOT)
    except ValueError:
        return None

    if resolved.is_dir() or not resolved.is_file():
        return None
    if resolved.suffix.lower() not in ALLOWED_EXTENSIONS:
        return None
    try:
        if resolved.stat().st_size > MAX_FILE_BYTES:
            return None
    except OSError:
        return None
    return resolved


class StarNestHandler(BaseHTTPRequestHandler):
    server_version = "StarNest/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def version_string(self) -> str:
        return self.server_version

    def log_message(self, fmt: str, *args) -> None:
        message = fmt % args
        sys.stderr.write(
            "%s  %s  %s\n"
            % (self.log_date_time_string(), safe_log(self.client_address[0]), safe_log(message))
        )

    def do_GET(self) -> None:  # noqa: N802
        self._handle(send_body=True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle(send_body=False)

    def do_POST(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_PUT(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_DELETE(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_PATCH(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def _security_headers(self, cache_control: str = "no-store, max-age=0") -> None:
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Permitted-Cross-Domain-Policies", "none")
        self.send_header("X-XSS-Protection", "0")
        self.send_header("Cache-Control", cache_control)
        self.send_header("Connection", "close")
        self.close_connection = True

    def _method_not_allowed(self) -> None:
        if not LIMITER.allow(self.client_address[0]):
            self._error(HTTPStatus.TOO_MANY_REQUESTS, "请求太频繁", "请稍等一分钟再试。")
            return
        self._error(
            HTTPStatus.METHOD_NOT_ALLOWED,
            "只支持 GET / HEAD",
            "这个本地预览服务器只提供静态文件，不接受写入请求。",
            extra_headers={"Allow": "GET, HEAD"},
        )

    def _handle(self, send_body: bool) -> None:
        if not LIMITER.allow(self.client_address[0]):
            self._error(HTTPStatus.TOO_MANY_REQUESTS, "请求太频繁", "请稍等一分钟再试。")
            return

        target = resolve_request_path(self.path)
        if target is None:
            self._error(HTTPStatus.NOT_FOUND, "没有找到这个页面", "检查地址，或回到首页重新开始。")
            return

        try:
            suffix = target.suffix.lower()
            size = target.stat().st_size
            content_type = MIME_OVERRIDES.get(suffix)
            if content_type is None:
                guessed, _ = mimetypes.guess_type(str(target))
                content_type = guessed or "application/octet-stream"
                if content_type.startswith("text/") and "charset=" not in content_type:
                    content_type += "; charset=utf-8"

            cache_control = (
                "public, max-age=3600"
                if suffix in CACHEABLE_EXTENSIONS
                else "no-cache"
            )
            payload: bytes | None = None
            compressed = False
            if send_body and suffix in COMPRESSIBLE_EXTENSIONS:
                payload = target.read_bytes()
                if "gzip" in self.headers.get("Accept-Encoding", "").lower():
                    payload = gzip.compress(payload, compresslevel=6, mtime=0)
                    compressed = True
                size = len(payload)

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(size))
            if compressed:
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
            self._security_headers(cache_control)
            self.end_headers()

            if send_body:
                if payload is not None:
                    self.wfile.write(payload)
                else:
                    with target.open("rb") as handle:
                        shutil.copyfileobj(handle, self.wfile, length=64 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            return
        except OSError:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "读取文件失败", "请确认文件存在且可读。")

    def _error(
        self,
        status: HTTPStatus,
        title: str,
        detail: str,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        body = (
            "<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>%d · 星巢无限</title>"
            "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;"
            "background:#f4f1e8;color:#101317;font-family:system-ui,'Microsoft YaHei',sans-serif}"
            "main{max-width:560px;padding:40px;border:1.5px solid #101317;border-radius:20px;"
            "background:#fffdf8;box-shadow:8px 8px 0 #c9f24d}h1{font-size:42px;line-height:1;"
            "letter-spacing:-.05em;margin:0 0 12px}p{color:#676b64;line-height:1.8}"
            "code{font-family:Consolas,monospace;font-size:12px;background:#eae5d8;padding:3px 7px;border-radius:5px}"
            "a{display:inline-block;margin-top:16px;padding:10px 18px;border:1.5px solid #101317;"
            "border-radius:999px;background:#c9f24d;color:#101317;font-weight:700;text-decoration:none}</style>"
            "<main><code>STARNEST / %d</code><h1>%s</h1><p>%s</p>"
            "<a href='/'>回到星巢首页</a></main></html>"
            % (status.value, status.value, title, detail)
        ).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass


class StarNestServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def local_ipv4_addresses() -> list[str]:
    """Best-effort list of non-loopback IPv4 addresses for the LAN banner."""
    addresses: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
            ip = info[4][0]
            if not ip.startswith(("127.", "169.254.")):
                addresses.add(ip)
    except OSError:
        pass

    def private(ip: str) -> bool:
        if ip.startswith("10.") or ip.startswith("192.168."):
            return True
        if ip.startswith("172."):
            try:
                return 16 <= int(ip.split(".")[1]) <= 31
            except (IndexError, ValueError):
                return False
        return False

    preferred = {ip for ip in addresses if private(ip)}
    return sorted(preferred or addresses)


def main() -> int:
    args = sys.argv[1:]
    lan = "--lan" in args
    args = [arg for arg in args if arg != "--lan"]
    host = "0.0.0.0" if lan else HOST

    port = PORT
    if args:
        try:
            port = int(args[0])
        except ValueError:
            print("端口必须是数字，例如：python serve.py 9000", file=sys.stderr)
            return 2

    if not (ROOT / "index.html").is_file():
        print("找不到 index.html。请在星巢项目目录中运行本脚本。", file=sys.stderr)
        return 1

    try:
        server = StarNestServer((host, port), StarNestHandler)
    except OSError as error:
        print("无法启动服务器：%s" % error, file=sys.stderr)
        print("可能端口已被占用。试试：python serve.py 9000", file=sys.stderr)
        return 1

    print("")
    print("  星巢无限 · STARNEST ∞")
    print("  http://127.0.0.1:%d/" % port)
    if lan:
        print("")
        print("  局域网分享已开启；同一 Wi-Fi 下的设备可访问：")
        addresses = local_ipv4_addresses()
        if addresses:
            for address in addresses:
                print("  http://%s:%d/" % (address, port))
        else:
            print("  未找到局域网 IPv4 地址，请运行 ipconfig 查看。")
        print("")
        print("  Windows 防火墙首次询问时，请勾选“专用网络”并允许访问。")
        print("  这台电脑需要保持开机，页面关闭后其他人将无法访问。")
        print("  不要把端口直接映射到公网；公网访问请使用静态托管或 HTTPS 隧道。")
    else:
        print("  仅绑定本机；按 Ctrl+C 停止。")
        print("  如需让同一 Wi-Fi 的其他设备访问：python serve.py %d --lan" % port)
    print("")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\n  已停止。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
