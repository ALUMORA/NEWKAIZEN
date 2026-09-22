# Fase 1, S1 (resultado final después de corregir la revisión)

## Resumen

Both major findings were confirmed and are fixed in two new commits on ws/S1. I confirmed them first with a repro script before the fix: a cross-origin 429 had no Access-Control-Expose-Headers, a preflight asking for x-request-id got 400 'Disallowed CORS headers', a token forged with DEV_SECRET_KEY got 200 under AUTH_REQUIRED=true in development, and production accepted SECRET_KEY equal to DEV_SECRET_KEY. The same script now shows all four fixed.

**1. CORS (413d86b)**
- kaizen_api/main.py now defines `CORS_ALLOW_HEADERS = ("Authorization", "Content-Type", "X-Request-ID")` and `CORS_EXPOSE_HEADERS = ("Retry-After", "X-Request-ID")`, both passed to CORSMiddleware.
- Browser JS on newkaizen.vercel.app can now read Retry-After on a 429 and X-Request-ID on any response, and can send its own X-Request-ID.
- New test `test_cors_exposes_retry_after_and_request_id_on_cross_origin_429` sends a cross-origin 429 to /auth/login with Origin https://newkaizen.vercel.app. It checks ACAO, that the expose list includes retry-after and x-request-id, that the Retry-After value is >= 1, and that the client-sent X-Request-ID is echoed back. It also covers the legacy POST /login 429 and a 200 /health.
- `test_cors_preflight` now requests `authorization, x-request-id` and asserts both are allowed.
- docs/api-v2.md CORS paragraph now lists the incoming and exposed headers.

**2. Public dev key (b2de74e)**
- A new `_resolve_secret()` in settings.py is strict whenever `production or auth_required`, in any environment. It raises SettingsError when SECRET_KEY is:
  - unset,
  - equal to DEV_SECRET_KEY, or
  - shorter than 32 characters.
- Outside that case (development without AUTH_REQUIRED) the dev key still works, with a warning. That includes an explicit SECRET_KEY equal to the dev key.
- `Settings.__post_init__` adds a backstop: building Settings by hand with the dev key and auth_required or production also raises.
- New tests:
  - an auth_required test parametrized over {development, production} × {no key, dev key, short key}, 6 cases;
  - production with DEV_SECRET_KEY;
  - dev key allowed only without AUTH_REQUIRED, and never through manual construction;
  - the reviewer's forged-token scenario, which now gets 401 token_invalid on /auth/me, /stock/AAPL and /v2/quotes.
- docs/api-v2.md (Sesión and Correr el API), the settings docstring and the kaizen-backend comment in render.yaml explain the rule. The docs include an `openssl rand -hex 32` example for local auth testing, and I ran it.

**Mutation check:** I broke each fix in turn:
- removing expose_headers made the new CORS test fail;
- removing X-Request-ID from allow_headers made 4 preflight cases fail;
- making the check apply only in production made the dev short-key case fail (the dev-key cases are still stopped by `__post_init__`);
- accepting an explicit DEV_SECRET_KEY made 4 tests fail.

All files were restored after each mutation.

**Unchanged:** schemas.py and the generated model reference in docs/api-v2.md did not change, so the docs drift test still passes. No legacy function bodies changed; all 122 goldens and the 23 HTTP parity cases still pass.

## Commits

- b4a6f92 refactor: backend.py pasa al paquete kaizen_api con FastAPI y rutas v1 idénticas, probadas con los 122 goldens
- d85413a feat: servicio kaizen-api en Render y script para generar los hashes scrypt de USERS
- 00fb569 docs: contrato del API v2 con convenciones, errores y referencia generada desde schemas.py
- d7040a4 test: contrato v2, sesión con JWT y límite de tasa, caché single-flight y capas de la app
- ad6b5a6 fix: record_fixtures conserva live_match al regenerar goldens en otra carpeta
- 413d86b fix: CORS expone Retry-After y X-Request-ID y acepta X-Request-ID del navegador
- b2de74e fix: con AUTH_REQUIRED o en producción la SECRET_KEY tiene que ser propia, nunca la llave de desarrollo pública

