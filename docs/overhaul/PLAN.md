# NEWKAIZEN: "Bloomberg-lite" overhaul plan

## Context

NEWKAIZEN (`ALUMORA/NEWKAIZEN`, a public repo) has a local copy at `05 NEWKAIZEN/`, byte-identical to `main` = `analizavende` = `988bc21`. It has two parts:
- A React 19 + Vite JS SPA. Almost all of it is one 5,512-line `src/App.jsx`, whose `Workspace` component holds 84 `useState`.
- A 2,002-line stdlib Python backend, `backend.py`, pulling from yfinance, FRED, CBOE, Stooq, SEC EDGAR and RSS.

The owner wants the best affordable "Bloomberg" for everyday investors in Mexico and the US, and for small companies to give employees. That means better UI/UX, finance that holds up to theory, and whatever features add real value.

A read-only audit ran 83 agents and produced 113 findings. Every high-impact finding went to an adversarial verifier, and none was refuted. Raw data is in the session scratchpad `audit.json`. A live walkthrough at 1440 and 390 px confirmed:

- **Security (critical).**
  - The password `"Investments"` is hardcoded in the client bundle (`App.jsx:934`) of a public repo.
  - The session is just a localStorage flag, and the backend `/login` is never called.
  - Every endpoint is open, with CORS `*`.
- **Fabricated data (critical).**
  - Análisis invents quarterly financials: it divides the annual figures by 4 and multiplies them by made-up factors (`App.jsx:5019-5105`).
  - The México macro panel is hardcoded and months old.
  - USD/MXN silently falls back to a fixed 17.5.
- **Finance errors.**
  - Currency: `get_stock`, the valuation and FIBRA ratios all mix reporting and trading currency.
  - Returns: aligned by array position, not by date, because `/chart` sends no dates.
  - Risk-free rate: the 10Y Bono M, not a short rate.
  - Backtest: "annual return" is an arithmetic mean × 52, not CAGR, and it applies today's weights to the past.
  - Optimizer: the "optimal" portfolio is the best of 100k random draws on raw historical means.
  - Monte Carlo: compounds i.i.d. normal simple returns.
  - "DCF": actually static US sector multiples, applied even to Mexican stocks, banks and FIBRAs.
  - FIBRAs: "FFO" is really FCF, and "LTV" is really debt / (debt + market cap).
  - Momentum and beta: compare .MX stocks in MXN against US ETFs in USD.
  - Labels:
    - "ML Screener" is a hand-weighted rule set that double counts factors and issues BUY/SELL.
    - "Fear & Greed" is a homemade VIX transform.
    - News sentiment is substring matching.
- **UX.**
  - At 390 px the header strip overlaps the breadcrumb.
  - 8 flat tabs in Spanglish, with no URLs.
  - Losses show no minus sign, and "$" means USD in one place and MXN in another.
  - An invalid ticker shows "Cargando..." forever.
  - Deletes have no confirm or undo.
  - No headings or landmarks, and charts have no text alternatives.
  - Hardcoded colors, and nothing respects reduced motion.
- **Operations.**
  - Render `app-4-everyone.onrender.com` does not deploy from this repo. It still runs old code: `/rf` has no `asOf`, `/chart` has no `currency`.
  - There are no tests, no CI and no types.
  - yfinance is scraping, which is not licensable for a paid or B2B product.

**Outcome:** a correct, honest, fast, accessible, Mexico-first investing terminal, with a clean architecture two collaborators can work on in parallel. It ships to `analizavende`, and goes to `main` only once the new backend is live.

## Key decisions

The user asked me to proceed automatically, so these defaults are already taken.

- **Git.** `DEVELOPER_DIR=/Library/Developer/CommandLineTools git` works despite the unaccepted Xcode license. Setup:
  ```
  git init -b analizavende
  git remote add origin https://github.com/ALUMORA/NEWKAIZEN.git
  git fetch
  git reset --mixed origin/analizavende
  ```
  After that, `git status --porcelain` must be empty; if it isn't, stop and diff.
  - Parallel streams use manual `git worktree`s at `05 NEWKAIZEN.wt/<id>` on branches `ws/<id>`. The harness's `isolation: 'worktree'` can't run git here.
  - Each stream gets its own ports: web 5200+i, API 8100+i.
