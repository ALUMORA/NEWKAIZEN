#!/usr/bin/env python3
"""Levanta el backend servido desde fixtures grabados: red bloqueada y reloj congelado.

Sirve para grabar fixtures deterministas del navegador y para probar el frontend sin red.

    python scripts/run_replay_backend.py                       # backend.py viejo en :8190
    python scripts/run_replay_backend.py --port 8390 --set 2026-09-22
    python scripts/run_replay_backend.py --module kaizen_api.main   # paquete nuevo (ASGI ``app``)

El módulo se importa DESPUÉS de instalar el replay, así que también funciona si hace
``from yfinance import Ticker`` al importarse. Con un módulo que expone ``Handler``
(BaseHTTPRequestHandler) se usa ThreadingHTTPServer; con uno que expone ``app`` (ASGI) se usa
uvicorn. Una llamada sin grabar responde 500 con ``{"error": "ReplayMiss", "key": ...}``.
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.replay import (  # noqa: E402
    DEFAULT_SET,
    NetworkBlocked,
    ReplayMiss,
    ReplaySession,
    install_replay,
    load_module,
)

_REPLAY_ERRORS = (ReplayMiss, NetworkBlocked)


def _replay_error(exc: BaseException) -> BaseException | None:
    """Find a ReplayMiss/NetworkBlocked, also inside (Base)ExceptionGroups raised by task groups."""
    if isinstance(exc, _REPLAY_ERRORS):
        return exc
    if isinstance(exc, BaseExceptionGroup):
        for inner in exc.exceptions:
            found = _replay_error(inner)
            if found is not None:
                return found
    return None


def _error_body(exc: BaseException) -> bytes:
    return json.dumps(
        {"error": type(exc).__name__, "detail": str(exc), "key": getattr(exc, "key", None)}, ensure_ascii=False
    ).encode("utf-8")


def wrap_handler(handler_cls: type[BaseHTTPRequestHandler]) -> type[BaseHTTPRequestHandler]:
    class ReplayHandler(handler_cls):  # type: ignore[misc, valid-type]
        def _guarded(self, method: str) -> None:
            try:
                getattr(super(), method)()
            except BaseException as exc:
                found = _replay_error(exc)
                if found is None:
                    raise
                print(f"[replay] {found}", file=sys.stderr, flush=True)
                body = _error_body(found)
                self.send_response(500)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            self._guarded("do_GET")

        def do_POST(self) -> None:  # noqa: N802
            self._guarded("do_POST")

    ReplayHandler.__name__ = f"Replay{handler_cls.__name__}"
    return ReplayHandler


class ReplayMissASGI:
    """ASGI wrapper that turns ReplayMiss/NetworkBlocked into a 500 JSON response."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        started = False

        async def _send(message: dict) -> None:
            nonlocal started
            if message.get("type") == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except BaseException as exc:
            found = _replay_error(exc)
            if found is None or scope.get("type") != "http" or started:
                raise
            print(f"[replay] {found}", file=sys.stderr, flush=True)
            body = _error_body(found)
            await send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [(b"content-type", b"application/json"), (b"access-control-allow-origin", b"*")],
                }
            )
            await send({"type": "http.response.body", "body": body})


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128


def make_http_server(module: Any, host: str, port: int) -> ThreadingHTTPServer:
    handler = getattr(module, "Handler", None)
    if not (isinstance(handler, type) and issubclass(handler, BaseHTTPRequestHandler)):
        raise TypeError(f"{module.__name__} no expone un Handler(BaseHTTPRequestHandler)")
    return _Server((host, port), wrap_handler(handler))


def start(module_name: str, set_name: str, **replay_kwargs: Any) -> tuple[ReplaySession, Any]:
    """Install replay, then import the module (order matters for ``from yfinance import ...``)."""
    session = install_replay(set_name, **replay_kwargs)
    try:
        module = load_module(module_name)
    except BaseException:
        session.uninstall()
        raise
    return session, module


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--module", default="backend", help="módulo con Handler (viejo) o app ASGI (nuevo)")
    parser.add_argument("--set", default=DEFAULT_SET, help="set grabado en tests/fixtures/recorded/")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8190)
    parser.add_argument("--no-freeze", action="store_true", help="no congelar el reloj")
    args = parser.parse_args()

    session, module = start(args.module, args.set, freeze_time=not args.no_freeze)
    banner = (
        f"[replay] {args.module} en http://{args.host}:{args.port} set={args.set} "
        f"frozen_at={session.store.frozen_at} red=bloqueada"
    )
    try:
        if getattr(module, "Handler", None) is not None:
            server = make_http_server(module, args.host, args.port)

            def _stop(*_: Any) -> None:
                threading.Thread(target=server.shutdown, daemon=True).start()

            signal.signal(signal.SIGTERM, _stop)
            signal.signal(signal.SIGINT, _stop)
            print(banner, flush=True)
            server.serve_forever()
            server.server_close()
        elif getattr(module, "app", None) is not None:
            import uvicorn

            print(banner, flush=True)
            uvicorn.run(ReplayMissASGI(module.app), host=args.host, port=args.port, log_level="warning")
        else:
            print(f"{args.module} no expone Handler ni app", file=sys.stderr)
            return 2
    finally:
        if session.misses:
            print(f"[replay] {len(session.misses)} llamadas sin grabar: {session.misses[:20]}", file=sys.stderr)
        session.uninstall()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