## Compuertas

- `"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q`: exit 0. With -o addopts="": 455 passed, 1 skipped (the live-network test) in about 4.1 s, offline. Up from 446 because of 9 new tests.
- `git archive 413d86b into scratch, then pytest -q -o addopts="" (the intermediate commit alone)`: 447 passed, 1 skipped
- `"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .`: All checks passed! ruff format --diff shows no new formatting drift in the 4 edited Python files compared with HEAD (main.py and settings.py 0 lines, test_app.py 10 before and 9 now, test_auth.py 4 before and 4 now). ruff format was not a gate before either.
- `Mutation checks: expose_headers removed / X-Request-ID removed from allow_headers / strict only in production / explicit DEV_SECRET_KEY accepted`: 1, 4, 1 and 4 tests failed respectively; files restored afterwards (git diff showed only the intended changes)
- `SECRET_KEY=$(openssl rand -hex 32) AUTH_REQUIRED=true USERS='{"demo":"clave-demo-123"}' .venv/bin/python scripts/run_replay_backend.py --module kaizen_api.main --port 8101, then curl`: /health with Origin https://newkaizen.vercel.app: 200, access-control-expose-headers 'Retry-After, X-Request-ID'. OPTIONS /v2/quotes with authorization and x-request-id: 200, allow-headers include X-Request-ID. /stock/AAPL without a token: 401 missing_token. With a login token: 200 and 0 diffs against get_stock__AAPL.json. With a DEV_SECRET_KEY-forged token: 401 token_invalid. Seventh bad login cross-origin: 429 with retry-after 12, the expose list, ACAO and x-request-id: front-7 echoed. Server stopped; 8101 confirmed free.
- `backend.py with PORT=8101 and: AUTH_REQUIRED=true without SECRET_KEY / AUTH_REQUIRED=true SECRET_KEY=<dev key> / KAIZEN_ENV=production SECRET_KEY=<dev key> / production + plaintext USERS`: All exit 1. Messages: 'KAIZEN API no arranca: SECRET_KEY es obligatoria con AUTH_REQUIRED activo', '... SECRET_KEY no puede ser la llave de desarrollo (está publicada en el repo) en producción ni con AUTH_REQUIRED activo' (twice), '... USERS tiene contraseñas en texto plano para: a ...'
- `env -u SECRET_KEY -u AUTH_REQUIRED -u KAIZEN_ENV PORT=8101 .venv/bin/python backend.py (live network, same config as the current kaizen-backend Render service)`: Starts with the dev-key warning. /health 200 with the expose header and ACAO for the Vercel origin. /fx {"USDMXN": 17.302} live. One log line per request with rid, no query string. Stopped; 8101 free.
- `node scripts/check-ownership.mjs S1`: ✓ S1 (ws/S1): 76 archivo(s), todos dentro de su propiedad. Working tree clean, no Co-Authored-By in the new commits.

## Pendientes

