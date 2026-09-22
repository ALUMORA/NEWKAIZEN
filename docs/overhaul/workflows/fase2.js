export const meta = {
  name: 'newkaizen-fase2',
  description: 'Phase 2: finance library (A1-A5), backend v2 (B1, B2a, B2b, B3a, B3b, B3c) and design system (C1, then C2 charts and C3 shell), each stream build -> independent review -> fix in its own worktree',
  phases: [
    { title: 'Build', detail: 'A1-A5, B1-B3c and C1 in parallel worktrees; C2 and C3 after C1 freezes the primitives' },
    { title: 'Review', detail: 'independent reviewer per stream, up to 2 rounds' },
    { title: 'Fix', detail: 'the stream fixes its reviewer defects' },
  ],
}

const MAIN = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN'
const WT = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt'
const DOCS = MAIN + '/docs/overhaul'
const BASE = args && args.base ? args.base : 'analizavende'

const COMMON = (s) => `You are stream ${s.id} of phase 2 of a multi-agent overhaul of NEWKAIZEN (GitHub ALUMORA/NEWKAIZEN), a Spanish-language (es-MX) investing app being rebuilt as an affordable "Bloomberg-lite" for Mexican/US retail investors and employer financial-wellness programs: correct per finance theory, honest about data provenance, accessible, fast. React 19 + Vite 8 plain-JS SPA (JSDoc + tsc --checkJs on src/lib only; legacy app in src/legacy/App.legacy.jsx mounted by LegacyPage until features replace it) and a Python backend (FastAPI package kaizen_api/; providers yfinance/FRED/Banxico/SEC/RSS; offline tests replay recorded provider calls).

READ FIRST: ${DOCS}/PLAN.md (approved plan), ${DOCS}/CONTINUAR.md (state and decisions: do NOT re-discuss them), the handoff notes ${DOCS}/notas/fase1-S1.md, ${DOCS}/notas/fase1-S2.md plus its close-out ${DOCS}/notas/fase1-S2-cierre.md, and ${DOCS}/notas/fase1-M1.md, and in your worktree docs/OWNERSHIP.md (ownership, seams between streams, layered fixtures recipe) and scripts/ownership.json. Your specs: ${s.specs}.

WORKING RULES (mandatory):
- Work ONLY inside your git worktree "${WT}/${s.id}" (branch ws/${s.id}, based on ${BASE}). Never edit "${MAIN}" (read-only) or other worktrees. Use absolute paths or "git -C"; do not rely on cd persisting.
- Only create/modify files matching your stream's globs in scripts/ownership.json. Never touch package.json, package-lock.json, requirements*.txt: every dependency is installed (node_modules is present in your worktree; Python venv "${MAIN}/.venv" has fastapi, uvicorn, PyJWT, yfinance 1.7, pandas 3, numpy 2.4, requests, curl_cffi, pytest, httpx, responses, time-machine, ruff; reference-only venv "${MAIN}/.venv-golden" has numpy, scipy, scikit-learn, PyPortfolioOpt for golden scripts). Missing something or need a change in a file you do not own? Write docs/requests/${s.id}.md and work around it inside your own files.
- Other streams work IN PARALLEL in their own worktrees; you cannot see their new code. Depend only on code that already exists in your worktree and on the seams documented in docs/OWNERSHIP.md; never edit a seam you do not own. If a seam you need is not implemented yet (for example a function that still raises NotImplementedError), code against its documented signature and fake it in your tests.
- git ONLY works as: DEVELOPER_DIR=/Library/Developer/CommandLineTools git ... (export it in every bash call). Commit on ws/${s.id} in a few logical commits, one-line Spanish messages with accents (e.g. "feat: ...", "fix: ...", "test: ..."), NO Co-Authored-By trailer. Do not push, merge or touch other branches.
- Ports: web ${s.web} and ${s.web + 1}, API ${s.api}. Never use 8002, 5180, 4180 (the owner's servers) nor another stream's ports. macOS has no "timeout" command: start servers in the background, keep the PID, kill it when done. Leave nothing running.
- User-visible text: natural es-MX, friendly and plain; NO em/en dashes (— –) anywhere in copy or docs you write; no BUY/SELL or advice language ("no es recomendación de inversión"). Missing numeric values display as "s/d"; the minus sign is U+2212 in formatted UI output. API v2 units: every rate/return/yield/weight/probability is a decimal fraction, rate changes in basis points (fields ending in Bp); every v2 response carries meta {asOf, source, delayMinutes, stale, fallback, generatedAt, notes}; a substitute source is fallback=true and never shown as live; no silent fixed values (no USD/MXN 17.5, no rf 8.6%).
- If the Write tool is blocked for notes/reports, write them with bash heredocs.
- Rigor: run every command you report and paste its real summary; never claim success from reading code. Console errors and failed requests are blocking defects. Finish with: node scripts/check-ownership.mjs ${s.id} (must pass).`

