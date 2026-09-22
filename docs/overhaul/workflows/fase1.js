export const meta = {
  name: 'newkaizen-phase1',
  description: 'Phase 1: backend package + FastAPI + v2 contract (S1) and frontend skeleton with router, api client, session, storage (S2)',
  phases: [
    { title: 'Build', detail: 'S1 and S2 in parallel worktrees' },
    { title: 'Review', detail: 'independent reviewer per stream' },
    { title: 'Fix', detail: 'stream fixes reviewer defects' },
  ],
}

const MAIN = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN'
const WT = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt'
const DOCS = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/docs/overhaul'
const COMMON = (id, web, api) => `You are stream ${id} of a multi-agent overhaul of NEWKAIZEN, a Spanish-language (es-MX) investing app: React 19 + Vite 8 plain-JS SPA (legacy src/App.jsx, 5,512 lines) and a Python backend (backend.py, yfinance/FRED/CBOE/Stooq/EDGAR/RSS). Goal: an affordable "Bloomberg" for Mexican/US retail investors and employer financial-wellness programs, correct per finance theory, honest about data provenance.

WORKING RULES (mandatory):
- Work ONLY inside your git worktree "${WT}/${id}" (branch ws/${id}). Never edit "${MAIN}" or other worktrees.
- Read docs/OWNERSHIP.md first. Only create/modify files matching your stream's globs in scripts/ownership.json. Never touch package.json, package-lock.json, requirements*.txt (all deps already installed: react-router 7, @tanstack/react-query 5, @fontsource-variable/plus-jakarta-sans + jetbrains-mono, vitest 4, jsdom, testing-library, @playwright/test 1.62.1, @axe-core/playwright, typescript 6; Python venv "${MAIN}/.venv" has fastapi 0.141, uvicorn 0.53, PyJWT 2.14, yfinance 1.7, pandas 3, numpy 2.4, requests, curl_cffi, pytest 9, httpx, responses, time-machine, ruff). Missing something? write docs/requests/${id}.md and work around it.
- git: DEVELOPER_DIR=/Library/Developer/CommandLineTools git ... . Commit on ws/${id} in a few logical commits, one-line Spanish messages with accents (e.g. "feat: ...", "refactor: ...", "test: ..."), NO Co-Authored-By trailer. Do not push or merge.
- Finish with: node scripts/check-ownership.mjs ${id} (must pass).
- Your ports: web ${web} and ${web + 1}, API ${api}. Never use 8002, 5180, 4180 (owner's servers).
- Test tooling from Phase 0 (read its handoff notes): Q0 notes at ${DOCS}/notas/fase0-Q0.md, R0 notes at ${DOCS}/notas/fase0-R0.md. NOTE an update to R0's notes: automatic volatile-field masking was DISABLED (replay freezes clock and data, so goldens compare every field strictly; volatile_paths are now all empty).
- User-visible text: natural es-MX, no em/en dashes (— –), no BUY/SELL advice language. Missing numeric values display as "s/d".
- Write long notes/reports with bash heredocs if the Write tool is blocked for them.
- Rigor: run every command you report; never claim success from reading code.`

const RESULT = {
  type: 'object',
  properties: {
    stream: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    gates: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, result: { type: 'string' } }, required: ['cmd', 'result'] } },
    open_issues: { type: 'array', items: { type: 'string' } },
    notes_for_next_streams: { type: 'string' },
  },
  required: ['stream', 'commits', 'summary', 'gates', 'open_issues', 'notes_for_next_streams'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'pass_with_issues', 'fail'] },
    commands: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['cmd', 'ok', 'detail'] } },
    defects: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, description: { type: 'string' } }, required: ['severity', 'description'] } },
  },
  required: ['verdict', 'commands', 'defects'],
}

