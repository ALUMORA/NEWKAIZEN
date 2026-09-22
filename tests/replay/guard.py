"""Block real network access: Python sockets, DNS, and libcurl (curl_cffi, used by yfinance 1.x).

Loopback stays open so a replay server can be exercised from the same process. The error
derives from BaseException on purpose: the legacy backend wraps almost every upstream call in
``except Exception: pass`` and would otherwise swallow the violation silently.
"""

from __future__ import annotations

import ipaddress
import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager

_LOOPBACK_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", ""}


class NetworkBlocked(BaseException):  # noqa: N818 - name reads better in tracebacks
    """A real network call was attempted while the network guard was active."""


_lock = threading.Lock()
_depth = 0
_saved: dict[str, object] = {}
violations: list[str] = []


def _is_loopback_host(host: object) -> bool:
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode("ascii", "ignore")
    host = str(host).strip("[]").lower()
    if host in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def _violation(what: str) -> NetworkBlocked:
    msg = f"Red bloqueada en modo replay: {what}"
    violations.append(msg)
    return NetworkBlocked(msg)


def _check_address(sock: socket.socket, address: object) -> None:
    if sock.family == getattr(socket, "AF_UNIX", object()):
        return
    host = address[0] if isinstance(address, tuple) and address else address
    if not _is_loopback_host(host):
        raise _violation(f"socket.connect({address!r})")


def _install() -> None:
    orig_connect = socket.socket.connect
    orig_connect_ex = socket.socket.connect_ex
    orig_getaddrinfo = socket.getaddrinfo
    _saved.update(connect=orig_connect, connect_ex=orig_connect_ex, getaddrinfo=orig_getaddrinfo)

    def connect(self, address):
        _check_address(self, address)
        return orig_connect(self, address)

    def connect_ex(self, address):
        _check_address(self, address)
        return orig_connect_ex(self, address)

    def getaddrinfo(host, *args, **kwargs):
        if not _is_loopback_host(host):
            raise _violation(f"getaddrinfo({host!r})")
        return orig_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo

    try:
        from curl_cffi import curl as _curl
    except Exception:  # pragma: no cover - curl_cffi is a yfinance dependency
        _curl = None
    if _curl is not None:
        orig_perform = _curl.Curl.perform
        _saved["curl_perform"] = orig_perform

        def perform(self, *args, **kwargs):
            raise _violation("curl_cffi.Curl.perform")

        _curl.Curl.perform = perform


def _uninstall() -> None:
    socket.socket.connect = _saved.pop("connect")
    socket.socket.connect_ex = _saved.pop("connect_ex")
    socket.getaddrinfo = _saved.pop("getaddrinfo")
    if "curl_perform" in _saved:
        from curl_cffi import curl as _curl

        _curl.Curl.perform = _saved.pop("curl_perform")


def block_network() -> None:
    """Install the guard (re-entrant; pair every call with :func:`unblock_network`)."""
    global _depth
    with _lock:
        if _depth == 0:
            _install()
        _depth += 1


def unblock_network() -> None:
    global _depth
    with _lock:
        if _depth == 0:
            return
        _depth -= 1
        if _depth == 0:
            _uninstall()


def network_blocked() -> bool:
    return _depth > 0


@contextmanager
def no_network() -> Iterator[list[str]]:
    """Context manager form. Yields the shared list of violations seen so far."""
    block_network()
    try:
        yield violations
    finally:
        unblock_network()