const BACKEND_RULES = (s) => `
BACKEND RULES:
- Offline by default: all tests run under the network guard with replay. Live network is allowed ONLY to record the provider calls you newly need, ONCE, into your own layer (see the layered fixtures recipe and the table of empty base keys in docs/OWNERSHIP.md): new calls with --set 2026-09-22,2026-09-22-${s.id.toLowerCase()}; to REPLACE a call the base set recorded empty or failed (34 such keys, listed per stream in docs/OWNERSHIP.md), put your layer first and name it as the target: --set 2026-09-22-${s.id.toLowerCase()},2026-09-22 --grabar-en 2026-09-22-${s.id.toLowerCase()}. Never write to the base set. Yahoo rate-limits: record sparingly (a handful of representative symbols: AAPL, SPY, WALMEX.MX, AAPL.MX, FUNO11.MX, CEMEXCPO.MX, ^MXX, NAFTRAC.MX, MXN=X as needed), pace requests, never hammer. Never put the user's email or any secret in a User-Agent or fixture; scrub tokens from recorded URLs/headers.
- The legacy v1 routes and the 122 legacy goldens must keep passing untouched: v1 behavior (including its known bugs) is corrected in v2, never in v1.
- schemas.py is FROZEN: build responses that validate against its models (response_model enforces it). If the contract is genuinely wrong, write docs/requests/${s.id}.md with the exact change and keep building against the current model.
- When you implement an endpoint, delete BOTH its @stub decorator line and its "raise not_implemented(...)", and add its capability name (the table in tests/contract/test_schemas.py maps every route to its capability; KNOWN_CAPABILITIES lives in schemas.py) to the CAPABILITIES list of the router file you own, so /health advertises only what really works. The contract tests fail by data if you do one and not the other.
- Every numeric claim is tested with known answers or recorded data; every fallback path is tested; every error path returns the right status and {error:{code,message}} in Spanish.
DONE CRITERIA (paste real results): "${MAIN}/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts="" (all green, offline; report counts; the base of this phase is 482 passed + 1 skipped); "${MAIN}/.venv/bin/ruff" check .; node scripts/check-ownership.mjs ${s.id}; then start "${MAIN}/.venv/bin/python" scripts/run_replay_backend.py --module kaizen_api.main --port ${s.api} --set 2026-09-22,2026-09-22-${s.id.toLowerCase()} and curl EVERY endpoint you implemented with representative US and MX symbols plus an invalid one, show the JSON (trimmed) and check by eye: units are fractions/bp, currencies right, meta honest, no em dashes; curl /health and confirm your capabilities appear; kill the server.`

const FRONTEND_LIB_RULES = (s) => `
LIBRARY RULES: pure ES modules, no React, no fetch, no Date.now() inside computations (take dates as input). JSDoc on every export (tsc --checkJs via npm run typecheck must pass). Return null (not 0, not NaN) when there is not enough data, and document the minimum n. Deterministic: randomness only through src/lib/rng.js (A3). Import only from modules you own (and src/lib/format.js if needed); if you need a helper that another A stream owns, write a private one in your own module (the orchestrator dedupes later).
Where a Python reference exists, scripts/golden/<module>_golden.py (run with "${MAIN}/.venv-golden/bin/python") writes tests/golden/<module>.json as {cases:[{name, input, expected, tol}]} and your <module>.test.js iterates it, in addition to the hand known-answer cases (toBeCloseTo with 6+ digits) and edge cases (empty, one point, zeros, NaN input rejected).
DONE CRITERIA (paste real results): npm run lint && npm run typecheck && npm run test (report the count of your tests); every golden script re-run and its JSON unchanged afterwards (git status clean); node scripts/check-ownership.mjs ${s.id}. In notes_for_next_streams give the exact public API (signatures, units, null rules) the F-streams will call.`