const S1 = `${COMMON('S1', 5201, 8101)}

YOUR TASK (S1): turn backend.py into the package kaizen_api/ served by FastAPI, with IDENTICAL legacy behavior proven by the characterization goldens, plus the frozen API v2 contract (schemas + docs + pre-registered stub routes) that stream B1/B2/B3 will implement next.
READ FIRST: ${DOCS}/specs/api-v2-spec.md (the contract, authoritative), backend.py in full, tests/replay/*, tests/characterization/*, scripts/run_replay_backend.py, scripts/record_fixtures.py, pyproject.toml.

1. Package layout (create exactly these modules; move the legacy functions into the file where their v2 replacement will live, keeping names and bodies unchanged except imports):
   kaizen_api/__init__.py; main.py (create_app(), run()); settings.py (env: PORT=8002, KAIZEN_ENV=development|production, AUTH_REQUIRED=false, SECRET_KEY (dev default only when not production; production without it must refuse to start), USERS (JSON {username: "scrypt$n$r$p$salt_hex$hash_hex"} or legacy plaintext accepted ONLY when not production, with a warning), TOKEN_TTL_HOURS=12, TOKEN_VERSION=1, ALLOWED_ORIGINS (comma list), ALLOWED_ORIGIN_REGEX (default ^https://newkaizen(-[a-z0-9-]+)?\\.vercel\\.app$ plus http://localhost:* and http://127.0.0.1:* when not production), KAIZEN_LEGACY_ROUTES (default on unless production), BANXICO_TOKEN, FRED_API_KEY, EODHD_API_TOKEN, KAIZEN_VERSION, RENDER_GIT_COMMIT); errors.py (ApiError(status, code, message, details) + exception handlers: ApiError, RequestValidationError→422 VALIDATION_ERROR, StarletteHTTPException, catch-all 500 INTERNAL with no exception text; all bodies {error:{code,message}} with Spanish messages); cache.py (the legacy TTL + single-flight cache moved here, with the race in lock cleanup fixed, plus reset_state()); provenance.py (meta(source, as_of=None, delay_minutes=None, stale=False, fallback=False, notes=None) -> dict with generatedAt; FROZEN signature); security/__init__.py, security/auth.py (hash_password/verify_password with hashlib.scrypt n=2**14 r=8 p=1 and hmac.compare_digest; create_token/verify_token HS256 via PyJWT with sub, exp, iat, ver=TOKEN_VERSION; FastAPI dependency require_user that enforces Bearer only when AUTH_REQUIRED), security/ratelimit.py (an in-memory token bucket class, thread-safe, used by /auth/login: 5/min per client IP from X-Forwarded-For first hop else client host; 10/hour per username; 429 with Retry-After); schemas.py (pydantic v2 models for EVERY v2 response in the spec, including Meta and ErrorBody; FROZEN after this phase); providers/__init__.py, providers/yahoo/__init__.py, providers/yahoo/session.py (the yft() helper and the requests _session; FROZEN), providers/yahoo/prices.py, providers/yahoo/news.py, providers/yahoo/fundamentals.py, providers/banxico.py (stub raising ApiError NOT_CONFIGURED when no token), providers/fred.py (legacy _fred_rate etc.), providers/sec_edgar.py (legacy EDGAR), providers/rss.py (legacy _rss_news), providers/eodhd.py (stub), providers/replay.py (thin re-export of tests.replay install_replay for run_replay_backend; do not duplicate logic); domain/__init__.py and domain modules fx.py (get_fx; plus FROZEN seam convert(amount_or_series, from_ccy, to_ccy, on=None) documented but may raise NotImplementedError until B2), history.py (get_chart, get_returns, _fetch_hist; FROZEN seam get_series(symbol, range, interval, ccy) signature documented, NotImplementedError until B2), rates.py (get_rf), macro.py (get_macro and helpers), markets.py (get_market, get_worldmap, _bulk_download), news.py (get_news, get_market_news, classify_sentiment), tone.py (empty placeholder with docstring), search.py (placeholder), market_calendar.py (placeholder), fundamentals.py (get_stock and helpers), statements.py (get_edgar_financials wrapper if appropriate), universe.py (MAGIC_UNIVERSE and CANDIDATE lists), valuation/__init__.py, valuation/multiples.py (get_dcf and sector tables), valuation/dcf.py (placeholder), valuation/params.py (placeholder), screeners/__init__.py, screeners/magic.py, screeners/fibras.py, screeners/momentum.py, screeners/insiders.py, screeners/factors.py (placeholder); routers/__init__.py and routers health.py, auth.py, quotes.py, history.py, rates.py, markets.py, news.py, search.py, research.py, screeners.py, legacy_v1.py; data/ (empty dir with .gitkeep).
   Keep module-level state (caches, sessions) in one place so reset_state() works; expose kaizen_api.reset_state().
2. routers/legacy_v1.py reproduces EVERY old route of backend.py do_GET/do_POST with identical response bodies and HTTP-200-with-{"error"} semantics (/stock/{t}, /chart/{t}?period&ccy, /rf, /news/market, /news/{t}, /macro, /market, /worldmap, /dcf/{t}, /edgar/{t}, /fibras[/{extra}], /magic, /magic_one/{t}, /insiders/{t}, /momentum/{t}, /returns/{t}, /fx, POST /login legacy semantics), ticker validation identical, mounted only when KAIZEN_LEGACY_ROUTES is on; when AUTH_REQUIRED is on they require the bearer token too. DROP /debug/macro and the startup prewarm (document it). Note legacy /health: the NEW /health replaces it (spec shape); the legacy UI only checks status=="ok".
3. v2 routers: register EVERY endpoint of the spec with its query/path params validated (Query/Path with regex/enum/limits) and response_model from schemas.py. Implement now: GET /health (spec shape; apiVersion 2; capabilities list honestly reflects what is implemented TODAY: just ["auth"] plus anything real), POST /auth/login and GET /auth/me (real: verify against USERS, issue JWT, rate limit). All other v2 endpoints return 501 NOT_IMPLEMENTED via ApiError (B-streams implement them). Add Cache-Control per data class via a small helper in each router.
4. main.py: CORS middleware (allow_origins from settings, allow_origin_regex, allow_methods GET/POST/OPTIONS, allow_headers Authorization/Content-Type, max_age 600, allow_credentials False), GZipMiddleware(minimum_size 1024), request-id + timing logging middleware (one line per request: method path status ms, no query secrets), exception handlers, routers. run(): uvicorn.run(app, host 0.0.0.0, port settings.PORT, workers 1, limit_concurrency 64, timeout_keep_alive 5, proxy_headers True, forwarded_allow_ips "*", log_level info). backend.py becomes the shim: from kaizen_api.main import run; if __name__ == "__main__": run(). Procfile unchanged. render.yaml: a NEW service "kaizen-api" (runtime python, branch analizavende, autoDeploy true, plan free, buildCommand pip install -r requirements.txt, startCommand python backend.py, healthCheckPath /health, envVars: PYTHON_VERSION 3.11.8, KAIZEN_ENV production, AUTH_REQUIRED "true", and sync:false keys SECRET_KEY, USERS, ALLOWED_ORIGINS, BANXICO_TOKEN, FRED_API_KEY).
5. scripts/hash_password.py: prompts (getpass) or reads --password, prints the scrypt$... string and a ready-to-paste USERS JSON example.
6. Tests (all offline under the existing network guard):
   - tests/characterization/test_package_parity.py: for EVERY golden in tests/goldens_legacy, call the corresponding kaizen_api function inside replaying(set) and assert compare(...) == [] and no misses. Also an HTTP-level parity test: with KAIZEN_LEGACY_ROUTES on, FastAPI TestClient GET of a representative set of legacy routes (stock, chart with ccy, market, macro, rf, fibras, magic_one) returns JSON equal to normalize(golden output).
   - Keep tests/characterization/test_legacy_goldens.py working against the OLD code? The old functions no longer live in backend.py, so repoint it (or fold into the parity test) so the suite stays meaningful; do not delete goldens.
   - tests/contract/test_schemas.py: every registered v2 route has a response_model; OpenAPI schema generates; 501 bodies match ErrorBody.
   - tests/unit/test_auth.py: hash/verify roundtrip; wrong password; token expiry (time-machine); TOKEN_VERSION bump revokes; login rate limit 429 with Retry-After; AUTH_REQUIRED gates a v2 route and a legacy route; /health stays public.
   - tests/unit/test_cache.py: single-flight under threads (one upstream call for N concurrent gets), TTL expiry, fail_ttl.
   - Update scripts/run_replay_backend.py so --module kaizen_api.main serves the FastAPI app under replay (it may already support ASGI) and scripts/record_fixtures.py so it records by calling kaizen_api functions.
7. ruff check . must pass with the existing pyproject.toml (you may add kaizen_api-specific per-file ignores if justified; backend.py is now tiny and should be linted too: remove it from extend-exclude).
DONE CRITERIA (paste results): "${MAIN}/.venv/bin/python" -m pytest -q (all green, offline; report counts incl. parity count = number of goldens); ruff check .; start "${MAIN}/.venv/bin/python" scripts/run_replay_backend.py --module kaizen_api.main --port 8101 and curl /health, /auth/login (with a test USERS env), /stock/AAPL, /chart/WALMEX.MX?period=1y&ccy=MXN, /v2/quotes?symbols=AAPL (expect 501 JSON), an invalid symbol (expect 422/400), then stop it; start "${MAIN}/.venv/bin/python" backend.py with PORT=8101 (live network allowed here, quick) and curl /health then stop; node scripts/check-ownership.mjs S1. Write docs/api-v2.md (Spanish or English, precise, generated from/consistent with schemas.py, including units conventions and error codes) and, in notes_for_next_streams, the exact module map, frozen seams, how B-streams should add an implementation + test, and how to run the API locally.`