- CORS on the deployed legacy service: kaizen-backend (the Render service behind app-4-everyone.onrender.com) used to send `Access-Control-Allow-Origin: *`. It now allows only ALLOWED_ORIGINS, the newkaizen*.vercel.app regex and localhost (localhost because KAIZEN_ENV is unset there, which means development). If the old UI is served from any other origin, set ALLOWED_ORIGINS on that service before this deploys. render.yaml now says so in a comment.
- kaizen-backend still runs with the dev SECRET_KEY and plaintext USERS, with a startup warning. That is safe only because AUTH_REQUIRED is off there: no data route is gated, and /auth/me there accepts dev-key tokens, but it only returns a username. If someone turns on AUTH_REQUIRED on that service without their own SECRET_KEY, the service now refuses to start instead of running a bypassable auth. The new kaizen-api service is the production-hardened one.
- Starlette's CORSMiddleware sends Access-Control-Expose-Headers on every response that has an Origin header, including disallowed origins. This is harmless: those responses have no Access-Control-Allow-Origin, so the browser blocks the read anyway. The test asserts the missing ACAO rather than a missing expose header.
- Login rate limiting keys on the first X-Forwarded-For hop, as the spec requires. The client writes that hop, so the per-IP limit can be bypassed; the 10-per-hour per-user limit still stops brute force on a single account. An attacker who floods more than 10,000 distinct usernames can evict a victim's bucket. A stronger fix is to key on the rightmost untrusted hop.
- Legacy v1 text pinned by the goldens still contains em dashes that users can see, for example 'ETF/Fondo — valuación...', the EDGAR 'no está registrado ante la SEC — ...' message, and '—' placeholders in insiders/momentum. They cannot change without breaking parity. v2 text and docs have none; a test enforces this for docs/api-v2.md.
- Starlette 1.6 warns that TestClient on httpx is deprecated in favor of httpx2. I filtered that warning (and an anyio alias warning) in pyproject. The orchestrator may want to add httpx2 later; nothing is blocked, so I did not write a request.
- scripts/run_replay_backend.py does not set up the kaizen_api log handler, so the replay server prints only its startup lines, not the per-request line. Live `python backend.py` (run()) does print it. This is cosmetic and only affects tooling.
- Contract choices beyond the spec, frozen for review:
- Added error codes BAD_REQUEST, FORBIDDEN and METHOD_NOT_ALLOWED.
- Added meta.source tokens eodhd, curated and damodaran.
- Added capabilities legacy.v1 and one per v2 feature (KNOWN_CAPABILITIES).
- Quote.name, price and currency are required; numeric metrics are nullable.
- WorldItem.country is ISO 3166-1 numeric (3 digits, as the legacy map uses).
- RfSeries tenorDays accepts 28, 91, 182 or 364.
- screeners/factors rejects `symbols` unless universe=custom.
- /v2/events lives in routers/markets.py (B2).
- /v2/fx is in quotes.py and /v2/fx/history in history.py.
- CORS allows X-Request-ID in and exposes Retry-After and X-Request-ID; this is documented in docs/api-v2.md and is not a schemas.py change.
- Unknown paths now return 404 with the v2 ErrorBody; the old server returned 200 {"error": "Ruta no encontrada"}. Known legacy prefixes without a segment (e.g. /stock) still return that legacy 200. Docs and openapi.json are turned off in production.

## Notas para los siguientes streams