const STREAMS = [
  {
    id: 'A1', web: 5306, api: 8103, specs: `${DOCS}/specs/finance-spec.md (section A1 and General rules)`,
    task: `YOUR TASK (A1): implement src/lib/finance/returns.js, stats.js, performance.js, benchmark.js, rates.js, risk.js, backtest.js, fx.js, the barrel index.js (re-export A1-A4 public APIs by name; for modules of other A streams that do not exist yet in your worktree, leave a clearly marked commented block listing the names the orchestrator will enable at merge) and _util.js, exactly as specified, with every known answer of the spec as a test.`,
    focus: 'wrong known answers (re-derive each one yourself with numpy/scipy in .venv-golden), hidden annualization constants, population vs sample variance, date alignment that forward-fills prices, rf alignment rules (start-of-period yield, 45-day max ffill), VaR/CVaR index rule, Sortino denominator over ALL observations, drawdown recovery index, NaN/empty handling returning 0 instead of null, JSDoc types that do not match behavior, tests that assert little.',
    kind: 'lib',
  },
  {
    id: 'A2', web: 5308, api: 8104, specs: `${DOCS}/specs/finance-spec.md (section A2 and General rules)`,
    task: 'YOUR TASK (A2): implement src/lib/finance/linalg.js, covariance.js, expected.js, optimize.js and walkforward.js exactly as specified, including the PyPortfolioOpt Ledoit-Wolf constant-correlation golden (1e-10) and the scipy SLSQP goldens for 3-10 assets (1e-6), and the walk-forward look-ahead test with a spy strategy.',
    focus: 'Ledoit-Wolf mismatch vs PyPortfolioOpt (run it yourself), non-PSD outputs, projection onto the box-simplex not exact or not throwing InfeasibleError, FISTA step size or convergence tolerance that silently stops early, maxSharpe not the true tangency, risk parity contributions not equal, walk-forward look-ahead (any estimation index >= first hold index), numerical instability for near-singular covariance, performance for n=40.',
    kind: 'lib',
  },
  {
    id: 'A3', web: 5310, api: 8105, specs: `${DOCS}/specs/finance-spec.md (section A3 and General rules)`,
    task: 'YOUR TASK (A3): implement src/lib/rng.js (xoshiro128** seeded from a string hash, uniform, normal), src/lib/finance/montecarlo.js and goals.js exactly as specified (both sigma=0 known answers: 176,729.14 with constant contributions and 180,292.00 with contributions growing 1% per month; lognormalParams known answer), and meet the performance target (10k paths x 360 steps < 400 ms in node; measure and report). montecarlo.worker.js is optional (first item in the cut order): only if cheap.',
    focus: 'contribution timing (start of period), real vs nominal percentiles, inflation indexing of contributions, bootstrap block sampling bias, seed determinism across runs, percentile interpolation, probabilityAbove semantics, requiredContribution bisection bounds and monotonicity, performance claim not measured, advice-like wording in retirementIncome.',
    kind: 'lib',
  },
  {
    id: 'A4', web: 5312, api: 8106, specs: `${DOCS}/specs/finance-spec.md (section A4 and General rules) and ${DOCS}/specs/frontend-spec.md (Storage: Transaction schema)`,
    task: 'YOUR TASK (A4): implement src/lib/finance/ledger.js (replace the S2 stub keeping the export derivePositions and its call shape; read the stub and src/lib/storage.js Transaction schema first), performance-ledger.js, xirr.js, tax-mx.js and rebalance.js exactly as specified, with every known answer (average cost 15 @110 then split 30 @55, FX decomposition 8,700 = 5,100 + 3,600 if it belongs here, TWR -0.01, XIRR .10 and the Microsoft example .373362535, ISR 7.25, whole-share rebalance 17 A / 7 B).',
    focus: 'average-cost errors with fees and splits, realized P&L sign, selling more than held not rejected, cash per currency, FX-at-trade-date handling when fxRate is null, TWR flow timing, XIRR non-convergence or multiple roots without the bisection fallback, ISR INPC month rule (month before sale over month of purchase) and loss offset within the year, rebalance greedy step not minimizing deviation or overspending cash, wording that sounds like advice.',
    kind: 'lib',
  },
  {
    id: 'A5', web: 5314, api: 8107, specs: `${DOCS}/specs/finance-spec.md (section A5 and all module definitions, which the glossary and methodology must match exactly) and ${DOCS}/specs/design-brief.md (InfoTip uses the glossary)`,
    task: `YOUR TASK (A5): write src/content/glossary.js (named export glossary keyed by slug, at least 60 terms: every term listed in the spec, each with titulo, corto (<= 160 chars), largo (2-4 short paragraphs), formula, comoLeer, ejemplo, fuente, relacionados that point to existing slugs), glossarySearch(q) (accent- and case-insensitive), a unit test src/content/glossary.test.js (schema, lengths, no dashes, relacionados integrity, search) and docs/metodologia/*.md, one page per tool (portafolio, riesgo, optimizador, backtest, simulador, screener de factores, fórmula mágica, FIBRAs, valuación DCF, fuentes de datos) describing the exact methods, assumptions and limitations of the specs, in es-MX. Precise, sourced (e.g. "Sharpe (1966)", "Ledoit y Wolf (2004)", "LISR art. 129"), plain, never advice.
DONE CRITERIA (paste real results): npm run lint && npm run test; a grep proving there are no em/en dashes in src/content and docs/metodologia; the term count; node scripts/check-ownership.mjs A5.`,
    focus: 'factually wrong definitions or formulas (check each against the finance spec and standard references), formulas that differ from what the library computes (e.g. Sortino denominator, VaR rule, CETES convention, ISR rule), missing terms from the required list, English or Spanglish, em/en dashes, advice language, broken relacionados links, methodology pages that promise more than the specs implement.',
    kind: 'content',
  },
  {
    id: 'B1', web: 5316, api: 8108, specs: `${DOCS}/specs/api-v2-spec.md (Conventions, Platform, Errors, Auth, Caching) and the S1 review findings in ${DOCS}/notas/fase1-S1.md ("Pendientes" and "Revisión independiente")`,
    task: `YOUR TASK (B1): security and platform hardening on top of S1, in the files you own (main.py, settings.py, errors.py, cache.py, provenance.py, security/**, routers/health.py, routers/auth.py, scripts/hash_password.py, tests/unit/b1/**):
1. Login rate limiter: the per-user bucket (10/hour) must count only FAILED attempts (refund on success) so nobody can lock a known user out; add LOGIN_RATE_LIMIT settings (per-IP per minute, per-user per hour) that can be relaxed only outside production; key the per-IP bucket on the right-most untrusted X-Forwarded-For hop given a TRUSTED_PROXY_HOPS setting (default 1 for Render) instead of the client-written first hop; tests.
2. Settings: validate every scrypt$ USERS entry at startup (SettingsError in production, warning otherwise); non-string values rejected in production; tests.
3. scripts/hash_password.py --json prints only the USERS JSON object (captions to stderr); fix the recipe in the notes.
4. Concurrency overload: uvicorn's limit_concurrency answers a plain-text 503 without CORS or ErrorBody. Add an app-level concurrency guard (below uvicorn's limit, which stays as the last resort) that answers 503 with an ErrorBody using the closest error code that already exists in schemas.py (the contract is frozen), a Spanish message, Retry-After, and CORS headers; test it.
5. Cache-Control: verify every v2 route declares the right data class per the spec table (quotes 30, history 3600, fundamentals 21600, macro 3600, news 600, screeners 43200; auth/health no-store) with a test that walks app.routes, so streams B2/B3 inherit it; errors are no-store.
6. /health: providers.yahoo.ok and sec.ok stay null unless a cheap cached signal exists (never a live call per health request); capabilities are the union of the routers' CAPABILITIES (already wired); add serverTime and version/commit tests; keep it public under AUTH_REQUIRED.
7. Document in the legacy_v1 docstring the HTTP differences vs the old server (405 on POST to other paths, bare OPTIONS 405, 404 ErrorBody on unknown paths), and add a production guard test proving legacy routes are NOT mounted when KAIZEN_ENV=production unless KAIZEN_LEGACY_ROUTES=1 is explicit. (routers/legacy_v1.py is not yours: put the docstring text in docs/requests/B1.md if you cannot edit it.)
8. Security review of your own surface: JWT (alg pinned to HS256, exp/iat/ver required, leeway small), timing-safe compares, no secrets in logs (request log line has method, path without query, status, ms, request id), exception handler never leaks text, CORS allowlist (optional: tighten the preview regex to the team suffix via a setting), GZip. Fix what you find with tests.`,
    focus: 'auth bypasses (forge tokens with the dev key, alg=none, missing exp, old ver), rate-limit lockout or bypass (rotate X-Forwarded-For), secrets or exception text leaking in logs or bodies, CORS echoing untrusted origins with credentials, Cache-Control wrong or missing on any v2 route, /health doing live provider calls, production settings accepting weak or dev secrets, legacy routes reachable in production.',
    kind: 'backend',
  },
  {
    id: 'B2a', web: 5318, api: 8109, specs: `${DOCS}/specs/api-v2-spec.md (Market data, Markets) and ${DOCS}/specs/finance-spec.md (returns alignment rules)`,
    task: `YOUR TASK (B2a): implement in your files (see ownership.json and the endpoint table in docs/OWNERSHIP.md): GET /v2/quotes (<= 50 symbols, missing list), GET /v2/search (SEC company_tickers.json cached on disk under kaizen_api/data or fetched once and cached, plus a curated kaizen_api/data/symbols_mx.json with the main BMV/SIC names, FIBRAs, ETFs like NAFTRAC and Spanish aliases, e.g. "walmart" -> WALMEX.MX, "bimbo" -> BIMBOA.MX; no network needed for the MX list), GET /v2/history/{symbol} with REAL dates and adjusted closes, ccy=native|MXN|USD converting with the FX of the SAME date (forward-fill FX at most 3 days, noted in meta.notes), implementing the frozen seam domain.history.get_series(...); GET /v2/panel (inner join on dates, no forward fill of prices, dropped list with reasons); GET /v2/fx and /v2/fx/history (Banxico FIX SF43718 through the banxico provider seam when BANXICO_TOKEN is configured, else Yahoo MXN=X flagged fallback=true with source "yahoo"; never a fixed value; 503 UPSTREAM_UNAVAILABLE if nothing real), implementing the seam domain.fx.convert(...); GET /v2/markets/overview (deduplicated groups mx/us/global/fx/commodities/crypto, labels in Spanish, and marketStatus for BMV and NYSE from kaizen_api/data/holidays*.json for 2026 and 2027 with regular hours and early closes, America/Mexico_City and America/New_York time zones, nextOpen/nextClose) and GET /v2/markets/world; plus /v2/events if docs/OWNERSHIP.md assigns it to you. Fix the legacy data bugs in v2 only: ^MXX currency is MXN, the DXY source (Stooq always fails; use Yahoo DX-Y.NYB), no USD/MXN 17.5.`,
    focus: 'history without real dates or with price forward-fill, FX conversion using a different date than the price, >3-day FX gaps silently filled, quotes mixing currencies, ^MXX labeled USD, fixed or stale values not flagged, market-status wrong on holidays/weekends/DST boundaries (test specific instants), search returning wrong MX aliases, panel dropping symbols without reasons, fixtures bloated or containing secrets.',
    kind: 'backend',
  },
  {
    id: 'B2b', web: 5320, api: 8110, specs: `${DOCS}/specs/api-v2-spec.md (Rates and macro, News) and ${DOCS}/specs/finance-spec.md (rates.js conventions)`,
    task: `YOUR TASK (B2b): implement the Banxico SIE provider (providers/banxico.py: REST API with the Bmx-Token header, series fetch with date ranges, "N/E" and comma handling, caching; without BANXICO_TOKEN it raises NOT_CONFIGURED and callers fall back; test it with the documented SIE JSON response format through the responses library, since no token exists yet; keep a kaizen_api/data/banxico_series.json with ids, labels, units and a "verified" flag, where only SF43718 (FIX) and SF61745 (target rate) are verified and every other id stays unverified until a test with a real token confirms it against the SIE metadata endpoint: document exactly how to run that check once the owner gets a token); FRED without a key via the fredgraph CSV endpoint (plain requests default User-Agent: FRED hangs with browser or custom UAs); GET /v2/rates/mx (Banxico items when configured; otherwise only what a flagged fallback can honestly provide, e.g. FRED IR3TIB01MXM156N as a 3-month interbank proxy clearly labeled, or 503 NOT_CONFIGURED for items without an honest source); GET /v2/rates/rf (CETES 28 as a dated series from Banxico SF43936 once verified, else FRED IR3TIB01MXM156N with fallback=true and source "fred_ir3tib"; convention simple_act360, fractions); GET /v2/macro/us (UST 3M/2Y/10Y from FRED DGS3MO/DGS2/DGS10, spreads 10Y-2Y and 10Y-3M in bp, VIX from CBOE or FRED VIXCLS, DXY from Yahoo DX-Y.NYB, fed funds; each with previous, change and changeBp, dated); GET /v2/news (Yahoo news plus Spanish-language RSS sources for Mexico chosen by you with their terms in mind: headline + link only, HTML entities decoded, deduplicated by normalized title, javascript: or non-http links dropped, empty symbol treated as absent) and domain/tone.py: a transparent Spanish/English headline tone heuristic (method "heuristic", with a small curated lexicon you write yourself; NOT Loughran-McDonald), tested on real recorded headlines.`,
    focus: 'Banxico series ids used as verified without verification, CETES convention errors (act/360 simple vs effective), percent vs fraction mix-ups (FRED returns percent), fallbacks not flagged, VIX or DXY sources failing silently, changeBp sign or scale errors, news links with javascript: or tracking junk, duplicated headlines, tone heuristic that claims more than it is, RSS sources whose terms forbid this use, live network in tests.',
    kind: 'backend',
  },
  {
    id: 'B3a', web: 5322, api: 8111, specs: `${DOCS}/specs/api-v2-spec.md (Research: instrument, statements, dividends, insiders, events if assigned) and ${DOCS}/auditoria/indice-hallazgos.txt (currency and fabricated-data findings)`,
    task: `YOUR TASK (B3a): implement GET /v2/instrument/{symbol} with priceCurrency and financialCurrency from Yahoo (financialCurrency), converting every statement figure to the price currency with fx.convert (seam) BEFORE any ratio that mixes price with statements; debtToEquity as a ratio (Yahoo reports percent: divide by 100); normalize minor units (GBp -> GBP/100, ZAc -> ZAR/100); earningsYield and fcfYield; coverage {available,total}; beta computed from dated weekly returns against a LOCAL benchmark in the SAME currency (NAFTRAC.MX for .MX in MXN, SPY for US in USD) using the history seam get_series (fake it in tests until B2a lands), raw and Blume-adjusted, with window and observations, else null (never Yahoo's US-index beta for .MX without saying so). GET /v2/instrument/{symbol}/statements with REAL rows only (SEC companyfacts for US filers, Yahoo statements for others; never synthesized quarters; empty periods when unavailable), GET /v2/instrument/{symbol}/dividends (TTM, yield, history), GET /v2/insiders/{symbol} (SEC Form 4 open-market buys/sells vs grants/exercises, planned 10b5-1 flag when present), plus /v2/events if docs/OWNERSHIP.md assigns it to you. Use the existing legacy functions only as reference; keep v1 parity untouched.`,
    focus: 'ratios mixing reporting and trading currency (test a .MX name that reports in USD and a US ADR), debt-to-equity left in percent, synthesized or annual/4 quarters, SEC tag mapping errors (revenue tags, capex sign, FCF = OCF - capex), beta against a benchmark in another currency or misaligned dates, dividend yield using the wrong currency, insider classification errors, coverage counts wrong, User-Agent problems with SEC (must identify the app without personal emails).',
    kind: 'backend',
  },
  {
    id: 'B3b', web: 5324, api: 8112, specs: `${DOCS}/specs/api-v2-spec.md (valuation, momentum) and the DCF/momentum known answers below`,
    task: `YOUR TASK (B3b): implement GET /v2/valuation/{symbol} and GET /v2/momentum/{symbol} in your files (domain/valuation/**, screeners/momentum.py, routers/valuation.py, data/damodaran_2026.json).
Multiples: sector benchmarks from Damodaran's January 2026 datasets (US and Emerging Markets) stored in kaizen_api/data/damodaran_2026.json with source URL and date (download the official files from pages.stern.nyu.edu/~adamodar; never invent numbers; if you cannot fetch them, store only what you can verify and mark the rest missing), applicable=false with a reason for banks, insurers, FIBRAs/REITs and negative earnings; label them honestly as "múltiplos relativos", never as DCF.
DCF: two-stage FCFF. FCFF = EBIT(1-t) + D&A - capex - dNWC; TV = FCFF_{N+1}/(WACC-g) with g <= rf of that currency and WACC-g >= 2 pp (else warnings and clamp); Hamada beta_L = beta_U[1+(1-t)D/E]; Re = rf + beta_L*ERP + lambda*CRP; WACC in USD converted to MXN with (1+WACC_USD)(1+pi_MX)/(1+pi_US)-1; sensitivity grid over WACC x g; query overrides erp, crp, terminalGrowth, years, growth validated. Known answers (tests): FCFF0 100, growth 10% for 5 years, terminal growth 3%, WACC 9% -> stage-1 PV 513.93, PV of TV 1,796.87, EV 2,310.80; beta_U .8, D/E .5, t .3 -> beta_L 1.08; rf 4.2%, ERP 4.5%, CRP 2.5%, lambda 1 -> Re 11.56%; E/V 2/3, Rd 7% -> WACC 9.34% -> 10.62% in MXN with inflation 3.5% MX / 2.3% US. Banks: justified P/B = (ROE-g)/(Re-g): 15%/5%/12% -> 1.4286. Inputs come from the B3a fundamentals seam and the B2b rf seam as documented in docs/OWNERSHIP.md (fake them in tests until they land); assumptions carry source and asOf.
Momentum 12-1: P_{t-1m}/P_{t-12m} - 1 from month-end adjusted closes (13 monthly prices -> P11/P0 - 1), r6m, r3m, against a benchmark in the SAME currency (NAFTRAC.MX for .MX, SPY for US), relative12m1, via the history seam.`,
    focus: 'DCF math errors (re-derive the known answers yourself), terminal growth above rf or WACC-g below 2 pp not guarded, sign of capex/dNWC, net debt and minorities omitted, per-share with wrong share count or currency, multiples applied to banks/FIBRAs/negative earnings, Damodaran numbers that are invented or undated, momentum windows off by one month, benchmark in another currency, overrides not validated.',
    kind: 'backend',
  },
  {
    id: 'B3c', web: 5326, api: 8113, specs: `${DOCS}/specs/api-v2-spec.md (Screeners) and the factor/magic known answers below`,
    task: `YOUR TASK (B3c): implement GET /v2/screeners/factors, /v2/screeners/magic and /v2/screeners/fibras in your files (domain/screeners/factors.py, magic.py, fibras.py, domain/universe.py, routers/screeners.py, data/universe*.json, data/fibras*.json).
Factors: sector-relative robust z-scores z = (x - median)/(1.4826*MAD) winsorized at +-3 (known answer: [10,12,14,16,18] -> z(18) = 1.349); multiples converted to yields first so negative earnings score low; sectors with n<5 fall back to universe-wide and are flagged; coverage below 50% -> excluded with a reason; scores value, quality, momentum (12-1 via the momentum seam or history seam), lowVol, growth, composite; "checks" pass/fail against stated thresholds instead of any BUY/SELL; universes mx and us defined in data/universe*.json with names and sectors.
Magic formula (Greenblatt), honest: EY = EBIT/EV with EV = market cap + debt + minority interest + preferred - cash; ROC = EBIT/(net working capital excluding cash and short-term debt + net PP&E); exclude financials and utilities; rank EY and ROC, sum ranks, stable tie-break documented (known answer: EY [.10,.08,.12], ROC [.50,.30,.20] -> order 1, 3, 2); never estimated EBIT; batch with the shared cache, partial=true and excluded reasons when data is missing; currency per row.
FIBRAs: distributionYield, capRate and NAV only when real data exists, ltv = debt/total assets (NOT debt/(debt+market cap)), debtToMarketCap separately, cashFlowYield with an explicit basis (never call FCF "FFO"), spreadVsCetes against the rf seam, signal descuento/en_linea/prima/sin_datos with the rule documented, type classification.
Fundamentals come through the B3a seam and prices/history through the B2a seam as documented in docs/OWNERSHIP.md (fake them in tests until they land).`,
    focus: 'z-score formula or winsorization wrong, negative P/E scored as cheap, coverage rule not applied, BUY/SELL or recommendation wording, magic formula EV or ROC definitions wrong, estimated EBIT sneaking in, rank ties unstable, FIBRA LTV or FFO mislabeled, spread vs CETES in the wrong units, universes without sources, partial results not flagged.',
    kind: 'backend',
  },
  {
    id: 'C1', web: 5328, api: 8114, browser: true, specs: `${DOCS}/specs/design-brief.md (authoritative) and ${DOCS}/specs/frontend-spec.md`,
    task: `YOUR TASK (C1): the design system. Tokens in src/styles/tokens.css (+ base, components, layout) per the design brief, both themes, EXTENDING src/theme.css names (never rename: the legacy still uses them until M3); verify every text/UI color pair's contrast numerically (write a small script; AA: text >= 4.5:1, large text/UI >= 3:1) and validate the categorical chart palette for distinguishability in both themes; self-hosted fonts already come from @fontsource-variable. Primitives in src/components/ui/* with a single barrel src/components/ui/index.js: Button, IconButton, Card, Badge, Tabs, SegmentedControl, Field/Input/Select/NumberInput (es-MX number parsing "1,234.56"), DataTable (sortable with aria-sort, numeric right-aligned, sticky first column, horizontal scroll inside its container, empty/loading/error states, keyboard row activation), Stat, Delta, Money, InfoTip (glossary key -> popover; uses src/content/glossary.js if present via a guarded dynamic import or a prop fallback, keyboard and touch accessible), Skeleton, EmptyState, ErrorState, DataStatus ({asOf, source, delayMinutes, stale, fallback} -> compact badge + accessible tooltip), ConfirmDialog, Dialog, Sheet, Toast + useToast (Undo action, aria-live polite), Disclaimer, PageHeader, SectionHeading, SrOnly, ThemeToggle, Mark; fill src/components/ui/UiProvider.jsx (theme, toasts, dialogs). Use src/lib/format.js for every number. A DEV-only gallery at /dev/ui (src/features/dev-ui/**, excluded from production builds; check the bundle) showing every primitive and state in both themes. e2e/dev-ui.spec.js: axe WCAG 2.1 AA zero violations on /dev/ui in light AND dark at 1440x900 and 390x844, keyboard tests for Tabs, Dialog focus trap and Esc, DataTable sorting, Toast undo. The legacy baseline (npm run e2e:baseline) must stay green without updating snapshots. Use the impeccable, make-interfaces-feel-better, dataviz and accessibility skills while designing (Skill tool), and judge the result from screenshots you take and Read, in both themes and viewports.
CHECKPOINT: when done, the API of src/components/ui/index.js is FROZEN for C2, C3 and phase 3. Document every component's props precisely in docs/design.md (you own it).
DONE CRITERIA (paste real results): npm run lint && npm run typecheck && npm run test && npm run build && npm run bundle (first-load KB must stay within budget); E2E_BASELINE_PORT=${5328} npm run e2e:baseline (no snapshot updates); E2E_PORT=${5329} npx playwright test e2e/dev-ui.spec.js (both app projects) plus the existing app suite; screenshots of /dev/ui in both themes at both viewports, Read and described; node scripts/check-ownership.mjs C1.`,
    focus: 'contrast failures (measure them yourself from computed styles in both themes), hardcoded colors, focus not visible, keyboard traps or missing Esc, aria misuse in Tabs/DataTable/Toast/InfoTip, hover-only information, touch targets < 24px, horizontal page overflow at 390px, DataTable not sortable by keyboard, DataStatus hiding fallback/stale, number parsing bugs with es-MX separators, dev-ui leaking into the production bundle, legacy baseline changed, generic AI look instead of a calm professional terminal (judge from screenshots).',
    kind: 'ui',
  },
]

