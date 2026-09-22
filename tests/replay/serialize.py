"""JSON (de)serialization that round-trips what yfinance and requests hand to the backend.

Plain JSON values pass through untouched. Everything else is tagged with ``TAG`` so that
``decode(encode(x))`` gives back an object the backend math cannot tell apart from the
original: pandas DataFrame/Series/Index (DatetimeIndex with tz and unit, MultiIndex,
RangeIndex), numpy scalars and arrays, Timestamps, NaN/inf, tuples and dicts with
non-string keys.

The output is strict JSON (no NaN tokens), so fixtures can be read by any tool.
"""

from __future__ import annotations

import base64
import datetime as _dt
import math
import re
from typing import Any

import numpy as np
import pandas as pd

TAG = "__rp__"

_INT64_NAT = np.iinfo(np.int64).min
_DT_RE = re.compile(r"^(datetime64|timedelta64)\[(\w+)(?:,\s*(.+))?\]$")


class SerializationError(TypeError):
    """Raised when a value has a type this module does not know how to round-trip."""


# ─── floats ──────────────────────────────────────────────────────────────────


def _enc_float(x: float) -> Any:
    if math.isfinite(x):
        return x
    if math.isnan(x):
        return {TAG: "float", "v": "nan"}
    return {TAG: "float", "v": "inf" if x > 0 else "-inf"}


def _dec_float(v: Any) -> float:
    if isinstance(v, dict):
        return float(v["v"])  # float("nan"), float("inf"), float("-inf")
    return float(v)


# ─── timezone helpers ────────────────────────────────────────────────────────


def _tz_name(tz: Any) -> str | None:
    if tz is None:
        return None
    key = getattr(tz, "key", None)  # zoneinfo.ZoneInfo
    if key:
        return key
    zone = getattr(tz, "zone", None)  # pytz
    if zone:
        return zone
    return str(tz)


# ─── public API ──────────────────────────────────────────────────────────────


def encode(obj: Any) -> Any:
    """Convert ``obj`` into a strict-JSON-compatible structure."""
    if obj is None or isinstance(obj, str) and not isinstance(obj, np.str_):
        return obj
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, int) and not isinstance(obj, np.integer):
        return obj
    if isinstance(obj, float) and not isinstance(obj, np.floating):
        return _enc_float(obj)
    if isinstance(obj, np.str_):
        return {TAG: "np", "dtype": "str_", "v": str(obj)}
    if isinstance(obj, np.bool_):
        return {TAG: "np", "dtype": "bool", "v": bool(obj)}
    if isinstance(obj, np.integer):
        return {TAG: "np", "dtype": str(obj.dtype), "v": int(obj)}
    if isinstance(obj, np.floating):
        return {TAG: "np", "dtype": str(obj.dtype), "v": _enc_float(float(obj))}
    if obj is pd.NaT:
        return {TAG: "nat"}
    if obj is pd.NA:
        return {TAG: "na"}
    if isinstance(obj, pd.Timestamp):
        return {TAG: "ts", "v": int(obj.value), "unit": obj.unit, "tz": _tz_name(obj.tz)}
    if isinstance(obj, pd.Timedelta):
        return {TAG: "td", "v": int(obj.value), "unit": obj.unit}
    if isinstance(obj, np.datetime64):
        return {TAG: "np64", "dtype": str(obj.dtype), "v": int(obj.astype(np.int64))}
    if isinstance(obj, np.timedelta64):
        return {TAG: "np64", "dtype": str(obj.dtype), "v": int(obj.astype(np.int64))}
    if isinstance(obj, _dt.datetime):
        return {TAG: "datetime", "v": obj.isoformat(), "tz": _tz_name(obj.tzinfo)}
    if isinstance(obj, _dt.date):
        return {TAG: "date", "v": obj.isoformat()}
    if isinstance(obj, _dt.timedelta):
        return {TAG: "timedelta", "v": [obj.days, obj.seconds, obj.microseconds]}
    if isinstance(obj, (bytes, bytearray)):
        return {TAG: "bytes", "v": base64.b64encode(bytes(obj)).decode("ascii")}
    if isinstance(obj, dict):
        if all(isinstance(k, str) for k in obj) and TAG not in obj:
            return {k: encode(v) for k, v in obj.items()}
        return {TAG: "dict", "items": [[encode(k), encode(v)] for k, v in obj.items()]}
    if isinstance(obj, list):
        return [encode(v) for v in obj]
    if isinstance(obj, tuple):
        return {TAG: "tuple", "v": [encode(v) for v in obj]}
    if isinstance(obj, pd.DataFrame):
        return _enc_frame(obj)
    if isinstance(obj, pd.Series):
        return {
            TAG: "Series",
            "name": encode(obj.name),
            "index": _enc_index(obj.index),
            "data": _enc_values(obj.array),
        }
    if isinstance(obj, pd.Index):
        return _enc_index(obj)
    if isinstance(obj, np.ndarray):
        return {TAG: "ndarray", "shape": list(obj.shape), "data": _enc_values(obj.reshape(-1))}
    raise SerializationError(f"No sé serializar {type(obj).__module__}.{type(obj).__qualname__}")