MODULE MAP (kaizen_api/)
- `__init__.py`: `__version__` = "2.0.0" and `reset_state()`.
- `main.py`: `create_app(settings=None)`, `run()`, and a lazy module attribute `app` built by `create_app()` on first access. Also holds RequestLogMiddleware, CatchAllMiddleware, V2_ROUTERS, `CORS_ALLOW_HEADERS` = (Authorization, Content-Type, X-Request-ID) and `CORS_EXPOSE_HEADERS` = (Retry-After, X-Request-ID).
- `settings.py`: `Settings.from_env(env)`, `get_settings()`, `configure()`, `SettingsError`, `DEV_SECRET_KEY`, `MIN_SECRET_LENGTH`.
- `errors.py`: `ApiError(status, code, message=None, details=None, headers=None)`, `not_implemented(endpoint)`, `invalid_param(field, type, msg)`, `field_error()`, handlers.
- `cache.py`: `_cached`, `_cache_get`, `_cache_put`, `_edgar_ticker_cache`, `register_reset(fn)`, `reset_state()`, `cache_stats()`.
- `provenance.py`: `meta(...)`, `utc_now()`, `iso_instant()`.
- `schemas.py`: FROZEN contract. Also exports `SYMBOL_PATTERN`, `KNOWN_CAPABILITIES`, `SOURCE_TOKENS`, `RESPONSE_MODELS`.
- `security/auth.py`: `hash_password`, `verify_password`, `authenticate`, `create_token`, `verify_token`, `require_user`, `current_user`, `app_settings`.
- `security/ratelimit.py`: `TokenBucket`, `LoginRateLimiter`, `client_ip`, `retry_after_header`.
- `providers/yahoo/session.py`: `yft()` and `_session` (FROZEN). `providers/yahoo/prices.py` (B2) and `providers/yahoo/fundamentals.py` (B3) are placeholders with yfinance 1.7 facts in their docstrings. `providers/yahoo/news.py`: `_extract_news_item`.
- `providers/fred.py`: `_fred_rate`. `providers/rss.py`: `_rss_news`. `providers/sec_edgar.py`: legacy EDGAR including `get_edgar_financials`.
- `providers/banxico.py`: `require_token()` (503 NOT_CONFIGURED without a token), SIE ids, `fetch_series` stub. `providers/eodhd.py`: stub. `providers/replay.py`: re-exports tests.replay `install_replay` (tooling only).
- `domain/__init__.py`: legacy `safe`, `pct`, `r2`, `_log`.
- `domain/fx.py`: `get_fx` and the `convert` seam. `domain/history.py`: `get_chart`, `get_returns`, `_fetch_hist`, `_is_mxn`, and the `get_series` seam returning `PriceSeries`.
- `domain/rates.py`: `get_rf`. `domain/macro.py`: `get_macro`, `_cboe_vix`, `_stooq_dxy`. `domain/markets.py`: `get_market`, `get_worldmap`, `_bulk_download`, `_MARKET_SYMS`, `_WORLDMAP_SYMS`. `domain/news.py`: `get_news`, `get_market_news`, `classify_sentiment`, word lists.
- Placeholders: `domain/tone.py`, `domain/search.py`, `domain/market_calendar.py`.
- `domain/fundamentals.py`: `get_stock`, `_div_yield_pct`, `_debt_to_assets`, `_leverage_ratio`. `domain/statements.py`: re-exports `get_edgar_financials`. `domain/universe.py`: `MAGIC_UNIVERSE`, `EXCLUDED_SECTORS`, `FIBRAS_LIST`, `SECTOR_ETF`.
- `domain/valuation/multiples.py`: `get_dcf` (despite the name, it is multiples, not a DCF). `domain/valuation/dcf.py` and `params.py` are placeholders.
- `domain/screeners/`: `magic.py`, `fibras.py`, `insiders.py`, `momentum.py`; `factors.py` is a placeholder.
- `routers/__init__.py`: shared `CACHE_SECONDS`, `cache_control(cls)`, `no_store`, `ERROR_RESPONSES`, `SymbolPath`, `Symbols`, `parse_symbols`, `IsoDateQuery`, `check_date_range`.
- `routers/health.py` and `routers/auth.py` (B1). `routers/quotes.py` (/v2/quotes, /v2/fx), `history.py` (/v2/history, /v2/panel, /v2/fx/history), `rates.py`, `markets.py` (overview, world, events), `news.py`, `search.py` (all B2). `routers/research.py` (instrument, statements, dividends, valuation, momentum) and `screeners.py` (factors, magic, fibras, insiders) (B3). `routers/legacy_v1.py`: `LEGACY_FUNCTIONS` registry and the v1 routes.
- `data/`: empty except .gitkeep.

SECRET_KEY RULE (new, B1 please keep it)
- In production, and whenever AUTH_REQUIRED=true in any environment, SECRET_KEY must be set, at least 32 characters, and different from DEV_SECRET_KEY (which is public in the repo). Otherwise Settings.from_env raises SettingsError and the server does not start.
- The dev key is used only in development with AUTH_REQUIRED off, with a warning.
- `Settings.__post_init__` also rejects the dev key combined with auth_required or production, so do not build `Settings(auth_required=True)` by hand without a real `secret_key`.
- Tests that need auth pass an explicit SECRET_KEY (see `make_settings` in tests/unit/test_auth.py).