const LATE = [
  {
    id: 'C2', web: 5330, api: 8115, browser: true, specs: `${DOCS}/specs/design-brief.md (Charts) and docs/design.md in your worktree (C1's frozen primitives)`,
    task: `YOUR TASK (C2): dependency-free SVG charts in src/components/charts/* using only C1 tokens (--chart-*, --seq-*, --div-*, --grid, --axis, --crosshair): scales (linear, log, time with es-MX month ticks, nice ticks, formatted with src/lib/format.js), ChartFrame (title, visible caption + description for screen readers, legend, "Ver tabla" toggle that renders the data with C1's DataTable, source/asOf footer with DataStatus), TimeSeries (multiple series, crosshair + tooltip on pointer AND keyboard: arrow keys move the active point when focused; optional log scale and area; baseline at 0 for returns; empty and one-point states), FanChart (p5-p95, p25-p75, median), DrawdownChart, Donut (<= 8 slices then "Otros"), Bars (signed, horizontal/vertical), Heatmap (diverging blue/orange, values in cells when they fit), FrontierChart, Sparkline (aria-hidden with sibling text). ResizeObserver, no layout shift, rAF pointer handling, reduced motion respected. A gallery at src/features/dev-ui/ChartsGallery.jsx (yours) with every chart and edge case in both themes. e2e/charts.spec.js: axe zero violations in both themes and viewports, keyboard crosshair test, "Ver tabla" test, no horizontal overflow at 390px. Use the dataviz and accessibility skills (Skill tool). Your worktree starts from C1's finished branch: do not modify C1's files; file needs in docs/requests/C2.md.
DONE CRITERIA (paste real results): npm run lint && npm run typecheck && npm run test && npm run build && npm run bundle; E2E_PORT=${5331} npx playwright test e2e/charts.spec.js; screenshots of the gallery in both themes and viewports, Read and described; node scripts/check-ownership.mjs C2 (if the script compares against analizavende and therefore also lists C1's files, re-run the check against ws/C1 as base or explain precisely).`,
    focus: 'charts without text alternatives or with broken "Ver tabla", keyboard crosshair missing, color-only encodings, red/green used for correlation, misleading axes (non-zero baseline for returns bars, log scale unlabeled), wrong es-MX tick labels, layout shift or overflow at 390px, pointer jank, contrast of lines and labels in both themes, charts that crash on empty/one-point/NaN data.',
    kind: 'ui',
  },
  {
    id: 'C3', web: 5332, api: 8116, browser: true, specs: `${DOCS}/specs/design-brief.md (Shell and IA) and ${DOCS}/specs/frontend-spec.md, plus docs/design.md in your worktree (C1's frozen primitives)`,
    task: `YOUR TASK (C3): the app shell and IA. src/app/nav.js (the sidebar tree of the brief, built from src/app/paths.js constants) and src/app/shell/* (AppShell already exists as a placeholder: fill it): Sidebar (sections and items of the brief, collapsible to 64px), TopBar (⌘K search button, compact MarketStrip with IPC, S&P 500, USD/MXN, CETES 28 and VIX from the v2 API through src/lib/api queries, each with value, change and DataStatus; never overlapping, scrolling inside its own container on narrow screens; USD/MXN direction shown with --neutral-dir and a text hint, never red/green), server/data status dot, ThemeToggle, user menu with Cerrar sesión), BottomNav on < 768px (Mercados, Portafolio, Investigar, Herramientas + "Más" opening a Sheet with the rest), Footer with the persistent disclaimer "Kaizen es una herramienta educativa y de análisis. No es recomendación de inversión." and links to /legal/*, CommandPalette (⌘K / Ctrl+K / "/"; combobox semantics with aria-activedescendant; groups Emisoras from /v2/search debounced 200 ms plus recent, Ir a all routes, Acciones cambiar tema / cerrar sesión; "WALMEX" + Enter opens /investigar/WALMEX.MX), skip link "Saltar al contenido", landmarks, focus to the page h1 and document.title on route change. The legacy Workspace keeps working inside the shell: you own src/legacy/** in this phase, so make the legacy hide its own sidebar/header when embedded (one prop) so there is a single chrome, and keep the URL/tab sync S2 added. The legacy baseline must keep guarding the legacy CONTENT: if the new chrome changes the page, change e2e/baseline.spec.js to capture only the legacy content region, and prove with a crop-and-compare of the old full-page snapshots that the content itself did not change before regenerating snapshots in a separate commit from the recorded HAR (never re-recording). e2e/shell.spec.js with mocked v2 responses (validate their shape against the contract): navigation on both viewports, BottomNav + "Más" Sheet, ⌘K flows, skip link, focus management, disclaimer present, axe zero violations on shell routes in both themes and viewports, no horizontal overflow at 390px, no console errors. Your worktree starts from C1's finished branch: do not modify C1's files; file needs in docs/requests/C3.md. Use the impeccable, make-interfaces-feel-better and accessibility skills (Skill tool).
DONE CRITERIA (paste real results): npm run lint && npm run typecheck && npm run test && npm run build && npm run bundle; E2E_BASELINE_PORT=${5332} npm run e2e:baseline; E2E_PORT=${5333} npm run e2e (whole app suite incl. shell.spec.js); screenshots of /mercados, /portafolio and the ⌘K palette at 1440x900 and 390x844 in both themes, Read and described; node scripts/check-ownership.mjs C3 (same base caveat as C2).`,
    focus: 'double chrome with the legacy, content under the bottom nav, MarketStrip overlapping or overflowing at 390px (the audit found the old header strip overlapping the breadcrumb), USD/MXN shown as red/green, ⌘K not a proper combobox or trapping focus, skip link or landmarks missing, focus not moved on navigation, disclaimer missing on some routes, baseline weakened instead of scoped, axe violations in dark theme, mocked responses that do not match the contract.',
    kind: 'ui',
  },
]

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

