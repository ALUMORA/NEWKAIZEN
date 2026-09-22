REPLAY API (tests/replay, importable as `tests.replay`):
- `with replaying("2026-09-22") as rp:` serves only from fixtures.
  - Blocks the network: sockets, DNS and libcurl; loopback is allowed.
  - Freezes time at index.json frozen_at=2026-09-22T14:51:31+00:00 with time-machine, tick=False.
  - Makes time.sleep a no-op and makes concurrent.futures.as_completed yield in submission order.
  - Unrecorded calls raise ReplayMiss(key), a BaseException that `except Exception` cannot swallow, and are also listed in rp.misses.
- `with recording("2026-09-22", throttle=1.0, refresh=False) as rec:` serves keys already on disk and fetches the rest live, throttled.
  - Backs off on rate limits (20/40/80/160 s).
  - Prefers a success over a failure recorded earlier. Empty frames and HTTP errors from earlier runs are retried.
  - Every returned value goes through encode/decode, so live output equals replay output.
- `session = install_replay(set)` installs process-wide; call `session.uninstall()` to undo. Only one session can be active per process.
- Helpers:
  - `load_module(name)` imports from the repo root.
  - `reset_backend_state(module)` calls module.reset_state() if present, otherwise clears the legacy _cache, _key_locks and _edgar_ticker_cache.
  - `call_captured(fn, args, kwargs)` returns {output} or {raises}.
  - `compare(actual, expected, volatile=[...], rel=1e-9)` returns a list of diffs.
  - `normalize(result)` is json.dumps(default=str) round-tripped, which is exactly what the legacy handler sends on the wire.
  - `rp.trace()` returns the keys a call touched.
  - `FixtureStore.forget()` drops cached indexes after re-recording in the same process.
- Pytest fixtures in tests/conftest.py:
  - An autouse network guard, unless a test is marked `@pytest.mark.live` (skipped unless KAIZEN_LIVE=1).
  - `replay_set` (env KAIZEN_REPLAY_SET overrides it), `frozen_time`, `no_network`, and `replay`, which is an active session that asserts no misses.

IMPORTANT FOR S1 (kaizen_api): patches go on the public `yfinance.Ticker`, `yfinance.download` and `requests.Session.request` only.
- Do not patch yfinance.ticker.Ticker: yfinance's own classes call super(Ticker, self), so patching it breaks them.
- Reference them dynamically: `import yfinance as yf; yf.Ticker(...)`. Or import your module AFTER install_replay; run_replay_backend.py already does that.
- Any HTTP must go through requests. httpx or urllib calls are NOT recorded, and in replay they hit the guard (NetworkBlocked). If you add httpx, extend tests/replay/proxies.py or ask R0/O.
- If your package has caches, expose `reset_state()` so reset_backend_state() can clear it.
- Parity recipe for tests/characterization/test_package_parity.py:
  - Iterate list_goldens() and map golden["function"] to your implementation.
  - Call it inside replaying(golden["fixture_set"]).
  - Assert compare(normalize(out), golden["output"], volatile=golden["volatile_paths"]) == [] and rp.misses == [].
  - golden["fixtures_used"] lists the exact upstream keys each function consumed.
- run_replay_backend.py supports `--module kaizen_api.main`: it serves an ASGI `app` with uvicorn and wraps it so a ReplayMiss becomes a 500 JSON response. `--port` defaults to 8190. S1 shares ownership of this file.

WHERE FIXTURES LIVE:
- tests/fixtures/recorded/<set>/index.json holds set, frozen_at, created_at, updated_at, yfinance_version, a summary with counts per provider and failed/empty calls per symbol, and entries mapping key to {file, provider, kind, soft_failure, recorded_at}.
- There is one JSON file per key, named `<provider>-<slug>-<sha256[:16]>.json`, containing {key, provider, symbol/attr/kwargs or method/url/params, kind: value|exception, payload | exception{type,args,str}, soft_failure, logs, recorded_at, run_id}.
- Key formats:
  - `yf:<SYMBOL>:<attr>?k=v` (kwargs bound to the real signature, defaults and timeouts dropped). Example: `yf:AAPL:history?interval=1wk&period=1y`, `yf:WALMEX.MX:fast_info.last_price`.
  - `yf.download:[A,B]?period=5d` for a list, `yf.download:AAPL?...` for a string.
  - `http:GET https://host/path?sorted&params`, with cache-buster and crumb params dropped.