def decode(data: Any) -> Any:
    """Inverse of :func:`encode`. Always builds fresh objects (callers may mutate them)."""
    if isinstance(data, list):
        return [decode(v) for v in data]
    if not isinstance(data, dict):
        return data
    tag = data.get(TAG)
    if tag is None:
        return {k: decode(v) for k, v in data.items()}
    if tag == "float":
        return _dec_float(data)
    if tag == "np":
        dtype = data["dtype"]
        if dtype == "str_":
            return np.str_(data["v"])
        if dtype == "bool":
            return np.bool_(data["v"])
        return np.dtype(dtype).type(_dec_float(data["v"]) if "float" in dtype else data["v"])
    if tag == "nat":
        return pd.NaT
    if tag == "na":
        return pd.NA
    if tag == "ts":
        ts = pd.Timestamp(data["v"], unit="ns", tz="UTC" if data["tz"] else None)
        if data["tz"]:
            ts = ts.tz_convert(data["tz"])
        return ts.as_unit(data["unit"])
    if tag == "td":
        return pd.Timedelta(data["v"], unit="ns").as_unit(data["unit"])
    if tag == "np64":
        return np.array(data["v"], dtype=np.int64).view(data["dtype"])[()]
    if tag == "datetime":
        return _dt.datetime.fromisoformat(data["v"])
    if tag == "date":
        return _dt.date.fromisoformat(data["v"])
    if tag == "timedelta":
        d, s, us = data["v"]
        return _dt.timedelta(days=d, seconds=s, microseconds=us)
    if tag == "bytes":
        return base64.b64decode(data["v"])
    if tag == "dict":
        return {_hashable(decode(k)): decode(v) for k, v in data["items"]}
    if tag == "tuple":
        return tuple(decode(v) for v in data["v"])
    if tag == "DataFrame":
        return _dec_frame(data)
    if tag == "Series":
        index = _dec_index(data["index"])
        values = _dec_values(data["data"])
        return pd.Series(values, index=index, name=_hashable(decode(data["name"])), dtype=values.dtype, copy=False)
    if tag in ("Index", "RangeIndex", "MultiIndex"):
        return _dec_index(data)
    if tag == "ndarray":
        values = _dec_values(data["data"])
        return np.asarray(values).reshape(data["shape"])
    raise SerializationError(f"Etiqueta desconocida: {tag!r}")


def _hashable(v: Any) -> Any:
    return tuple(_hashable(x) for x in v) if isinstance(v, list) else v


# ─── arrays ──────────────────────────────────────────────────────────────────


def _enc_values(arr: Any) -> dict:
    """Encode a 1-D array-like (numpy array or pandas ExtensionArray) with its dtype."""
    # Series.array of a numpy-backed column. Exact type check: StringArray subclasses it.
    if type(arr) is pd.arrays.NumpyExtensionArray:
        arr = arr.to_numpy()
    dtype = arr.dtype
    dtype_s = str(dtype)
    if isinstance(dtype, pd.CategoricalDtype):
        cat = pd.Categorical(arr)
        return {
            "dtype": "category",
            "categories": _enc_index(cat.categories),
            "ordered": bool(cat.ordered),
            "codes": [int(c) for c in cat.codes],
        }
    m = _DT_RE.match(dtype_s)
    if m:
        ints = np.asarray(pd.array(arr).asi8)  # epoch in the array's own unit (UTC for tz-aware)
        return {"dtype": dtype_s, "v": [None if i == _INT64_NAT else int(i) for i in ints.tolist()]}
    if isinstance(dtype, np.dtype):
        # "np": True marks a numpy dtype; names like "str" are also valid numpy dtypes ("<U0")
        # but in pandas 3 they mean the StringDtype, so the decoder must not guess.
        if dtype.kind == "f":
            vals = [None if math.isnan(x) else _enc_float(x) for x in np.asarray(arr).tolist()]
            return {"dtype": dtype_s, "np": True, "v": vals}
        if dtype.kind in "iubU":
            return {"dtype": dtype_s, "np": True, "v": np.asarray(arr).tolist()}
        if dtype.kind == "O":
            return {"dtype": "object", "np": True, "v": [encode(x) for x in np.asarray(arr).tolist()]}
        raise SerializationError(f"dtype numpy no soportado: {dtype_s}")
    # Extension dtypes: str/string, Int64, Float64, boolean, ...
    out = []
    for x in list(arr):
        if x is None or x is pd.NA or (isinstance(x, float) and math.isnan(x)):
            out.append(None)
        else:
            out.append(encode(x))
    return {"dtype": dtype_s, "v": out}