const fullPrompt = (s) => {
  const extra = s.kind === 'backend' ? BACKEND_RULES(s) : s.kind === 'lib' ? FRONTEND_LIB_RULES(s) : ''
  return `${COMMON(s)}\n\n${s.task}\n${extra}\nReturn notes_for_next_streams as a COMPLETE handoff (public API, seams you implemented or consumed, how to run and test, known limitations); the orchestrator writes it to docs/overhaul/notas/fase2-${s.id}.md.`
}

const reviewPrompt = (s, out, round) => `Independent reviewer (round ${round}) for stream ${s.id} of phase 2 of the NEWKAIZEN overhaul. Worktree "${WT}/${s.id}" (branch ws/${s.id}). Do NOT edit or commit anything. git: DEVELOPER_DIR=/Library/Developer/CommandLineTools git ... . Use ports ${s.web + 100}/${s.web + 101} (web) and ${s.api + 50} (API) only; kill every server you start; macOS has no "timeout" command. Specs: ${s.specs}.
The stream's task statement was:
---
${fullPrompt(s)}
---
The stream claims:
${JSON.stringify(out, null, 2)}
Re-run its DONE CRITERIA yourself (with your ports) and compare with the claims. Then hunt for real defects, especially: ${s.focus}
${s.browser ? 'Take and Read your own screenshots in both themes at 1440x900 and 390x844; run axe yourself.' : ''}
Classify each verified defect as blocker, major or minor with a concrete fix; say how you verified each one. Do not report style nits as defects.`

