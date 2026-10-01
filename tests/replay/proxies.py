"""Stand-ins installed over yfinance.Ticker, yfinance.download, yfinance.screen and requests.Session.request.

They never talk to the network themselves: every access becomes ``session.call(key, live_fn)``.
In replay mode the session answers from fixtures; in record mode it runs ``live_fn`` (which
uses the ORIGINAL yfinance/requests objects saved at install time) and stores the result.
"""

from __future__ import annotations

import base64
import datetime as _dt
import functools
import inspect
import json
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

import requests
from requests.structures import CaseInsensitiveDict

from .keys import download_key, http_key, normalize_call, screen_key, screen_label, yf_key
from .serialize import decode, encode

if TYPE_CHECKING:
    from .session import ReplaySession

_MISSING = object()
# Hop-by-hop / transport headers that no longer describe the stored (already decoded) body,
# plus cookies, which are noise and may identify the recording machine.
_DROP_HEADERS = {"content-encoding", "transfer-encoding", "content-length", "set-cookie", "connection", "keep-alive"}


def _history_signature_target() -> Any:
    try:
        from yfinance.scrapers.history import PriceHistory

        return PriceHistory.history
    except Exception:  # pragma: no cover
        return None


def _fast_info_template() -> Any:
    from yfinance.scrapers.quote import FastInfo

    return FastInfo(None)  # the constructor only builds key tables, no I/O


def _funds_data_members() -> tuple[frozenset[str], frozenset[str]]:
    """(properties, methods) of ``yfinance.scrapers.funds.FundsData``, read from the class (no I/O)."""
    try:
        from yfinance.scrapers.funds import FundsData
    except Exception:  # pragma: no cover
        return frozenset(), frozenset()
    props = {n for n, v in vars(FundsData).items() if not n.startswith("_") and isinstance(v, property)}
    methods = {n for n, v in vars(FundsData).items() if not n.startswith("_") and callable(v)}
    return frozenset(props), frozenset(methods)


# ─── yfinance.Ticker ─────────────────────────────────────────────────────────


class ReplayTicker:
    """Replacement for ``yfinance.Ticker``. A per-session subclass carries ``_rp``."""

    _rp: ReplaySession

    def __init__(self, ticker: str, session: Any = None, **kwargs: Any):
        self.ticker = str(ticker).upper()
        self.session = session
        self.ws = None
        self._orig_args = (ticker, session, kwargs)
        self._real = None
        self._fast_info_proxy = None
        self._funds_data_proxy = None

    def _real_obj(self) -> Any:
        if self._real is None:
            ticker, session, kwargs = self._orig_args
            self._real = self._rp.orig["Ticker"](ticker, session=session, **kwargs)
        return self._real

    def __repr__(self) -> str:
        return f"yfinance.Ticker object <{self.ticker}> (replay)"

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        cls = self._rp.orig["Ticker"]
        static = inspect.getattr_static(cls, name, _MISSING)
        if static is _MISSING:
            raise AttributeError(f"'Ticker' object has no attribute '{name}'")
        if name == "fast_info":
            if self._fast_info_proxy is None:
                self._fast_info_proxy = FastInfoProxy(self)
            return self._fast_info_proxy
        if name in ("funds_data", "get_funds_data"):
            # FundsData is a lazy object, not data: each of its properties is recorded on its own key
            # (``yf:SPY:funds_data.top_holdings``), like fast_info.
            if self._funds_data_proxy is None:
                self._funds_data_proxy = FundsDataProxy(self)
            proxy = self._funds_data_proxy
            return proxy if name == "funds_data" else (lambda *a, **kw: proxy)
        if isinstance(static, (property, functools.cached_property)):
            key = yf_key(self.ticker, name)
            return self._rp.call(
                key,
                lambda: getattr(self._real_obj(), name),
                provider="yfinance",
                meta={"symbol": self.ticker, "attr": name, "kwargs": {}},
            )
        if callable(static):
            sig_target = _history_signature_target() if name == "history" else static
            skip_first = True

            def method(*args: Any, **kwargs: Any) -> Any:
                norm = normalize_call(sig_target, args, kwargs, skip_first=skip_first)
                key = yf_key(self.ticker, name, norm)
                return self._rp.call(
                    key,
                    lambda: getattr(self._real_obj(), name)(*args, **kwargs),
                    provider="yfinance",
                    meta={"symbol": self.ticker, "attr": name, "kwargs": encode(norm)},
                )

            method.__name__ = name
            return method
        # Plain class attribute (constants): no I/O, read it straight from the class.
        return static


