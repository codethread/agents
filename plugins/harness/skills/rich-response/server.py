#!/usr/bin/env python3
"""Persistent LAN document server and loopback-only publisher."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "0.0.0.0"
PORT = 8765
SERVICE = "rich-response"
VERSION = 1
STATE_DIR = Path("/tmp/rich-response-server")
DOCUMENT_DIR = STATE_DIR / "documents"
PID_PATH = STATE_DIR / "server.pid"
LOG_PATH = STATE_DIR / "server.log"
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
DOCUMENT_ID = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?")


def lan_ip() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.connect(("192.0.2.1", 80))
        return connection.getsockname()[0]


def document_urls(document_id: str) -> dict[str, str]:
    path = f"/documents/{urllib.parse.quote(document_id)}"
    return {
        "localUrl": f"http://localhost:{PORT}{path}",
        "lanUrl": f"http://{lan_ip()}:{PORT}{path}",
    }


def json_bytes(value: object) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode()


class DocumentServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    server_version = "rich-response/1"

    def send_bytes(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: HTTPStatus, value: object) -> None:
        self.send_bytes(status, json_bytes(value), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/health":
            self.send_json(
                HTTPStatus.OK,
                {"service": SERVICE, "version": VERSION, "pid": os.getpid()},
            )
            return

        prefix = "/documents/"
        if not path.startswith(prefix):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        document_id = urllib.parse.unquote(path[len(prefix) :])
        if not DOCUMENT_ID.fullmatch(document_id):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid document id"})
            return

        document_path = DOCUMENT_DIR / f"{document_id}.html"
        try:
            body = document_path.read_bytes()
        except FileNotFoundError:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "document not found"})
            return
        self.send_bytes(HTTPStatus.OK, body, "text/html; charset=utf-8")

    def do_POST(self) -> None:  # noqa: N802
        if self.client_address[0] != "127.0.0.1":
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "publishing is loopback-only"})
            return

        path = urllib.parse.urlsplit(self.path).path
        prefix = "/api/documents/"
        document_id = urllib.parse.unquote(path[len(prefix) :]) if path.startswith(prefix) else ""
        if not DOCUMENT_ID.fullmatch(document_id):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid document id"})
            return

        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_DOCUMENT_BYTES:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid document size"})
            return

        body = self.rfile.read(length)
        DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)
        target = DOCUMENT_DIR / f"{document_id}.html"
        temporary = target.with_suffix(f".html.{os.getpid()}.{threading_id()}.tmp")
        try:
            temporary.write_bytes(body)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

        self.send_json(
            HTTPStatus.OK,
            {"id": document_id, **document_urls(document_id)},
        )

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write(f"{self.address_string()} - {format % args}\n")


def threading_id() -> int:
    import threading

    return threading.get_ident()


def health() -> dict[str, object] | None:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{PORT}/api/health", timeout=0.5
        ) as response:
            return json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def port_is_open() -> bool:
    with socket.socket() as connection:
        return connection.connect_ex(("127.0.0.1", PORT)) == 0


def start_server() -> None:
    state = health()
    if state and state.get("service") == SERVICE:
        return
    if port_is_open():
        raise RuntimeError(f"port {PORT} is occupied by another service")

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("ab") as log:
        subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "run"],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
            close_fds=True,
        )

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = health()
        if state and state.get("service") == SERVICE:
            return
        time.sleep(0.05)

    if port_is_open():
        raise RuntimeError(f"port {PORT} became occupied by another service")
    raise RuntimeError(f"server failed to start; see {LOG_PATH}")


def slug_for(path: Path) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-") or "doc"
    if len(stem) <= 80 and DOCUMENT_ID.fullmatch(stem):
        return stem
    digest = hashlib.sha256(str(path).encode()).hexdigest()[:8]
    return f"{stem[:70].rstrip('-')}-{digest}"


def publish(path_value: str) -> None:
    path = Path(path_value).resolve()
    if not path.is_file():
        raise RuntimeError(f"file does not exist: {path}")

    start_server()
    document_id = slug_for(path)
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api/documents/{document_id}",
        data=path.read_bytes(),
        method="POST",
        headers={"Content-Type": "text/html; charset=utf-8"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        result = json.load(response)

    local_url = result["localUrl"]
    lan_url = result["lanUrl"]
    subprocess.run(["open", local_url], check=False)
    print(f"serving locally: {local_url}", file=sys.stderr)
    print(f"serving on LAN: {lan_url}", file=sys.stderr)


def run_server() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)
    own_pid = str(os.getpid())
    PID_PATH.write_text(f"{own_pid}\n")
    try:
        DocumentServer((HOST, PORT), Handler).serve_forever()
    finally:
        try:
            if PID_PATH.read_text().strip() == own_pid:
                PID_PATH.unlink()
        except FileNotFoundError:
            pass


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("run")
    publish_parser = subparsers.add_parser("publish")
    publish_parser.add_argument("file")
    args = parser.parse_args()

    if args.command == "run":
        run_server()
    else:
        publish(args.file)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        raise SystemExit(f"rich-response: {error}") from error