const S2 = `${COMMON('S2', 5202, 8102)}

YOUR TASK (S2): the new frontend skeleton around the legacy app, WITHOUT changing how the legacy app looks. Read first: ${DOCS}/specs/frontend-spec.md (authoritative), ${DOCS}/specs/api-v2-spec.md (API contract the client targets), src/App.jsx (legacy), src/main.jsx, src/theme.js, src/ui.jsx, src/index.css, index.html, vite.config.js, playwright.config.js, e2e/support/*, e2e/baseline.spec.js.
1. git mv src/App.jsx src/legacy/App.legacy.jsx (fix its relative imports). Make only these legacy edits: (a) export a LegacyWorkspaceHost({ tab }) that does what the old App did after login (detect backend via BACKEND_CANDIDATES/VITE_API_URL and render Workspace) and opens the given tab; (b) DELETE the LoginScreen, AUTH_QUOTES and the hardcoded "Investments" password path and localStorage auth flag so they are no longer in the bundle (verify with grep on the built dist-e2e/dist JS that "Investments" is absent); (c) nothing else, so the legacy UI renders pixel-identically.
2. src/main.jsx mounts src/app/AppRoot.jsx; import the two @fontsource-variable fonts there and remove the Google Fonts @import from src/index.css (CSS font-family names must still resolve: check what family names @fontsource-variable exposes, e.g. "Plus Jakarta Sans Variable", and alias them in index.css with @font-face or by updating the --font-sans/--font-mono values in index.css (not theme.css, which belongs to stream C) so the legacy baseline stays visually identical; if the font rendering differs slightly, report pixel diffs honestly).
3. src/app/: AppRoot.jsx (providers per spec; ErrorBoundary friendly Spanish message with "Recargar" and no stack trace in production, stack only in DEV), router.jsx (createBrowserRouter; public routes, private layout with RequireAuth; imports every features/<area>/routes.jsx; NotFound), paths.js (all path constants + helpers like pathInstrument(symbol)), RequireAuth.jsx, ErrorBoundary.jsx, NotFound.jsx, CapabilitiesBanner.jsx (non-blocking "Despertando el servidor…" / "Servidor sin actualizar" banners).
4. src/features/<area>/routes.jsx for markets, portfolio, research, tools, watchlist, learn, onboarding, auth, legal (placeholders per spec: LegacyPage for legacy-mapped routes via src/features/<area>/LegacyPage.jsx or a shared component, "Próximamente" placeholder page for new-only routes). features/auth must contain a WORKING minimal login page (username + password, calls session.login, shows Spanish errors for 401/429/network, redirects to ?next) that F5 will restyle later.
5. src/lib/api/{client.js, capabilities.js, legacy.js, endpoints.js, queries.js, types.js} per spec; src/lib/auth/session.js; src/lib/format.js (+ format.test.js with many cases incl. U+2212 minus, s/d, compact, pp, pb, dates in America/Mexico_City); src/lib/storage.js (+ storage.test.js covering migration from both legacy keys, $MXN as deposit, backup keys, never deleting legacy keys, malformed input, import/export roundtrip); src/lib/csv.js (+ test: BOM, injection guard for = + - @ leading cells, quotes/newlines, parse roundtrip); src/lib/portfolio/usePortfolios.js; src/lib/finance/ledger.js (STUB: export function derivePositions(transactions, { asOf } = {}) returning [{ symbol, quantity, avgCost, currency, costBasis }] with average-cost logic for buy/sell/split and JSDoc; stream A will replace the internals keeping the signature); src/components/ui/UiProvider.jsx (pass-through stub).
6. vite.config.js: keep react plugin; add build.rollupOptions.output.manualChunks to split react/react-dom/react-router/@tanstack into a vendor chunk only if it helps the first-route budget; set build.sourcemap false; nothing else.
7. vercel.json: SPA rewrite of every non-asset path to /index.html; headers for "/(.*)": Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.onrender.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy camera=(), microphone=(), geolocation=(), X-Frame-Options DENY; "/assets/(.*)" Cache-Control public, max-age=31536000, immutable. .env.example documenting VITE_API_URL, VITE_ALLOW_LEGACY, VITE_SKIP_LOGIN (dev only).
8. index.html: lang="es-MX", title "Kaizen · Mercados, portafolio e investigación", meta description in Spanish, theme-color for light and dark via media, no external resources.
9. Tests:
   - Unit (vitest): format, storage, csv, session (login success/401/429 via mocked fetch, expiry), client (ApiError parsing, cold-start retry only for GET 502/503/network, no retry on 4xx, 401 → clear session + event), capabilities (legacy detection), ledger stub basics.
   - e2e: keep e2e/baseline.spec.js GREEN WITHOUT updating snapshots (the legacy must look the same; the baseline visits "/" which must now redirect to /mercados and show the legacy Noticias tab through LegacyPage; with VITE_SKIP_LOGIN=true in the baseline dev server a dev session exists). If fonts via @fontsource change rendering, investigate and fix so the diff stays within the budget; only if truly impossible, explain the pixel diff with evidence and regenerate snapshots in a separate commit stating why.
   - e2e/app.spec.js on the app projects (desktop 1440x900, mobile 390x844; build --mode e2e with VITE_API_URL=http://api.test): (a) unauthenticated visit to /portafolio redirects to /login; (b) login form with mocked POST http://api.test/auth/login 200 → lands on /portafolio; 401 shows "Usuario o contraseña incorrectos"; 429 shows a wait message; (c) seeded session + mocked /health {apiVersion:2} → /mercados renders the legacy Noticias through LegacyPage using legacy v1 responses served from the legacy HAR (map http://127.0.0.1:8002 → http://api.test; you may create a derived fixture under e2e/fixtures/app/); (d) unknown route shows NotFound; (e) guards clean (no console errors, no failed requests) on every test; (f) axe (WCAG 2.1 AA tags) on /login and NotFound with zero violations.
DONE CRITERIA (paste): npm run lint; npm run typecheck (src/lib must type-check); npm run test; npm run build && npm run bundle (report KB); grep -c Investments on built JS = 0; npm run e2e:baseline (green, no snapshot updates); npm run e2e (app suite green); node scripts/check-ownership.mjs S2. Also open the dev server (npm run dev -- --port 5202 --strictPort with VITE_API_URL pointed at a replay backend you start via "${MAIN}/.venv/bin/python" scripts/run_replay_backend.py --port 8102 (old module, legacy routes) and VITE_SKIP_LOGIN=true), take a screenshot with Playwright of /mercados and /portafolio at 1440x900 and 390x844, and Read them to confirm visually. notes_for_next_streams: how routes/features plug in, session and api usage examples, storage schema and hooks, formatting API, e2e patterns (mocking v2, seeding session), anything C and F1-F5 must know.`