FROZEN SEAMS
- `schemas.py`, plus the model reference block of `docs/api-v2.md`, which is generated.
- `provenance.meta(source, as_of=None, delay_minutes=None, stale=False, fallback=False, notes=None)`.
- `domain.history.get_series(symbol, range='1y', interval='1d', ccy='native') -> PriceSeries(symbol, currency, interval, dates, close, source, as_of, fx_pair, fx_source, notes, adjusted)`: adjusted closes; FX of the same date, forward-filled at most 3 days and noted; raises ApiError when there is no data. Currently raises NotImplementedError.
- `domain.fx.convert(amount_or_series, from_ccy, to_ccy, on=None)`: identity when the currency is the same, otherwise NotImplementedError; never falls back to a fixed 17.5.
- `providers/yahoo/session.yft()`.
- The legacy function bodies must stay identical while the v1 routes exist.

HOW A B-STREAM ADDS AN IMPLEMENTATION
1. Write the domain logic in your module next to the legacy code. Do not edit the legacy bodies: parity is checked against the goldens, including upstream keys.
2. Put all I/O through yfinance (as `yf.Ticker` or `yft()`) or requests. The replay only patches those; httpx and urllib are not recorded.
3. Replace `raise not_implemented(...)` in your router with code that returns a dict matching the `response_model`. It must include `"meta": meta("yahoo", as_of=..., ...)`. Extra keys or mismatched array lengths produce a 500. Raise `ApiError(503, "UPSTREAM_UNAVAILABLE")` when there is no real data.
4. Append the capability string to that router's `CAPABILITIES` list; /health then advertises it. Values must come from `schemas.KNOWN_CAPABILITIES`.
5. Tests go in `tests/unit/<b1|b2|b3>/`:
   - `TestClient(create_app(Settings.from_env({...})), raise_server_exceptions=False)`, wrapped in `with replaying('2026-09-22') as rp: kaizen_api.reset_state(); r = client.get(...)`.
   - Assert `rp.misses == []` and validate with `Model.model_validate(r.json())`.
   - Record new upstream calls with `with recording('2026-09-22'): ...`, or add specs in scripts/record_fixtures.py.
   - With AUTH_REQUIRED=true you must also pass SECRET_KEY (32+ characters, not the dev key).
   - Stubs you implement stop returning 501, so remove them from the `SPEC`/`STUBS` checks in tests/contract/test_schemas.py through a request to the orchestrator (S1 owns that file), or add your own contract assertions.
6. Register module caches with `cache.register_reset(fn)`.
7. If a response needs a new header that browser JS must read, add it to `CORS_EXPOSE_HEADERS` in main.py; custom request headers go in `CORS_ALLOW_HEADERS`.

CONTRACT CHANGES
Only through `docs/requests/<stream>.md`. After an approved change, regenerate the docs with:
`KAIZEN_WRITE_DOCS=1 .venv/bin/python -m pytest tests/contract -k docs_reference`

RUN LOCALLY (the venv is `/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv`)
- Replay, offline with a frozen clock: `.venv/bin/python scripts/run_replay_backend.py --port 81xx`. Add `USERS='{"demo":"demo"}'` to test login; legacy routes are on by default in dev. To test the auth gate: `SECRET_KEY=$(openssl rand -hex 32) AUTH_REQUIRED=true USERS='{"demo":"clave-demo-123"}' ...`.
- Live: `PORT=81xx .venv/bin/python backend.py`.
- Production-like: `KAIZEN_ENV=production SECRET_KEY=<32+ chars, not the dev key> USERS=$(python scripts/hash_password.py --user x ...) AUTH_REQUIRED=true`.
- Tests: `.venv/bin/python -m pytest -q` (add `-o addopts=""` to see counts; currently 455 passed, 1 skipped) and `.venv/bin/ruff check .`.

