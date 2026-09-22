#!/usr/bin/env python3
"""Levanta el API (kaizen_api, FastAPI) servido desde fixtures grabados: red bloqueada y reloj congelado.

Sirve para grabar fixtures deterministas del navegador y para probar el frontend sin red.

    python scripts/run_replay_backend.py                          # kaizen_api.main en :8190
    python scripts/run_replay_backend.py --port 8101 --set 2026-09-22
    python scripts/run_replay_backend.py --set 2026-09-22,2026-09-22-b2a   # capas: gana la primera que tenga la llamada
    USERS='{"demo":"demo"}' python scripts/run_replay_backend.py  # con un usuario de prueba

``--set`` acepta uno o varios sets separados por coma, en orden de búsqueda (el mismo formato que
``KAIZEN_REPLAY_SET``, que es el valor por omisión si está definido). Todos tienen que existir.

El módulo se importa DESPUÉS de instalar el replay y debe exponer una app ASGI ``app`` (el paquete la
arma con ``create_app()`` al pedirla). La configuración sale del entorno igual que en producción
(``kaizen_api/settings.py``); fuera de producción las rutas v1 quedan montadas. Una llamada sin
grabar responde 500 con ``{"error": "ReplayMiss", "key": ...}``.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kaizen_api.providers.replay import install_replay  # noqa: E402
from tests.replay import (  # noqa: E402
    DEFAULT_SET,
    FixtureSetError,
    NetworkBlocked,
    ReplayMiss,
    ReplaySession,
    load_module,
)

DEFAULT_MODULE = "kaizen_api.main"
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


def start(module_name: str, set_name: str, **replay_kwargs: Any) -> tuple[ReplaySession, Any]:
    """Install replay, then import the module (order matters for ``from yfinance import ...``)."""
    session = install_replay(set_name, **replay_kwargs)
    try:
        module = load_module(module_name)
    except BaseException:
        session.uninstall()
        raise
    return session, module


def asgi_app(module: Any) -> Any:
    app = getattr(module, "app", None)
    if app is None:
        raise TypeError(f"{module.__name__} no expone una app ASGI 'app'")
    return ReplayMissASGI(app)


class ServerThread:
    """uvicorn en un hilo, para pruebas: ``with ServerThread(app) as base_url: ...``."""

    def __init__(self, app: Any, host: str = "127.0.0.1", port: int = 0):
        import uvicorn

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((host, port))
        self.host, self.port = self.sock.getsockname()[:2]
        config = uvicorn.Config(app, log_level="warning", access_log=False, lifespan="off")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, kwargs={"sockets": [self.sock]}, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def __enter__(self) -> str:
        self.thread.start()
        for _ in range(500):
            if self.server.started:
                return self.base_url
            self.thread.join(0.01)
        raise RuntimeError("uvicorn no arrancó")

    def __exit__(self, *exc: Any) -> None:
        self.server.should_exit = True
        self.thread.join(10)
        self.sock.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--module", default=DEFAULT_MODULE, help="módulo con la app ASGI 'app'")
    parser.add_argument(
        "--set",
        default=os.environ.get("KAIZEN_REPLAY_SET") or DEFAULT_SET,
        help="set grabado en tests/fixtures/recorded/, o varios separados por coma en orden de búsqueda "
        "(p. ej. 2026-09-22,2026-09-22-b2a); por omisión KAIZEN_REPLAY_SET o " + DEFAULT_SET,
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8190)
    parser.add_argument("--no-freeze", action="store_true", help="no congelar el reloj")
    args = parser.parse_args()

    try:
        session, module = start(args.module, args.set, freeze_time=not args.no_freeze)
    except (FileNotFoundError, FixtureSetError) as exc:
        print(f"[replay] {exc}", file=sys.stderr)
        return 2
    banner = (
        f"[replay] {args.module} en http://{args.host}:{args.port} set={session.set_name} "
        f"frozen_at={session.store.frozen_at} red=bloqueada"
    )
    try:
        try:
            app = asgi_app(module)
        except TypeError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        import uvicorn

        print(banner, flush=True)
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)
    finally:
        if session.misses:
            print(f"[replay] {len(session.misses)} llamadas sin grabar: {session.misses[:20]}", file=sys.stderr)
        session.uninstall()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