def _dec_values(enc: dict) -> Any:
    dtype_s = enc["dtype"]
    if dtype_s == "category":
        cats = _dec_index(enc["categories"])
        return pd.Categorical.from_codes(enc["codes"], categories=cats, ordered=enc["ordered"])
    m = _DT_RE.match(dtype_s)
    if m:
        kind, unit, tz = m.group(1), m.group(2), m.group(3)
        ints = np.array([_INT64_NAT if v is None else v for v in enc["v"]], dtype=np.int64)
        raw = ints.view(f"{kind}[{unit}]")
        if kind == "timedelta64":
            return pd.array(raw)
        idx = pd.DatetimeIndex(raw)
        if tz:
            idx = idx.tz_localize("UTC").tz_convert(tz)
        return idx.array
    if enc.get("np"):
        np_dtype = np.dtype(dtype_s)
        if np_dtype.kind == "f":
            return np.array([math.nan if v is None else _dec_float(v) for v in enc["v"]], dtype=np_dtype)
        if np_dtype.kind == "O":
            values = [decode(v) for v in enc["v"]]
            out = np.empty(len(values), dtype=object)
            for i, v in enumerate(values):
                out[i] = v
            return out
        return np.array(enc["v"], dtype=np_dtype)
    return pd.array([None if v is None else decode(v) for v in enc["v"]], dtype=pd.api.types.pandas_dtype(dtype_s))


# ─── indexes ─────────────────────────────────────────────────────────────────


def _enc_index(idx: pd.Index) -> dict:
    if isinstance(idx, pd.RangeIndex):
        return {TAG: "RangeIndex", "start": idx.start, "stop": idx.stop, "step": idx.step, "name": encode(idx.name)}
    if isinstance(idx, pd.MultiIndex):
        return {
            TAG: "MultiIndex",
            "levels": [_enc_index(level) for level in idx.levels],
            "codes": [[int(c) for c in codes] for codes in idx.codes],
            "names": [encode(n) for n in idx.names],
        }
    out = {TAG: "Index", "name": encode(idx.name), "data": _enc_values(idx.array)}
    freq = getattr(idx, "freqstr", None)
    if freq:
        out["freq"] = freq
    return out


def _dec_index(enc: dict) -> pd.Index:
    tag = enc[TAG]
    if tag == "RangeIndex":
        return pd.RangeIndex(enc["start"], enc["stop"], enc["step"], name=_hashable(decode(enc["name"])))
    if tag == "MultiIndex":
        return pd.MultiIndex(
            levels=[_dec_index(level) for level in enc["levels"]],
            codes=enc["codes"],
            names=[_hashable(decode(n)) for n in enc["names"]],
            verify_integrity=False,
        )
    values = _dec_values(enc["data"])
    name = _hashable(decode(enc["name"]))
    idx = pd.Index(values, name=name, dtype=values.dtype, copy=False)
    if enc.get("freq") and isinstance(idx, pd.DatetimeIndex):
        idx = pd.DatetimeIndex(idx, freq=enc["freq"])
    return idx


# ─── frames ──────────────────────────────────────────────────────────────────


def _enc_frame(df: pd.DataFrame) -> dict:
    out = {
        TAG: "DataFrame",
        "index": _enc_index(df.index),
        "columns": _enc_index(df.columns),
        "data": [_enc_values(df.iloc[:, i].array) for i in range(df.shape[1])],
    }
    if df.attrs:
        out["attrs"] = encode(dict(df.attrs))
    return out


def _dec_frame(enc: dict) -> pd.DataFrame:
    index = _dec_index(enc["index"])
    columns = _dec_index(enc["columns"])
    arrays = [_dec_values(c) for c in enc["data"]]
    if arrays:
        df = pd.DataFrame(
            {i: pd.Series(a, index=index, dtype=a.dtype, copy=False) for i, a in enumerate(arrays)},
            index=index,
        )
    else:
        df = pd.DataFrame(index=index)
    df.columns = columns
    if "attrs" in enc:
        df.attrs.update(decode(enc["attrs"]))
    return df