const fixPrompt = (s, out, review) => `${fullPrompt(s)}

You are stream ${s.id} again, in the same worktree, fixing reviewer findings on your own work. Your previous result:
${JSON.stringify(out, null, 2)}
Reviewer verdict: ${review.verdict}. Fix every blocker and major defect and every minor one that is cheap; for anything you disagree with, explain why with evidence. Defects:
${JSON.stringify(review.defects, null, 2)}
Re-run the full DONE CRITERIA afterwards and commit fixes (one-line Spanish messages, no Co-Authored-By). Return the same result schema with updated commits, gates, open_issues and the FULL notes_for_next_streams.`

async function runStream(s) {
  let out = await agent(fullPrompt(s), { label: `${s.id} build`, phase: 'Build', schema: RESULT })
  if (!out) return { id: s.id, out: null, reviews: [] }
  const reviews = []
  for (let round = 1; round <= 2; round++) {
    const review = await agent(reviewPrompt(s, out, round), { label: `${s.id} review ${round}`, phase: 'Review', schema: REVIEW })
    if (!review) break
    reviews.push(review)
    const serious = review.defects.filter(d => d.severity !== 'minor')
    log(`${s.id} review ${round}: ${review.verdict}, ${serious.length} blocker/major, ${review.defects.length - serious.length} minor`)
    if (!review.defects.length) break
    const fixed = await agent(fixPrompt(s, out, review), { label: `${s.id} fix ${round}`, phase: 'Fix', schema: RESULT })
    if (fixed) out = fixed
    if (!serious.length) break
  }
  return { id: s.id, out, reviews }
}

