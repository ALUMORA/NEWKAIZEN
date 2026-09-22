"""Human-readable, deterministic keys for recorded upstream calls.

yfinance:  ``yf:<SYMBOL>:<attr>[?k=v&...]``        e.g. ``yf:AAPL:history?interval=1wk&period=1y``
           ``yf:<SYMBOL>:fast_info.<prop>``         e.g. ``yf:WALMEX.MX:fast_info.last_price``
download:  ``yf.download:<TICKERS>[?k=v&...]``      TICKERS is ``AAPL`` for a string, ``[A,B]`` for a list
HTTP:      ``http:<METHOD> <scheme://host/path>[?sorted params]``

kwargs are bound to the real signature and values equal to the default are dropped, so
``history(period="5d")`` and ``history(period="5d", interval="1d")`` share one key.
Non-semantic arguments (timeouts, progress bars, sessions, proxies) never enter a key.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Arguments that never change the data returned.
NON_SEMANTIC_KWARGS = frozenset({"timeout", "proxy", "progress", "session", "threads", "raise_errors"})
# Query parameters that change on every request (cache busters, auth crumbs).
VOLATILE_QUERY_PARAMS = frozenset({"_", "cb", "cachebust", "cachebuster", "nocache", "crumb", "_ts"})


def _fmt(v: Any) -> str:
    if isinstance(v, str):
        return v
    return json.dumps(v, sort_keys=True, default=str, separators=(",", ":"))


def _query(items: dict[str, Any]) -> str:
    if not items:
        return ""
    return "?" + "&".join(f"{k}={_fmt(v)}" for k, v in sorted(items.items()))


def normalize_call(func: Any, args: tuple, kwargs: dict, *, skip_first: bool = False) -> dict[str, Any]:
    """Bind ``args``/``kwargs`` to ``func``'s signature and drop defaults and non-semantic args."""
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        sig = None
    bound = None
    if sig is not None:
        params = list(sig.parameters.values())
        if skip_first and params:
            params = params[1:]
        sig = sig.replace(parameters=params)
        try:
            bound = sig.bind_partial(*args, **kwargs)
        except TypeError:
            bound = None
    if sig is None or bound is None:
        out = {f"arg{i}": a for i, a in enumerate(args)}
        out.update({k: v for k, v in kwargs.items() if k not in NON_SEMANTIC_KWARGS})
        return out
    out: dict[str, Any] = {}
    for name, value in bound.arguments.items():
        param = sig.parameters[name]
        if param.kind is param.VAR_KEYWORD:
            out.update({k: v for k, v in value.items() if k not in NON_SEMANTIC_KWARGS})
            continue
        if param.kind is param.VAR_POSITIONAL:
            if value:
                out[name] = list(value)
            continue
        if name in NON_SEMANTIC_KWARGS:
            continue
        if param.default is not inspect.Parameter.empty and _same(value, param.default):
            continue
        out[name] = value
    return out


def _same(a: Any, b: Any) -> bool:
    try:
        return type(a) is type(b) and bool(a == b)
    except Exception:
        return False


def yf_key(symbol: str, attr: str, kwargs: dict[str, Any] | None = None) -> str:
    return f"yf:{str(symbol).upper()}:{attr}{_query(kwargs or {})}"


def download_key(tickers: Any, kwargs: dict[str, Any]) -> str:
    if isinstance(tickers, str):
        sym = tickers.upper()
    else:
        sym = "[" + ",".join(str(t).upper() for t in tickers) + "]"
    return f"yf.download:{sym}{_query(kwargs)}"


def http_key(method: str, url: str, params: Any = None, body: bytes | str | None = None) -> str:
    parts = urlsplit(url)
    items = parse_qsl(parts.query, keep_blank_values=True)
    if params:
        extra = params.items() if isinstance(params, dict) else params
        for k, v in extra:
            if isinstance(v, (list, tuple)):
                items.extend((k, str(x)) for x in v)
            elif v is not None:
                items.append((k, str(v)))
    items = sorted((k, v) for k, v in items if k not in VOLATILE_QUERY_PARAMS)
    base = urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", "", ""))
    key = f"http:{method.upper()} {base}"
    if items:
        key += "?" + urlencode(items)
    if body:
        raw = body.encode() if isinstance(body, str) else bytes(body)
        key += f" #body={hashlib.sha256(raw).hexdigest()[:12]}"
    return key


_SLUG_RE = re.compile(r"[^A-Za-z0-9.]+")


def key_filename(key: str) -> str:
    """Hash-named file for a key, with a short readable prefix: ``yf-AAPL-history-<hash>.json``."""
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    provider, _, rest = key.partition(":")
    head = rest.split("?")[0].replace("^", "idx-")
    slug = _SLUG_RE.sub("-", head).strip("-")[:48]
    return f"{_SLUG_RE.sub('-', provider)}-{slug}-{digest}.json"