phase('Build')
const specs = [
  { id: 'S1', prompt: S1 },
  { id: 'S2', prompt: S2 },
]
const results = await pipeline(
  specs,
  (s) => agent(s.prompt, { label: `${s.id} build`, phase: 'Build', schema: RESULT }),
  (out, s) => out ? agent(`Independent reviewer for stream ${s.id} of the NEWKAIZEN overhaul. Worktree "${WT}/${s.id}" (branch ws/${s.id}). Do NOT edit files. git: DEVELOPER_DIR=/Library/Developer/CommandLineTools git ... . Use ports ${s.id === 'S1' ? '8111' : '5212/5213 and API 8112'} only.
The stream's task statement was:
---
${s.prompt}
---
The stream claims:
${JSON.stringify(out, null, 2)}
Re-run its DONE CRITERIA commands yourself. Then look for: behavior not actually preserved (for S1: parity tests that skip or compare trivially, legacy routes missing or with different bodies, auth bypasses, CORS too permissive, exception text leaking in 500s, secrets defaults usable in production, schemas missing endpoints or units drifting from the spec; for S2: the legacy UI visually changed, "Investments" still in the bundle, RequireAuth bypassable in production builds, VITE_SKIP_LOGIN honored outside DEV, storage migration that loses or deletes legacy data, retry logic retrying 4xx or POST, format.js using em/en dashes or wrong minus sign, tests that assert little). For S2 also Read at least 3 screenshots you generate yourself of the running app (both viewports) to confirm the pages render real content. Classify each defect as blocker, major or minor with a concrete fix.`, { label: `${s.id} review`, phase: 'Review', schema: REVIEW }).then(r => ({ out, review: r })) : null,
  (x, s) => {
    if (!x || !x.review) return x
    const actionable = x.review.defects.filter(d => d.severity !== 'minor' || x.review.defects.length <= 6)
    if (!actionable.length) return x
    return agent(`${COMMON(s.id, s.id === 'S1' ? 5201 : 5202, s.id === 'S1' ? 8101 : 8102)}

You are stream ${s.id} again, in the same worktree, fixing reviewer findings on your own work. Your previous result:
${JSON.stringify(x.out, null, 2)}
Reviewer verdict: ${x.review.verdict}. Fix every blocker and major defect, and minor ones when cheap; for anything you disagree with, explain why with evidence. Defects:
${JSON.stringify(actionable, null, 2)}
Re-run the full DONE CRITERIA of your original task afterwards and commit fixes (one-line Spanish messages, no Co-Authored-By). Return the same result schema with updated commits, gates and notes_for_next_streams (full notes, not a diff).`, { label: `${s.id} fix`, phase: 'Fix', schema: RESULT }).then(fixed => ({ out: fixed || x.out, review: x.review, fixed: !!fixed }))
  },
)
return results