class FastInfoProxy:
    """Mimics ``yfinance.scrapers.quote.FastInfo``: lazy properties plus dict-like access."""

    def __init__(self, ticker_proxy: ReplayTicker):
        self._t = ticker_proxy
        self._tpl = _fast_info_template()
        self._real = None

    def _real_fi(self) -> Any:
        if self._real is None:
            self._real = self._t._real_obj().fast_info
        return self._real

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        static = inspect.getattr_static(type(self._tpl), name, _MISSING)
        if not isinstance(static, property):
            raise AttributeError(f"'FastInfo' object has no attribute '{name}'")
        key = yf_key(self._t.ticker, f"fast_info.{name}")
        return self._t._rp.call(
            key,
            lambda: getattr(self._real_fi(), name),
            provider="yfinance",
            meta={"symbol": self._t.ticker, "attr": f"fast_info.{name}", "kwargs": {}},
        )

    # dict imitation, same semantics as the real FastInfo
    def keys(self) -> list[str]:
        return list(self._tpl._public_keys)

    def items(self) -> list[tuple[str, Any]]:
        return [(k, self[k]) for k in self.keys()]

    def values(self) -> list[Any]:
        return [self[k] for k in self.keys()]

    def get(self, key: str, default: Any = None) -> Any:
        if key in self.keys():
            return self[key]
        return default

    def __getitem__(self, k: str) -> Any:
        if not isinstance(k, str):
            raise KeyError(f"key must be a string not '{type(k)}'")
        if k not in self._tpl._keys:
            raise KeyError(f"'{k}' not valid key. Examine 'FastInfo.keys()'")
        return getattr(self, self._tpl._cc_to_sc_key.get(k, k))

    def __contains__(self, k: object) -> bool:
        return k in self.keys()

    def __iter__(self):
        return iter(self.keys())

    def __str__(self) -> str:
        return "lazy-loading dict with keys = " + str(self.keys())

    __repr__ = __str__

    def toJSON(self, indent: int = 4) -> str:  # noqa: N802 - mirrors yfinance
        return json.dumps({k: self[k] for k in self.keys()}, indent=indent)


class FundsDataProxy:
    """Mimics ``yfinance.scrapers.funds.FundsData``: every property and method is its own recorded call.

    ``Ticker.funds_data`` returns an object that fetches on first access, which cannot be stored as
    a value. Here ``top_holdings``, ``sector_weightings``, ``asset_classes``, ``fund_overview``,
    ``fund_operations``, ``equity_holdings``, ``bond_holdings``, ``bond_ratings`` and ``description``
    go to ``yf:<SYMBOL>:funds_data.<name>`` and ``quote_type()`` to ``yf:<SYMBOL>:funds_data.quote_type``.
    A fund-less symbol raises inside the real object; that exception is recorded and replayed.
    """

    def __init__(self, ticker_proxy: ReplayTicker):
        self._t = ticker_proxy
        self._real = None

    def _real_fd(self) -> Any:
        if self._real is None:
            self._real = self._t._real_obj().funds_data
        return self._real

    def _call(self, name: str, live: Any) -> Any:
        key = yf_key(self._t.ticker, f"funds_data.{name}")
        return self._t._rp.call(
            key,
            live,
            provider="yfinance",
            meta={"symbol": self._t.ticker, "attr": f"funds_data.{name}", "kwargs": {}},
        )

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        props, methods = _funds_data_members()
        if name in props:
            return self._call(name, lambda: getattr(self._real_fd(), name))
        if name in methods:

            def method() -> Any:
                return self._call(name, lambda: getattr(self._real_fd(), name)())

            method.__name__ = name
            return method
        raise AttributeError(f"'FundsData' object has no attribute '{name}'")

    def __repr__(self) -> str:
        return f"yfinance.FundsData object <{self._t.ticker}> (replay)"


def make_ticker_class(session: ReplaySession) -> type:
    return type("Ticker", (ReplayTicker,), {"_rp": session, "__module__": "yfinance.ticker"})