- **Commits.** Pushed to `analizavende` as logical commits: one line, in Spanish, no Co-Authored-By (the user's memory rule).
  - **No merge to `main`.** Vercel auto-publishes `main`, and the new login needs the new backend.
  - Check `alumora` before starting and before every push.
- **Build new, don't split the old file.** Most tabs get rewritten anyway: portfolio moves to a ledger, and the optimizer, backtest, markets and screener are redone.
  - Move `App.jsx` unchanged to `src/legacy/App.legacy.jsx`.
  - `LegacyRoute` mounts the old Workspace for any route not migrated yet.
  - Each feature is built fresh in `src/features/`, using its legacy tab only as a reference.
  - `legacy/` is deleted at merge point M3.
  - The backend does get a mechanical split, protected by recorded characterization tests.
- **Stack.**
  - Stay on JS, because Arturo works in JS. Add JSDoc plus `tsc --checkJs` on `src/lib/**` only.
  - `react-router@7` for deep links, Back, lazy routes and ⌘K navigation.
  - `@tanstack/react-query@5` for dedup, per-data freshness, polling that pauses when the tab is hidden, and cold-start retry.
  - Dependency-free SVG charts driven by the tokens.
  - FastAPI + uvicorn with sync endpoints and one worker; `python backend.py` stays as a shim.
  - Auth: stdlib `hashlib.scrypt` for passwords and PyJWT for tokens.
- **Cutover.** The user creates a **new** Render service from `render.yaml` that auto-deploys `analizavende`, sets its env vars, and points Vercel's `VITE_API_URL` at it.
  - The old service keeps serving `main` until then.
  - Rollback is Vercel's instant rollback.
- **Old-backend compatibility.** The frontend probes `/health`. The old backend returns only `{status: "ok"}`, which means API v1.
  - Legacy adapters run only when `VITE_ALLOW_LEGACY=true`: tail alignment with a visible "alineación aproximada" warning, and rf as a constant with a warning.
  - Production requires API v2.
  - A fallback is never shown as live data.
- **Out of scope for now.** These need accounts or money only the owner can arrange:
  - Supabase accounts and multi-device sync.
  - Employer tenants, SSO and CFDI billing.
  - A licensed vendor. An EODHD stub sits behind `EODHD_API_TOKEN`.
  - A BMV redistribution license.
  - The seams for them are left in place: `lib/storage.js` and `lib/auth/session.js` adapters, a provider layer, and the Alfredkaizen entitlements model.
- **Compliance and copy.**
  - No BUY/SELL/AGREGAR anywhere, and a persistent "no es recomendación de inversión" disclaimer.
  - All copy in es-MX, humanized, with no em/en dashes (the user's style rule).
  - The Loughran-McDonald lexicon is dropped: it is English-only and its commercial license is unclear.

## Target structure

The stream codes (O, Q0, R0, S1, S2, A, B1-B3, C, F1-F5) are defined in the phase table below.

**Frontend `src/`**
- `main.jsx`, `app/` (S2):
  - `AppRoot`: Query, Session, Capabilities, Theme and Toast providers.
  - `router.jsx`: every route pre-registered and lazy, so Phase 3 never edits it.
  - `RequireAuth`, `ErrorBoundary` (friendly, no stack trace), `LegacyRoute`.
- `app/nav.js` and `app/shell/*` (C): AppShell, Sidebar, TopBar, MarketStrip, BottomNav (4 items plus "Más"), MoreSheet, CommandPalette, Footer with the disclaimer.
- `legacy/App.legacy.jsx` (moved by S2).
- `lib/api/` (S2):
  - `client.js`: base URL from `VITE_API_URL` in every environment, bearer token, timeout, cold-start retry, `ApiError`, and a 401 sends you to login.
  - `capabilities.js`, `legacy.js` (v1 → v2 adapters), `endpoints.js`, `queries.js` (query keys and freshness per data class), `types.js`.
- `lib/auth/session.js`: token in memory plus sessionStorage.
- `lib/format.js`: es-MX formatting, explicit currency, %, pp, bp, the U+2212 minus sign, America/Mexico_City dates.
- `lib/storage.js`, `lib/csv.js`:
  - storage: a `{v:2}` envelope, validation, and v1 → v2 migration that never deletes the old key, with a backup.
  - csv: JSON/CSV export and import, with a UTF-8 BOM and a CSV-injection guard.
- `lib/finance/*` (A): returns, stats, performance, benchmark, rates, covariance, optimize, walkforward, backtest, montecarlo, ledger, performance-ledger, tax-mx, rebalance, risk, goals, fx. `lib/rng.js`: a seeded xoshiro128** generator.
- `components/ui/*` (C): Button, Card, Badge, Tabs, SegmentedControl, Field, DataTable, Stat, Delta, Money, InfoTip, Skeleton, EmptyState, ErrorState, DataStatus (provenance / as-of), ConfirmDialog, Toast with undo, Dialog, Sheet, Disclaimer, PageHeader, SrOnly. Seeded from `src/ui.jsx`.
- `components/charts/*` (C):
  - `scales`, and `ChartFrame` (title, description, "ver tabla").
  - `TimeSeries` (axes, crosshair, keyboard), `FanChart`, `DrawdownChart`, `Donut`, `Bars`, `Heatmap` (diverging colors), `FrontierChart`, `Sparkline`.
- `styles/{tokens,base,components,layout}.css` (C): taken from `theme.css`. Self-hosted fonts through `@fontsource-variable`, plus tabular numerals.
- `content/glossary.js` (A): every metric with title, short text, formula, how to read it, and source.
- `features/{markets,portfolio,research,tools,watchlist,learn,onboarding,auth,legal}/` (F1-F5); `features/dev-ui/` (C, dev builds only).
- `vercel.json`: SPA rewrite, CSP and security headers, immutable assets.
- CI: `.github/workflows/check.yml`.
- Tests: `e2e/`, `tests/golden/*.json` (read by both Vitest and pytest).
- `scripts/`: record fixtures, check ownership, bundle budget, goldens.

**Backend `kaizen_api/`**
The name avoids clashing with `backend.py`, which becomes the shim `from kaizen_api.main import run`.
- `main.py`: CORS allowlist plus a regex for preview domains, `Access-Control-Max-Age`, request-id logs, GZip, error handlers.
- `settings.py`, `errors.py`, `cache.py` (with the single-flight race fixed), `provenance.py`.
- `security/{auth,ratelimit}.py`.
- `schemas.py`: the contract.
- `providers/`: `yahoo/{session,prices,news,fundamentals}`, `banxico`, `fred`, `sec_edgar`, `rss`, `eodhd` (stub), `replay`.
- `domain/`:
  - fx, history, rates, macro, markets, market_calendar, news, tone, search;
  - fundamentals, statements, universe;
  - `valuation/{multiples,dcf,params}`;
  - `screeners/{factors,magic,fibras,momentum,insiders}`.
- `routers/`: health, auth, quotes, history, rates, markets, news, search, research, screeners, and `legacy_v1` (mounted only when `KAIZEN_LEGACY_ROUTES=1`, i.e. in tests).
- `data/symbols_mx.json` (Spanish aliases), `data/damodaran_2026.json` (dated).
- `tests/{characterization,contract,unit}`, with fixtures recorded under `tests/fixtures/recorded/`.
- `scripts/{record_fixtures,hash_password}.py`.
- `.python-version`, pinned `requirements{,-dev}.txt`.
- `render.yaml` for the new service: `healthCheckPath: /health`, no `/debug` route, no startup prewarm.

## Phases

Each phase runs as its own Workflow. I verify each gate myself in the rendered app between phases.

| Phase | Stream | Owns / does |
|---|---|---|
| 0 | O (me) | Git setup. **All npm/pip dependencies installed up front.** Only O touches `package.json`, lockfiles and requirements. Writes `docs/OWNERSHIP.md` and `scripts/check-ownership.mjs`. |
| 0 | Q0 | Vitest, Playwright and ESLint config; `e2e/support`. Baseline screenshots of the legacy app: 8 tabs × 2 viewports. |
| 0 | R0 | Records fixtures at the yfinance/HTTP boundary for 8 symbols: AAPL, AAPL.MX, WALMEX.MX, CEMEXCPO.MX, FUNO11.MX, SPY, ^MXX and one invalid ticker. Produces goldens from the old backend running in replay. |
| 1 | S1 | Backend package + FastAPI with the same behavior; characterization tests must match. Writes `schemas.py` and `docs/api-v2.md`. Freezes the seams `provenance.meta()`, `fx.convert()`, `history.get_series()` and `cache`. |
| 1 | S2 | Moves App.jsx to legacy; router, `lib/api`, auth session, format, storage v2, `vercel.json`. The baseline must stay green. |
| **M1** | O | Merge; **the API contract is frozen**. |
| 2 | A | The finance library, plus goldens and the glossary. |
| 2 | B1 | Auth, rate limits, CORS, status codes, cache times, health, market calendar. |
| 2 | B2 | Banxico/FRED, rf series, FX with its source, dated history and aligned panel, US macro with changes, markets, news, search. |
| 2 | B3 | Currency-correct fundamentals, real statements, relabeled multiples plus an FCFF DCF, factor screener, Magic Formula, FIBRAs, 12-1 momentum. |
| 2 | C | Tokens, primitives, charts, shell, IA. **Checkpoint C1:** early in the phase, `ui/index.js` signatures and `/dev/ui` are published and then frozen. |
| **M2** | O | Merge; record v2 API fixtures from the backend running in replay. |
| 3 | F1 | Portfolio. |
| 3 | F2 | Markets. |
| 3 | F3 | Research. |
| 3 | F4 | Tools. |
| 3 | F5 | Learn, watchlist, onboarding, auth and legal pages, PWA manifest. |
| 3 | request window | Primitives stay frozen, so F-streams file needs in `docs/requests/*.md`; C and A take them at mid-phase. |
| **M3** | O | Delete `legacy/`; strict lint. |
| 4 | reviewers | Finance, security, UX/a11y (screenshots in both themes) and copy/compliance reviewers write `docs/review/*.md`. The owning stream fixes each item. |
| 5 | O | Logical commits, push, Vercel preview, update memory, final report. |

**Conflict control.**
- `check-ownership.mjs` fails a merge if `git diff --name-only analizavende...ws/x` touches files outside that stream's globs.
- Routes and routers are pre-registered, so streams only fill in files.
- New primitives go through request files; features may keep local components until promoted.
- At most 3 agents run browsers at once (the memory note on 24 GB RAM). Check free RAM before each phase.

**Phase 3 feature scope**
- **F1, portfolio.**
  - Transaction ledger: buy, sell, dividend, deposit, withdrawal, split, fee.
  - FX at trade date, prefilled from Banxico FIX.
  - Positions derived from the ledger; P&L split into price effect and FX effect.
  - TWR and XIRR; ISR estimate.
  - Risk view: MDD, VaR/CVaR, beta vs IPC and vs S&P in MXN, effective N, USD exposure, sector concentration, correlation heatmap.
  - Rebalance in whole shares, confirmed through a dialog that writes ledger transactions, with undo.
  - Duplicate buys merge at average cost. Invalid tickers show an error.
- **F2, markets.**
  - De-duplicated overview; BMV and NYSE market status; "Cierre vie 19-sep" and "Retraso ~15 min" labels.
  - Live México macro: target rate, TIIE, CETES, INPC, UDI, FIX.
  - CETES table plus a CETES calculator with ISR withholding.
  - US rates with changes in bp.
  - A VIX-percentile gauge replaces "Fear & Greed".
  - Factual daily summary with no mood label and no causal claims. Consistent USD/MXN semantics.
- **F3, research.**
  - Instrument page `/investigar/:ticker` with real statements, valuation (multiples plus an editable DCF with a sensitivity grid), momentum and news.
  - Compare 2-5 tickers.
  - Factor screener that is sector-relative and shows coverage, with "cumple / no cumple" checks instead of BUY/SELL.
  - Honest Magic Formula using the cached batch endpoint; FIBRAs with correct metrics and spread vs CETES.
- **F4, tools.**
  - Optimizer: min-variance, risk parity and max-Sharpe on a Ledoit-Wolf covariance, with an efficient frontier, walk-forward out-of-sample results and editable assumptions.
  - Backtest: buy-and-hold by default, constant-mix as an option, benchmark choice (IPC, S&P 500 in MXN, or a blend), CAGR, volatility, MDD, drawdown chart.
  - Monte Carlo / goals / retirement: contributions, inflation, real terms, probability of reaching the goal.
- **F5.**
  - Glossary and methodology pages, and an InfoTip on every metric.
  - Watchlist with sparklines, also in the sidebar.
  - ⌘K ticker search over SEC tickers plus the MX symbol list.
  - Onboarding: sample portfolio labeled EJEMPLO, CSV import, or start empty.
  - Legal pages; `manifest.webmanifest`.

## Finance specs (known-answer tests)

Complex estimators are also checked against `tests/golden/*.json`. Those come from `scripts/golden/finance_golden.py`, using numpy, scipy, scikit-learn and PyPortfolioOpt in a separate venv. The hand values below are exact tests; I re-derived several of them.

| Component | Definition | Known answer |
|---|---|---|
| returns | Simple and log returns. `alignPanel` inner-joins on ISO date, then computes returns; no forward fill. Periods per year k = 252/52/12 from the interval. | P=[100,110,99,108.9] → simple [.10,−.10,.10]; Σlog = ln 1.089 |
| stats | Sample variance (n−1) | r=[.01,.02,−.01,.03,0] → sd .0158114; weekly annualized vol .114018 |
| CAGR | (V_T/V_0)^(1/y)−1 | 100→200 in 3 y = .259921 |
| rf | CETES 28 as a date-aligned series; rf_d = (1+y·28/360)^(d/28)−1 | y=.11 → weekly .0021321, effective annual .11745 |
| Sharpe / Sortino | Sharpe on excess returns × √k. Sortino with downside deviation over all observations. | e above → Sharpe 4.5607 annualized; e=[.02,−.01,.03,−.02,.01] → Sortino 4.32666 |
| MDD / Calmar | DD_t = W_t/peak − 1; Calmar = CAGR/\|MDD\| | W=[100,120,90,110,80,130] → −.3333 |
| VaR / CVaR | Historical: k=⌈n(1−α)⌉. Parametric: normal. | 20 returns from −.05 to .14: 95% → .05/.05; parametric 95% → .052311/.077032 |
| beta / alpha | OLS on excess returns vs a local benchmark in the same currency (NAFTRAC.MX adjusted close as IPC total return; SPY adjusted × FIX for S&P in MXN). Blume adjustment. TE, IR, Treynor. | β 1.65, α −.0015, R² .972321; TE .0442568, IR 2.93740 |
| covariance | Ledoit-Wolf constant correlation | Matches PyPortfolioOpt to 1e−10; result is PSD |
| optimize | FISTA with box-simplex projection. Frontier sweep, tangency, risk parity. Default μ = rf + β·ERP, editable. Raw historical means only behind a warning. | Min-var σ=(.2,.3), ρ=0 → w₁ .692308; tangency μ=(.10,.15), rf .05 → [.529412,.470588], Sharpe .416667; risk parity → [.6,.4]; n=2, u=.35 → infeasible error |
| backtest | Buy-and-hold by default; constant-mix as an option | A=[.1,−.1], B=0, 50/50 → constant-mix .9975, buy-and-hold .995 |
| Monte Carlo | Lognormal: μ_l = ln(1+m) − σ_l²/2; contributions indexed to inflation; seeded | m=.08, s=.15 → μ_l .0674078, σ_l .138226; σ=0 case → 176,729.14 at every percentile |
| ledger / FX split | Average cost, fees, splits. Total P&L = price effect q(P_t−P_0)X_0 + FX effect qP_t(X_t−X_0). | Buy 10@100 and 10@120, sell 5@130 → realized 100; FX case → 8,700 = 5,100 + 3,600 |
| TWR / XIRR | Chain-linked TWR; XIRR by Newton with a bisection fallback | TWR −.01; −1000/+1100 after 365 days → .10 |
| tax-mx | Art. 129 LISR: 10% of net realized BMV/SIC gains, cost indexed by INPC. Labeled as an estimate. | Cost 550 × 1.05, proceeds 650 → 7.25 |
| rebalance | Whole shares: floor, then greedily buy what most reduces deviation | 10,000, 50/50, prices 300/700 → 17 A / 7 B |
| factors (py) | Sector-relative robust z-scores, winsorized at ±3. Multiples converted to yields, so negative earnings score low. Coverage below 50% is excluded. | [10..18] → z(18) = 1.349 |
| magic | EY = EBIT/EV (EV includes minorities and preferred); ROC excludes cash and short-term debt from working capital | Order 1, 3, 2 on the sample |
| DCF | Two-stage FCFF. Hamada beta. Re = rf + β·ERP + λ·CRP. g ≤ rf, and WACC−g ≥ 2 pp. WACC converted USD→MXN by the inflation differential. Banks use justified P/B. | EV 2,310.80; β_L 1.08; Re 11.56%; WACC 9.34% → 10.62% in MXN; bank P/B 1.4286 |

## API v2

- **Every response** carries `meta{asOf, source, delayMinutes, stale, fallback, generatedAt}`.
- **Errors** use real status codes (400, 401, 404, 422, 429 with Retry-After, 502, 503) and return `{error:{code, message}}`.
- **Health and auth.**
  - `GET /health` returns `{apiVersion: 2, version, commit, capabilities, providers}`.
  - `POST /auth/login` returns a JWT valid for 12 h. Rate limits: 5 per minute per IP, 10 per hour per user. `TOKEN_VERSION` revokes all tokens.
  - `GET /auth/me`.
- **Market data.**
  - `/v2/quotes?symbols=` (up to 50) and `/v2/search?q=`.
  - `/v2/history/{sym}` returns `{dates, close, currency, fx}`.
  - `/v2/panel` returns aligned prices.
  - `/v2/fx` and `/v2/fx/history` use FIX `SF43718`; there is no made-up 17.5 fallback.
- **Rates and macro.**
  - `/v2/rates/mx` covers CETES 28/91/182/364, target rate `SF61745`, TIIE, INPC, UDI and FIX. Each series ID is checked against SIE metadata in a test.
  - `/v2/rates/rf` returns a CETES 28 series; the fallback is FRED `IR3TIB01MXM156N`, flagged as a fallback.
  - `/v2/macro/us` covers 3M/2Y/10Y yields and spreads in bp, VIX and DXY, each with its change.
  - `/v2/markets/overview` includes `marketStatus`.
  - `/v2/news` returns headline plus link only.
- **Research and screeners.**
  - `/v2/instrument/{sym}` returns `priceCurrency`, `financialCurrency` and `fxUsed`.
  - `/v2/instrument/{sym}/statements` returns real rows only.
  - `/v2/valuation/{sym}` returns multiples (with source, date and whether they apply) plus the DCF with inputs and the sensitivity grid.
  - `/v2/screeners/{factors,magic,fibras}` and `/v2/momentum/{sym}`.

## Dependencies

- **npm runtime.** Add `react-router`, `@tanstack/react-query` and the `@fontsource-variable` fonts. Remove `prop-types`, which is unused.
- **npm dev.** `vitest`, `jsdom`, Testing Library, `@playwright/test`, `@axe-core/playwright`, `typescript` (checkJs only).
- **pip.** `fastapi`, `uvicorn`, `pyjwt`, plus exact pins of the current `yfinance`, `pandas`, `numpy`, `requests` and `curl_cffi`.
- **pip dev.** `pytest`, `httpx`, `responses`, `time-machine`, `ruff`.
- **Golden venv.** scipy, scikit-learn, PyPortfolioOpt.

## Verification

- **G0**
  - `npm run lint && npm run build`.
  - `pytest tests/characterization` runs offline.
  - The legacy baseline e2e passes twice in a row.
- **G1**
  - `npm run typecheck`.
  - pytest: the new package produces the old goldens.
  - `/health` via `preview_start` returns `apiVersion: 2` in replay.
  - The ownership check passes.
- **G2**
  - `npm run check`: lint, typecheck, Vitest including goldens, build, and a bundle budget of ≤180 KB gz on the first route.
  - pytest: auth, rate limit, and contract tests that validate every v2 fixture against `schemas.py`.
  - `ruff check .`.
  - Shell, login and ⌘K e2e tests.
  - axe on `/dev/ui` in both themes.
  - A live smoke test on 3 tickers.
- **G3**
  - Every feature's e2e passes at **1440×900 and 390×844**.
  - axe (WCAG 2.1 AA) passes on every route in both themes.
  - Nothing imports `legacy/`.
- **G4**
  - Lighthouse: public routes via the `00 QA` CLI with Brave; logged-in routes via chrome-devtools `lighthouse_audit` against the local stack in replay. Targets: Performance ≥85 on mobile, Accessibility ≥95, Best practices ≥95.
  - Zero console errors and zero responses ≥400.
  - My own walkthrough in the Browser pane, with screenshots.
- **How e2e gets past login**
  - Tests use `vite build --mode e2e` with `VITE_API_URL=http://api.test`, and `page.route` serves the recorded fixtures.
  - Unmatched routes fail the test, so fixture gaps can't hide.
  - The session is seeded via `addInitScript`; `auth.spec` drives the real form against mocked 200/401/429 responses.
  - `page.clock` fixes the time, so "hace X" and market status are deterministic.
  - `live.smoke` (`E2E_LIVE=1`) logs in against a local backend whose `USERS` hash comes from `scripts/hash_password.py`.

## Risks and cut order

- **Mitigations.**
  - Yahoo throttling: record once, then replay everywhere.
  - No Banxico token: FRED fallback, flagged in the UI.
  - Render free plan's 512 MB: one worker and lazy imports.
  - Losing migrated portfolios: the old key is never deleted, there is a backup, and export is offered before migrating. Migrated positions become undated opening transactions, and their FX effect shows "no disponible".
  - Agents claiming success by reading code: gates require Playwright artifacts.
- **Cut first, in this order:**
  1. Web Worker
  2. PWA manifest
  3. Compare view
  4. Walk-forward
  5. Block bootstrap
  6. Goals simulator
  7. Headline tone
  8. INPC indexing in the ISR estimate
  9. CETES curve chart
  10. Peer-relative FIBRA signal
  11. ⌘K ticker search
  12. DCF sensitivity grid
- **Never cut:** auth, date alignment, currency correctness, removing fabricated data, honest labels, disclaimers, tests, the a11y gate.

## Things only the user can do (listed in the final report)

1. Tell Arturo to pause work on `App.jsx` and rebase onto `analizavende` after the push.
2. Get a free Banxico SIE token. A FRED key is optional.
3. Create the new Render service from `render.yaml` on `analizavende` and set:
   - `SECRET_KEY`
   - `USERS`, as scrypt hashes from `scripts/hash_password.py`
   - `ALLOWED_ORIGINS`
   - `BANXICO_TOKEN`
   - `AUTH_REQUIRED=true`
4. Set Vercel `VITE_API_URL`: Preview now, Production at cutover. Then merge to `main`.
5. Before charging anyone:
   - Have Mexican counsel review the disclaimers, the aviso de privacidad and the news feeds.
   - Get a written EODHD commercial quote.
   - Decide on Supabase for accounts, sync and employer tenants.