FRONTEND NOTES (S2 and F-streams)
- The v2 base path is /v2; /health and /auth/* sit at the root.
- The token goes in `Authorization: Bearer`; login returns `{token, expiresAt, user{username, displayName}}`.
- Errors come as `{error:{code,message,details?}}`. Show `message`.
- On 429 the `Retry-After` header (seconds) is readable cross-origin, because it is in Access-Control-Expose-Headers.
- Every response has an `X-Request-ID`, also readable cross-origin. The client may send its own `X-Request-ID` (allowed in the CORS preflight, format `[A-Za-z0-9._-]{1,64}`), and the server echoes it back and logs it.
- /health `capabilities` lists what works today; use it to hide unimplemented features.
- Allowed origins: ALLOWED_ORIGINS plus `^https://newkaizen(-[a-z0-9-]+)?\.vercel\.app$`, plus http://localhost:* and http://127.0.0.1:* outside production. No credentials mode.

KEY FILES
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/kaizen_api/schemas.py
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/docs/api-v2.md
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/kaizen_api/main.py
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/kaizen_api/settings.py
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/kaizen_api/routers/legacy_v1.py
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/tests/characterization/test_package_parity.py
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/tests/contract/test_schemas.py
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/tests/unit/test_app.py
- /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S1/tests/unit/test_auth.py

# Revisión independiente de S1 (antes de la corrección)

Veredicto: **pass_with_issues**

## Comandos

- OK `"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q (and -o addopts="")`: Exit 0, offline: 446 passed, 1 skipped (the live test) in about 4.2 s. Collected per file: 148 package parity (122 per-golden + 23 HTTP + 3), 124 legacy-golden integrity, 82 contract, 25 app, 18 auth, 8 cache, 2 replay server, 40 replay. That totals 447, matching the claim, except unit tests are 51 not 52.
- OK `ruff check .`: All checks passed. backend.py is no longer excluded. Per-file ignores cover only the 8 modules with verbatim legacy code.
- OK `AST comparison of `git show 17fe470:backend.py` against kaizen_api/**`: 62 top-level defs and assigns are AST-identical. Only _cache_put, _cached and _TICKER_RE differ, all on purpose; the _TICKER_RE pattern string is identical. Missing: PORT, _get_users, check_login, Handler, _prewarm, as documented. The goldens in tests/goldens_legacy and tests/fixtures are untouched.
- OK `record_fixtures.py --goldens-only --goldens-dir <scratch>`: All 122 goldens regenerated offline, identical to the committed ones except the 'module' field.
- OK `Mutation checks on a git-archive copy (not the worktree)`: Caught: pct() rounding changed to 3 decimals (8 failures) and the single-flight lock removed (the cache test fails). Survived, both in code the goldens do not cover: the get_stock history-fallback price rounding, and the legacy /chart default period 5y changed to 1y (every HTTP case passes an explicit period).
- OK `USERS='{"demo":"clave-demo-123"}' python scripts/run_replay_backend.py --module kaizen_api.main --port 8111 + curl`: /health: 200, apiVersion 2, capabilities [auth, legacy.v1], no-store. /auth/login: 200 with token and expiresAt 2026-09-23T02:51:31Z. /auth/me: 200. Wrong password: 401. /stock/AAPL (2558 B) and /chart/WALMEX.MX?period=1y&ccy=MXN: 0 diffs against their goldens. /v2/quotes?symbols=AAPL: 501 NOT_IMPLEMENTED ErrorBody. /v2/history/%3Cbad%3E and a bad symbol in a list: 400 INVALID_SYMBOL. range=7y: 422. v1 /stock/AAPL%20X: 200 {"error":"Ticker inválido"}. Unknown path: 404. Legacy POST /login semantics hold. Server stopped; port 8111 free.
- OK `Same replay server with AUTH_REQUIRED=true on 8111`: /health stays public. v1 and v2 routes return 401 without a token. An alg=none token gets 401. Login rate limit: 6th attempt from one IP gets 429 with Retry-After 12; with rotating X-Forwarded-For the per-user limit trips at 10, and then even the correct password gets 429. A JWT forged with the public DEV_SECRET_KEY was ACCEPTED (200 on /stock/AAPL), see defects. Stopped.
- OK `PORT=8111 python backend.py (live) + curl /health, /fx?secret=abc, /v2/quotes`: /health: 200 v2 shape. /fx: {"USDMXN": 17.3075}. /v2/quotes: 501. The log has one line per request with no query string ('GET /fx 200 539ms rid=...'). Stopped; port free.
- OK `KAIZEN_ENV=production python backend.py (no SECRET_KEY / plaintext USERS)`: Both runs exit 1 with a clear Spanish message. However, production accepts SECRET_KEY equal to the public dev key, and USERS entries like 'scrypt$garbage', with no error and no warning.
- OK `TestClient probes: 500 leak, response_model violation, CORS headers`: An unexpected exception and an extra/missing response field both return 500 INTERNAL with a generic Spanish message, no exception text, CORS headers kept, no-store. A cross-origin 429 has NO Access-Control-Expose-Headers. A preflight asking for x-request-id is rejected with 400.
- FALLA `KAIZEN_ENV=production SECRET_KEY=... USERS="$(python scripts/hash_password.py --user x --password ...)" (the recipe in notes_for_next_streams)`: Refused with 'USERS no es JSON válido': the script prints the hash, a blank line and a caption before the JSON, so the documented recipe fails.
- OK `node scripts/check-ownership.mjs S1`: 76 files, all within S1's ownership. Worktree clean; no Co-Authored-By trailers; commit messages are one-line Spanish.

## Defectos

- [major] CORS does not expose the headers the contract tells the frontend to use. CORSMiddleware in kaizen_api/main.py sets no expose_headers. On a cross-origin 429 from /auth/login (Origin https://newkaizen.vercel.app), the response has Retry-After and X-Request-ID but no Access-Control-Expose-Headers, so browser JS on Vercel cannot read either one. Yet docs/api-v2.md and the notes say 'Retry-After comes with 429' and that a client-sent X-Request-ID is honored. Sending X-Request-ID cross-origin is also impossible: a preflight with Access-Control-Request-Headers x-request-id gets 400 'Disallowed CORS headers'. Fix: add expose_headers=["Retry-After", "X-Request-ID"] and add X-Request-ID to allow_headers (or drop that claim from the docs). Add a test asserting access-control-expose-headers on a cross-origin 429.
- [major] The public dev JWT key is usable whenever KAIZEN_ENV is not 'production', even with AUTH_REQUIRED=true. The repo is public. A token forged with DEV_SECRET_KEY='kaizen-dev-secret-key-solo-para-desarrollo-local' (jwt.encode({sub:'demo', iat, exp, ver:1}, DEV_KEY)) got 200 on /stock/AAPL with AUTH_REQUIRED=true. The stream's own open issue confirms the existing Render service kaizen-backend runs with KAIZEN_ENV unset (development), so turning on AUTH_REQUIRED there gives an auth that anyone can bypass. Production also accepts SECRET_KEY set to exactly DEV_SECRET_KEY (48 chars passes the length check). The risk is latent today, since no deployed service has AUTH_REQUIRED on outside production. Fix in Settings.from_env: raise SettingsError when AUTH_REQUIRED is true and SECRET_KEY is unset or equals DEV_SECRET_KEY, regardless of env; always reject secret == DEV_SECRET_KEY in production. Tests that need auth can pass an explicit SECRET_KEY.
- [minor] Production does not validate USERS hashes, contrary to the summary's claim that it refuses to start with malformed USERS. Settings.from_env with KAIZEN_ENV=production and USERS='{"a":"scrypt$garbage"}' starts with no error and no warning, and that user can never log in. The same applies to non-string values, which are only warned about. Fix: run security.auth._parse_hash (move it to settings or a shared helper) on every scrypt$ entry at startup; SettingsError in production, warning otherwise.
- [minor] The notes_for_next_streams 'Production-like' recipe is wrong. `USERS=$(python scripts/hash_password.py --user x ...)` captures the hash line, a blank line, the 'USERS de ejemplo...' caption and the JSON, so production refuses to start with 'USERS no es JSON válido' (reproduced). Fix: add a --json flag to scripts/hash_password.py that prints only the JSON object (the caption to stderr), and update the notes and docs/api-v2.md.
- [minor] The login rate limiter's per-user bucket (10/hour) counts successful logins, and there is no setting to relax it. Reproduced: 9 wrong passwords from rotating X-Forwarded-For values lock the real user out; their correct password then gets 429, both on /auth/login and on legacy /login. Anyone who knows a username can keep an account locked indefinitely. Separately, E2E suites against run_replay_backend that log in more than 5 times a minute from 127.0.0.1 will hit 429. Fix: count only failed attempts in the per-user bucket (refund the token on success). Add LOGIN_RATE_LIMIT (or per-IP/per-user values) in settings that can be relaxed only outside production, and document it for S2 and F-streams.
- [minor] Empty query values are handled inconsistently. /v2/news?symbol=&lang=es returns 400 INVALID_SYMBOL, while empty extra= and symbols= on the screeners are treated as absent. A client that builds URLs with an empty symbol for market news will fail. Fix: in routers/news.py, map an empty symbol to None before pattern validation (e.g., a dependency that strips it), and add a contract case.
- [minor] The frozen contract has loose or over-strict string types. NewsItem.url and InstrumentResponse.website accept any string, including javascript: URLs coming from RSS. Currency (^[A-Z]{3}$) rejects Yahoo's minor-unit codes GBp and ZAc, so any LSE/JSE instrument B2/B3 passes through would 500. Because schemas.py freezes now, fix before M1: add an ^https?:// pattern to url and website, and document that providers normalize GBp/ZAc to GBP/ZAR (dividing by 100) before building responses.
- [minor] Some legacy HTTP differences are not documented in the legacy_v1 docstring or docs/api-v2.md. POST to any path other than /login now returns 405 METHOD_NOT_ALLOWED (was 200 {"error":"Not found"}). A bare OPTIONS without CORS preflight headers now returns 405 (was 200 with ACAO *). Load above limit_concurrency=64 gets a plain-text 503 with no CORS and no ErrorBody. The legacy UI (src/App.jsx) uses none of these, so the impact is low. Fix: document them in the legacy_v1 docstring and api-v2.md.
- [minor] Legacy v1 routes still put exception text in 200 bodies, as parity requires. Verified: get_fx raising RuntimeError('upstream token=abc123') gives 200 {"error": "upstream token=abc123"}. They are mounted on any non-production deployment, including kaizen-backend on Render. Fix: accept it for parity until the legacy UI is cut over, but record it in the known-debt list and drop legacy routes from any public deployment as soon as the new UI ships.
- [minor] Coverage gaps in legacy parity, inherited from R0's golden set. Mutations in branches the goldens never exercise pass the whole suite: the get_stock history-fallback price rounding (kaizen_api/domain/fundamentals.py:73), and the legacy /chart default period when ?period is missing. The legacy UI always sends period, so the risk is low. Fix: document in the parity test that parity is per recorded path, and record a golden for the no-period /chart call if the orchestrator wants that default pinned.
- [minor] The default CORS regex ^https://newkaizen(-[a-z0-9-]+)?\.vercel\.app$ admits any Vercel project whose name starts with newkaizen-. A preflight from https://newkaizen-attacker.vercel.app returns 200 with ACAO echoed. Impact is low because tokens travel in the Authorization header and allow_credentials is False, and the regex came from the task. Fix (optional): scope the regex to the team suffix Vercel uses for preview URLs and list the production origin in ALLOWED_ORIGINS.