- Goldens live in tests/goldens_legacy/<function>__<args-slug>.json ('^' becomes 'idx-', an empty ccy becomes 'ccy-empty'). Each holds function, args, kwargs, module, fixture_set, frozen_at, volatile_paths, output|raises, fixtures_used, live_match.

HOW TO ADD A RECORDED CALL:
- Add a spec to build_specs() in scripts/record_fixtures.py.
- Run `.venv/bin/python scripts/record_fixtures.py --only '<regex>'`. It resumes: only missing keys go live, and it writes the golden.
- For ad-hoc provider data, for example B3 wanting other statements, do: `with recording("2026-09-22"): yf.Ticker("X").quarterly_income_stmt`. That is how the 9 quarterly keys for WALMEX.MX, FUNO11.MX and AAPL were added.
- `--goldens-only` regenerates goldens offline. `--refresh` forces live calls. For a fresh snapshot, use a NEW set name so these goldens stay valid.

VOLATILE-FIELD CONVENTION:
- volatile_paths use dotted keys with [*] for list items. Today they are `news[*].time` (8 news goldens) and `asOf` (get_rf).
- A path is added automatically whenever a key named asOf, updated, updatedAt, fetched, fetchedAt, generatedAt, timestamp, time, ts, age or ago appears in the output.
- A volatile field must still exist with the same JSON type; only its value is ignored.
- Numbers compare with rel 1e-9 and abs 1e-12, and int 5 equals float 5.0. NaN and inf in outputs would be tagged {"__nonfinite__": ...}; none occur today.

YFINANCE 1.7 / DATA FACTS LATER STREAMS MUST KNOW:
1. history() indexes are datetime64[s, tz], second resolution and not ns:
   - US tickers use America/New_York.
   - .MX tickers and ^MXX use America/Mexico_City.
   - USDMXN=X and MXN=X use Europe/London. history(period='2d') on USDMXN=X returned only 1 row.
2. yf.download returns MultiIndex columns (Price, Ticker) even for one ticker, with a NAIVE datetime64[s] index. A mixed-asset batch includes weekend rows because of crypto, so equities and FX have many NaN rows; always dropna per column.
3. Currencies:
   - AAPL.MX, CEMEXCPO.MX and even ^MXX report currency=MXN with financialCurrency=USD.
   - WALMEX.MX and FUNO11.MX are MXN/MXN.
   - info.marketCap for AAPL.MX is in MXN (8.5e13), while totalRevenue, freeCashflow and other aggregates are in financialCurrency.
   - trailingEps and bookValue come in the quote currency.
   - USD/MXN on 2026-09-22 was 17.2275.
4. info.dividendYield is already in percent (AAPL 0.32, FUNO11 8.71); trailingAnnualDividendYield is a fraction.
5. An invalid ticker never raises from info: yfinance returns {'trailingPegRatio': None} and empty frames and logs 404s. Only fast_info.last_price raised (KeyError 'currentTradingPeriod'). get_stock('ZZZNOTREAL') returns name=ticker with all nulls; get_chart returns closes [].
6. Statements:
   - Annual statement columns are datetime64[s].
   - STORAGE18.MX annual statements are empty.
   - SPY and ^MXX statements and holders are empty; insider_transactions returns a 404 'No fundamentals data'.
   - .MX insider_transactions are empty.
   - .MX quarterly statements are NOT empty but have gaps: WALMEX quarterly_income_stmt skips 2025-09-30, which quarterly_balance_sheet has.
   - SEC company_tickers.json has no CIK for BMV tickers. SPY maps to CIK 884394 but companyfacts returns 404.
7. Ticker.news items use the new {id, content:{title, summary, pubDate ISO, provider.displayName, canonicalUrl.url}} shape. USDMXN=X news is empty.
8. The FRED fredgraph.csv files are the full history (200 to 290 KB each). IRLTLT01MXM156N is monthly and lags: its latest value is 2026-08-01 at 9.16%.
9. The FRED DGS10 and DGS2 values used by the macro golden are 5.01 and 4.76; VIX from CBOE is 14.87.