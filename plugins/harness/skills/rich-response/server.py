#!/usr/bin/env python3
"""Persistent LAN/Tailscale document server and loopback-only publisher."""

from __future__ import annotations

import argparse
import hashlib
import html
import ipaddress
import json
import os
import re
import socket
import signal
import secrets
import shutil
import tempfile
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
VERSION = 4
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


def tailscale_base_from_status(status: object, preferences: object) -> str:
    """Parse the installed CLI's self identity, without guessing a machine name."""
    if not isinstance(status, dict) or status.get("BackendState") != "Running":
        raise ValueError("Tailscale is not running")
    if not isinstance(preferences, dict) or not isinstance(preferences.get("shields-up"), bool):
        raise ValueError("could not verify Tailscale incoming-connection preferences")
    if preferences["shields-up"]:
        raise ValueError("incoming Tailscale connections are blocked (shields-up is enabled); "
                         "the host's Allow incoming connections setting must be enabled for phone access")
    own = status.get("Self")
    if not isinstance(own, dict):
        raise ValueError("Tailscale self identity is missing")
    name = own.get("DNSName")
    if not isinstance(name, str):
        raise ValueError("Tailscale DNS name is missing")
    name = name.rstrip(".")
    label = r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    if not re.fullmatch(rf"{label}(?:\.{label})+", name):
        raise ValueError("Tailscale DNS name is invalid")
    addresses = own.get("TailscaleIPs")
    if not isinstance(addresses, list) or not any(
        isinstance(value, str) and ipaddress.ip_address(value).version == 4
        for value in addresses
    ):
        raise ValueError("Tailscale has no IPv4 address for this server")
    return f"http://{name}:{PORT}"


def discover_tailscale() -> tuple[str | None, str | None]:
    """Read and probe only; never configure Serve, Funnel, DNS or tailnet policy."""
    executable = shutil.which("tailscale")
    if executable is None:
        return None, "tailscale CLI is not installed"
    try:
        result = subprocess.run(
            [executable, "status", "--json", "--peers=false"],
            capture_output=True, text=True, check=True, timeout=3,
        )
        preferences = subprocess.run(
            [executable, "get", "--json", "shields-up"],
            capture_output=True, text=True, check=True, timeout=3,
        )
        base = tailscale_base_from_status(json.loads(result.stdout), json.loads(preferences.stdout))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"{base}/api/health", timeout=2) as response:
            reached = json.load(response)
        if reached != {"service": SERVICE, "version": VERSION, "pid": os.getpid()}:
            raise ValueError("Tailscale URL did not reach this rich-response server")
        return base, None
    except subprocess.CalledProcessError as error:
        return None, f"Tailscale address check failed: {error.stderr.strip()}"
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        return None, str(error)


def document_urls(document_id: str, lan_host: str, tailscale_base: str | None) -> dict:
    path = f"/documents/{urllib.parse.quote(document_id)}"
    bases = {"local": f"http://localhost:{PORT}", "lan": f"http://{lan_host}:{PORT}",
             "tailscale": tailscale_base}
    return {key: (base + suffix if base else None)
            for prefix, base in bases.items()
            for key, suffix in ((f"{prefix}Url", path), (f"{prefix}HomeUrl", "/"))}


def document_title(source: str, document_id: str) -> str:
    match = re.search(r"<title\b[^>]*>(.*?)</title\s*>", source, re.IGNORECASE | re.DOTALL)
    return html.unescape(match[1]).strip() if match else document_id


def index_body(documents: list[dict]) -> str:
    body = '<p>Recent responses and questionnaires, newest first. Refresh to see new publications.</p>'
    if not documents:
        return body + '<p>No documents published yet.</p>'
    body += '<ul>'
    for document in documents:
        status = f'<br><small>{html.escape(document["status"])}</small>' if document["status"] else ""
        body += (f'<li><p><a href="/documents/{urllib.parse.quote(document["id"], safe="")}">'
                 f'{html.escape(document["title"])}</a>{status}</p></li>')
    return body + '</ul>'


def index_page() -> bytes:
    documents = []
    paths = sorted(DOCUMENT_DIR.glob("*.html"), key=lambda path: path.stat().st_mtime_ns, reverse=True)
    for path in paths[:20]:
        status = ""
        if re.fullmatch(r"questionnaire-[a-f0-9]{32}", path.stem):
            directory = STATE_DIR / "questionnaires" / path.stem.removeprefix("questionnaire-")
            if (directory / "questionnaire.json").is_file():
                status = "Answers submitted" if (directory / "answers.md").exists() else "Awaiting answers"
        documents.append({"id": path.stem, "title": document_title(path.read_text(encoding="utf-8"), path.stem),
                          "status": status})
    template = Path(__file__).with_name("template.html").read_text(encoding="utf-8")
    return template.replace("{{TITLE}}", "Rich responses").replace("{{BODY}}", index_body(documents)).encode()


def json_bytes(value: object) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode()


class DocumentServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    server_version = "rich-response/4"

    def send_bytes(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: HTTPStatus, value: object) -> None:
        self.send_bytes(status, json_bytes(value), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path == "/":
            self.send_bytes(HTTPStatus.OK, index_page(), "text/html; charset=utf-8")
            return
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

    def submit_answers(self, path: str) -> None:
        from questionnaire import QUESTIONNAIRE_DIR, answer_markdown

        parts = path.split("/")
        if len(parts) != 5 or not re.fullmatch(r"[a-f0-9]{32}", parts[3]):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "questionnaire not found"})
            return
        directory = QUESTIONNAIRE_DIR / parts[3]
        try:
            metadata = json.loads((directory / "questionnaire.json").read_text())
        except FileNotFoundError:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "questionnaire not found"})
            return
        if not secrets.compare_digest(parts[4], metadata["token"]):
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "invalid submission capability"})
            return
        # JSON plus a capability prevents unrelated sites from posting HTML forms here.
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "send application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
            if not 0 < length <= 65536:
                raise ValueError("answers must be between 1 and 65536 bytes")
            markdown = answer_markdown(metadata, json.loads(self.rfile.read(length)))
        except (ValueError, UnicodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        target = directory / "answers.md"
        try:
            # Link a complete file into place once: simultaneous submissions cannot overwrite it.
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as pending:
                temporary = Path(pending.name)
                try:
                    pending.write(markdown)
                    pending.flush()
                    os.fsync(pending.fileno())
                    try:
                        os.link(temporary, target)
                    except FileExistsError:
                        if target.read_text(encoding="utf-8") != markdown:
                            self.send_json(HTTPStatus.CONFLICT, {"error": "answers were already submitted; ask for a fresh questionnaire to change them"})
                            return
                finally:
                    temporary.unlink(missing_ok=True)
        except OSError:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "could not save answers; retry submission"})
            return
        self.send_json(HTTPStatus.OK, {"saved": True})

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/api/answers/"):
            self.submit_answers(path)
            return
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

        tailscale_base, tailscale_reason = discover_tailscale()
        self.send_json(
            HTTPStatus.OK,
            {"id": document_id, **document_urls(document_id, lan_ip(), tailscale_base),
             "tailscaleUnavailableReason": tailscale_reason},
        )

    def log_message(self, format: str, *args: object) -> None:
        message = "answer submission" if self.path.startswith("/api/answers/") else format % args
        sys.stderr.write(f"{self.address_string()} - {message}\n")


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
        if state.get("version") != VERSION:
            raise RuntimeError(f"server version {state.get('version')} is running; run: python3 {Path(__file__).resolve()} restart")
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
        if state and state.get("service") == SERVICE and state.get("version") == VERSION:
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


def publish(path_value: str, open_browser: bool = True) -> dict:
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
    with urllib.request.urlopen(request, timeout=10) as response:
        result = json.load(response)

    local_url = result["localUrl"]
    lan_url = result["lanUrl"]
    if open_browser:
        subprocess.run(["open", local_url], check=False)
    print(f"serving locally: {local_url}", file=sys.stderr)
    print(f"serving on LAN: {lan_url}", file=sys.stderr)
    if result["tailscaleUrl"]:
        print(f"serving on Tailscale: {result['tailscaleUrl']}", file=sys.stderr)
        print(f"bookmark on Tailscale: {result['tailscaleHomeUrl']}", file=sys.stderr)
    else:
        print(f"Tailscale unavailable: {result['tailscaleUnavailableReason']}", file=sys.stderr)
    return {key: value for key, value in result.items() if key != "id"}


def run_server() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)
    httpd = DocumentServer((HOST, PORT), Handler)
    own_pid = str(os.getpid())
    PID_PATH.write_text(f"{own_pid}\n")
    try:
        httpd.serve_forever()
    finally:
        try:
            if PID_PATH.read_text().strip() == own_pid:
                PID_PATH.unlink()
        except FileNotFoundError:
            pass


def restart_server() -> None:
    state = health()
    if state is None or state.get("service") != SERVICE:
        raise RuntimeError("restart requires a responding rich-response service")
    pid = state["pid"]
    if not isinstance(pid, int) or pid <= 1 or PID_PATH.read_text().strip() != str(pid):
        raise RuntimeError("server PID does not match its state file; refusing restart")
    import shlex
    command = subprocess.check_output(["ps", "-p", str(pid), "-o", "command="], text=True)
    argv = shlex.split(command)
    if len(argv) < 3 or Path(argv[-2]).name != "server.py" or argv[-1] != "run":
        raise RuntimeError("PID is not a rich-response server process; refusing restart")
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 5
    while port_is_open() and time.monotonic() < deadline:
        time.sleep(0.05)
    start_server()
    print(f"rich-response server version {VERSION} ready")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("run")
    subparsers.add_parser("restart", help="restart the identified rich-response service, preserving documents and answers")
    publish_parser = subparsers.add_parser("publish")
    publish_parser.add_argument("file")
    args = parser.parse_args()

    if args.command == "run":
        run_server()
    elif args.command == "restart":
        restart_server()
    else:
        publish(args.file)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        raise SystemExit(f"rich-response: {error}") from error
