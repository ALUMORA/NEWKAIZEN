"""Caché con TTL y single-flight (``kaizen_api.cache``)."""

from __future__ import annotations

import datetime as dt
import threading

import pytest
import time_machine

from kaizen_api import cache

T0 = dt.datetime(2026, 9, 22, 12, 0, tzinfo=dt.UTC)


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.reset_state()
    yield
    cache.reset_state()


def test_single_flight_one_upstream_call_for_concurrent_gets():
    calls = []
    release = threading.Event()
    n = 16
    results = [None] * n
    barrier = threading.Barrier(n)

    def upstream():
        calls.append(threading.get_ident())
        release.wait(5)
        return {"valor": 42}

    def worker(i):
        barrier.wait(5)
        results[i] = cache._cached("k", upstream, ttl=60)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    # Los n hilos se registran en el mismo candado mientras uno solo calcula.
    for _ in range(500):
        if len(calls) == 1 and cache._key_locks.get("k", [None, 0])[1] == n:
            break
        threading.Event().wait(0.01)
    assert cache._key_locks["k"][1] == n
    release.set()
    for t in threads:
        t.join(5)
    assert len(calls) == 1
    assert all(r == {"valor": 42} for r in results)
    assert all(r is results[0] for r in results)
    assert cache._key_locks == {}, "el candado debe borrarse al terminar"


def test_ttl_expiry_recomputes():
    calls = []

    def upstream():
        calls.append(1)
        return len(calls)

    with time_machine.travel(T0, tick=False) as traveller:
        assert cache._cached("ttl", upstream, ttl=300) == 1
        traveller.shift(dt.timedelta(seconds=299))
        assert cache._cached("ttl", upstream, ttl=300) == 1
        traveller.shift(dt.timedelta(seconds=2))
        assert cache._cached("ttl", upstream, ttl=300) == 2
    assert len(calls) == 2


def test_failed_result_is_kept_only_fail_ttl():
    values = iter([{}, {}, {"ok": True}])

    def upstream():
        return next(values)

    with time_machine.travel(T0, tick=False) as traveller:
        assert cache._cached("f", upstream, ttl=3600, ok=bool, fail_ttl=60) == {}
        traveller.shift(dt.timedelta(seconds=59))
        assert cache._cached("f", upstream, ttl=3600, ok=bool, fail_ttl=60) == {}  # sigue en caché
        traveller.shift(dt.timedelta(seconds=2))
        assert cache._cached("f", upstream, ttl=3600, ok=bool, fail_ttl=60) == {}  # segundo intento, falla
        traveller.shift(dt.timedelta(seconds=61))
        assert cache._cached("f", upstream, ttl=3600, ok=bool, fail_ttl=60) == {"ok": True}
        traveller.shift(dt.timedelta(seconds=3000))
        assert cache._cached("f", upstream, ttl=3600, ok=bool, fail_ttl=60) == {"ok": True}  # el bueno dura 1 h


def test_ok_that_raises_counts_as_failure():
    def boom(_):
        raise ValueError("x")

    with time_machine.travel(T0, tick=False) as traveller:
        cache._cached("r", lambda: 1, ttl=3600, ok=boom, fail_ttl=10)
        traveller.shift(dt.timedelta(seconds=11))
        assert cache._cache_get("r") == (False, None)


def test_exception_is_not_cached_and_releases_the_lock():
    def upstream():
        raise RuntimeError("proveedor caído")

    with pytest.raises(RuntimeError):
        cache._cached("e", upstream)
    assert cache._cache_get("e") == (False, None)
    assert cache._key_locks == {}


def test_registered_lock_is_never_pruned_while_a_caller_holds_it():
    """La carrera del legado: el candado ya registrado (sin adquirir) no se pierde por el volumen."""
    entry = cache._acquire_key_lock("carrera")
    for i in range(cache._CACHE_MAX + 100):
        cache._cache_put(f"otra-{i}", i, ttl=0)  # vencidas: el legado podaba candados aquí
    second = cache._acquire_key_lock("carrera")
    assert second is entry, "otro llamador debe compartir el mismo candado (single-flight)"
    cache._release_key_lock("carrera", second)
    assert "carrera" in cache._key_locks
    cache._release_key_lock("carrera", entry)
    assert "carrera" not in cache._key_locks


def test_cache_is_bounded():
    for i in range(cache._CACHE_MAX + 50):
        cache._cache_put(f"k{i}", i, ttl=3600)
    assert cache.cache_stats()["entries"] == cache._CACHE_MAX
    assert cache._cache_get("k0") == (False, None)  # la más vieja salió primero
    assert cache._cache_get(f"k{cache._CACHE_MAX + 49}")[0]


def test_reset_state_clears_everything_and_runs_hooks():
    seen = []
    hook = cache.register_reset(lambda: seen.append(1))
    try:
        cache._cache_put("a", 1, ttl=60)
        cache._edgar_ticker_cache.update({"data": {"AAPL": "0000320193"}, "ts": 123})
        import kaizen_api

        kaizen_api.reset_state()
        assert cache._cache == {} and cache._edgar_ticker_cache == {"data": None, "ts": 0}
        assert seen == [1]
    finally:
        cache._reset_hooks.remove(hook)