const makeLateWorktrees = (ids) => agent(`Mechanical git setup, nothing else. Run exactly (bash, DEVELOPER_DIR=/Library/Developer/CommandLineTools exported):
${ids.map(id => `git -C "${MAIN}" worktree add -b ws/${id} "${WT}/${id}" ws/C1 && cp -cR "${MAIN}/node_modules" "${WT}/${id}/node_modules"`).join('\n')}
If a worktree or branch already exists, do not recreate it: report its HEAD instead. Then print "git -C <worktree> log --oneline -1" for each. Return a one-line status per worktree.`, { label: 'C2/C3 worktrees', phase: 'Build', effort: 'low' })

phase('Build')
const chains = STREAMS.map(s => () => {
  if (s.id !== 'C1') return runStream(s)
  return runStream(s).then(async (c1) => {
    if (!c1.out) return [c1]
    log('C1 frozen: starting C2 and C3 from ws/C1')
    await makeLateWorktrees(LATE.map(l => l.id))
    const late = await parallel(LATE.map(l => () => runStream(l)))
    return [c1, ...late]
  })
})
const results = (await parallel(chains)).flat().filter(Boolean)
return results.map(r => ({ id: r.id, ok: !!r.out, verdicts: r.reviews.map(v => v.verdict), out: r.out, lastDefects: r.reviews.length ? r.reviews[r.reviews.length - 1].defects : [] }))