def make_download(session: ReplaySession) -> Any:
    orig = session.orig["download"]

    def download(tickers: Any, *args: Any, **kwargs: Any) -> Any:
        norm = normalize_call(orig, (tickers, *args), kwargs)
        norm.pop("tickers", None)
        key = download_key(tickers, norm)
        return session.call(
            key,
            lambda: orig(tickers, *args, **kwargs),
            provider="yfinance.download",
            meta={"symbol": key.split(":", 1)[1].split("?")[0], "attr": "download", "kwargs": encode(norm)},
        )

    download.__wrapped__ = orig
    return download


def make_screen(session: ReplaySession) -> Any:
    """Stand-in for ``yfinance.screen``: a predefined name (``"day_gainers"``) or an ``EquityQuery``.

    ``yf.screen`` talks to Yahoo through yfinance's own curl_cffi session, which the requests hook
    never sees, so it is recorded here as one value per (query, offset, size, count, sort...).
    Providers have to call it as ``yf.screen(...)`` (module attribute): ``from yfinance import
    screen`` binds the original before the replay is installed and would go to the network.
    """
    orig = session.orig["screen"]

    def screen(query: Any, *args: Any, **kwargs: Any) -> Any:
        norm = normalize_call(orig, (query, *args), kwargs)
        norm.pop("query", None)
        key = screen_key(query, norm)
        return session.call(
            key,
            lambda: orig(query, *args, **kwargs),
            provider="yfinance.screen",
            meta={"symbol": screen_label(query)[:120], "attr": "screen", "kwargs": encode(norm)},
        )

    screen.__wrapped__ = orig
    return screen


# ─── requests ────────────────────────────────────────────────────────────────


def encode_response(resp: requests.Response) -> dict:
    content = resp.content or b""
    headers = {k: v for k, v in resp.headers.items() if k.lower() not in _DROP_HEADERS}
    try:
        body = {"text": content.decode("utf-8")}
    except UnicodeDecodeError:
        body = {"b64": base64.b64encode(content).decode("ascii")}
    return {
        "status": resp.status_code,
        "reason": resp.reason,
        "url": resp.url,
        "encoding": resp.encoding,
        "headers": headers,
        "body": body,
    }


def decode_response(data: dict, method: str = "GET") -> requests.Response:
    r = requests.Response()
    r.status_code = data["status"]
    r.reason = data.get("reason")
    r.url = data.get("url")
    r.encoding = data.get("encoding")
    r.headers = CaseInsensitiveDict(data.get("headers") or {})
    body = data.get("body") or {}
    r._content = body["text"].encode("utf-8") if "text" in body else base64.b64decode(body.get("b64", ""))
    r._content_consumed = True
    r.elapsed = _dt.timedelta(0)
    try:
        r.request = requests.Request(method, r.url).prepare()
    except Exception:
        r.request = None
    return r


def make_session_request(session: ReplaySession) -> Any:
    orig = session.orig["Session.request"]
    sig = inspect.signature(orig)

    def request(self: requests.Session, method: str, url: str, *args: Any, **kwargs: Any) -> requests.Response:
        if session.passthrough_http():
            # A recorded yfinance call is running (YF_SESSION=requests): its HTTP is not ours.
            return orig(self, method, url, *args, **kwargs)
        bound = sig.bind(self, method, url, *args, **kwargs)
        params = bound.arguments.get("params")
        data = bound.arguments.get("data")
        json_body = bound.arguments.get("json")
        body: bytes | str | None = None
        if isinstance(data, (bytes, str)):
            body = data
        elif isinstance(data, dict):
            body = urlencode(sorted(data.items()))
        elif json_body is not None:
            body = json.dumps(json_body, sort_keys=True)
        key = http_key(method, url, params, body)
        return session.call(
            key,
            lambda: orig(self, method, url, *args, **kwargs),
            provider="http",
            meta={"method": method.upper(), "url": url, "params": encode(params) if params else None},
            encoder=encode_response,
            decoder=lambda d: decode_response(d, method.upper()),
        )

    request.__wrapped__ = orig
    return request


def default_encoder(value: Any) -> Any:
    return encode(value)


def default_decoder(payload: Any) -> Any:
    return decode(payload)
