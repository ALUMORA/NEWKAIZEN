export const meta = {
  name: 'newkaizen-phase0',
  description: 'Phase 0: test harness + legacy visual baseline (Q0) and provider record/replay + legacy backend goldens (R0)',
  phases: [
    { title: 'Build', detail: 'Q0 and R0 in parallel, each in its own git worktree' },
    { title: 'Review', detail: 'independent check of each stream against its done-criteria' },
  ],
}

const MAIN = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN'
const WT = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt'
const COMMON = (id, port) => `You are stream ${id} of a multi-agent overhaul of NEWKAIZEN, a Spanish-language (es-MX) investing app: React 19 + Vite 8 plain-JS SPA (src/App.jsx, 5,512 lines, legacy) and a Python stdlib backend (backend.py, yfinance/FRED/CBOE/Stooq/EDGAR/RSS). The product goal is an affordable "Bloomberg" for Mexican/US retail investors and employer financial-wellness programs.

WORKING RULES (mandatory):
- Work ONLY inside your git worktree: "${WT}/${id}" (branch ws/${id}). Never edit files in "${MAIN}" or other worktrees.
- Read "${WT}/${id}/docs/OWNERSHIP.md" first. You may only create/modify files matching your globs for stream "${id}" in "${WT}/${id}/scripts/ownership.json". Do NOT touch package.json, package-lock.json or requirements*.txt (dependencies are already installed; if something is missing, write it to docs/requests/${id}.md and work around it).
- git must be run as: DEVELOPER_DIR=/Library/Developer/CommandLineTools git ... (plain git fails: Xcode license). Commit your work on ws/${id} in 1-4 logical commits with one-line Spanish messages with accents, e.g. "test: ...", NO Co-Authored-By trailer. Do not push. Do not merge.
- Before finishing run: cd "${WT}/${id}" && node scripts/check-ownership.mjs ${id} (must pass).
- Python: use the shared venv "${MAIN}/.venv/bin/python" (has yfinance 1.7, pandas 3, numpy 2.4, fastapi, uvicorn, pyjwt, pytest, httpx, responses, time-machine, ruff). Node deps are installed in your worktree (vitest 4, jsdom, testing-library, @playwright/test 1.62.1 with cached chromium, @axe-core/playwright, typescript 6).
- Ports reserved for you: web ${port}, ${port + 1}; API ${port + 3000}. A live legacy backend is already running at http://127.0.0.1:8002 (same backend.py code) and may be used for recording only.
- If you write a report or long notes file, write it with a bash heredoc (cat > file <<'EOF'), since the Write tool may be blocked for reports.
- Be rigorous: run every command you claim; do not claim success from reading code. Any console error or failed request (>=400) in a browser test is a blocking defect.`

const RESULT = {
  type: 'object',
  properties: {
    stream: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    gates: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, result: { type: 'string' } }, required: ['cmd', 'result'] } },
    open_issues: { type: 'array', items: { type: 'string' } },
    notes_for_next_streams: { type: 'string' },
  },
  required: ['stream', 'commits', 'summary', 'files', 'gates', 'open_issues', 'notes_for_next_streams'],
}

const Q0 = `${COMMON('Q0', 5290)}

YOUR TASK (Q0): test tooling for the whole project + a deterministic visual baseline of the LEGACY app.
1. vitest.config.js: environment jsdom for *.test.jsx and node for *.test.js (use environmentMatchGlobs or per-file comments, whichever vitest 4 supports; verify), include src/**/*.test.{js,jsx} and tests/golden/*.test.js if any, setupFiles src/test/setup.js (jest-dom matchers, mocks for localStorage/sessionStorage if jsdom lacks them, matchMedia, scrollTo, URL.createObjectURL/revokeObjectURL, ResizeObserver). Add one tiny sanity test in src/test/ so "npm run test" passes now.
2. jsconfig.check.json for "npm run typecheck" (tsc -p jsconfig.check.json): allowJs, checkJs, noEmit, strict false but noImplicitAny false, skipLibCheck, module esnext, moduleResolution bundler, target es2022, jsx react-jsx, include ["src/lib/**/*.js", "src/test/typecheck-anchor.js"] with a trivial anchor file so tsc has at least one input today. It must pass now.
3. playwright.config.js with TWO families of projects:
   a) baseline-desktop (1440x900) and baseline-mobile (390x844, isMobile/hasTouch like Pixel 7 but viewport 390x844): testMatch e2e/baseline.spec.js, run against the Vite DEV server of the legacy app started by webServer with env VITE_API_URL=http://127.0.0.1:8002 VITE_SKIP_LOGIN=true on port from env E2E_BASELINE_PORT (default 5290), reuseExistingServer false.
   b) desktop (1440x900) and mobile (390x844): testIgnore baseline, for the future new app, run against "npm run build:e2e && vite preview --port E2E_PORT(default 5291) --strictPort" (webServer), with a .env.e2e file containing VITE_API_URL=http://api.test. Only start the webServer(s) needed for the selected projects (e.g. choose by env E2E_SUITE=baseline|app, default app; the npm script e2e:baseline already passes --project=baseline-desktop --project=baseline-mobile, so make it work: you may read process.argv or an env var).
   Common: expect.toHaveScreenshot maxDiffPixelRatio 0.02, animations disabled, timeout 15000; reporter list + html (open never); trace retain-on-failure; retries 0; workers 2.
4. e2e/support/ helpers (ES modules): guards.js (attachGuards(page) collects console errors, pageerror, requestfailed, responses >=400; assertClean() fails the test listing them), clock.js (fixTime(page, iso) via page.clock.setFixedTime), har.js or mockApi.js (serve recorded API traffic; unmatched API requests must fail loudly), auth.js (seedSession(page, session) placeholder that writes sessionStorage key 'kaizen.session' via addInitScript; S2 will finalize the session shape).
5. Legacy baseline: record the legacy app's API traffic ONCE into a HAR per viewport or a shared HAR at e2e/fixtures/legacy/ using page.routeFromHAR(..., {url: 'http://127.0.0.1:8002/**', update: true}) while navigating all 8 tabs (Noticias default, Portfolio, Analytics vs SPY, Sharpe Optimizer, ML Screener, Análisis, FIBRA Screener, Fórmula Mágica; on mobile use the bottom nav pills; do not click run/compute buttons), waiting for data to settle. Put the recorder in scripts/record-legacy-fixtures.mjs (npm run fixtures:legacy). Then e2e/baseline.spec.js replays with routeFromHAR notFound:'abort', fixes the clock to the recording time, visits each tab, waits for a stable state (no spinners), and takes a full-page screenshot per tab: toHaveScreenshot(\`legacy-<tab>.png\`, {fullPage:true, mask volatile regions only if truly needed}). Guards must be clean (the legacy app may log known non-errors; if it logs console.error, report it as an open issue rather than silencing, unless it's caused by the harness). Generate the baseline snapshots (--update-snapshots) and then prove determinism: "npm run e2e:baseline" must pass TWICE in a row without updating. The legacy app auto-refreshes market data every 60s and scroll position persists between tabs (scroll the main container to top before each screenshot). If some tab cannot be made deterministic, document why and mask minimal regions.
6. scripts/check-bundle.mjs ("npm run bundle"): after a build, parse dist/index.html to find the entry script + modulepreload + CSS links, gzip them (zlib), print sizes, fail if total JS gz > 180 KB (budget configurable via env BUNDLE_BUDGET_KB). Today it should report ~109 KB and pass.
7. .github/workflows/check.yml: on push/PR to main, analizavende, alumora: job web (Node 22, npm ci, lint, typecheck, test, build, bundle) and job api (Python 3.11.8, pip install -r requirements-dev.txt, ruff check ., pytest -q). Mark the api job to run pytest only if a tests/ dir exists (it will soon). E2E is not in CI yet.
8. eslint.config.js: keep existing rules; also ignore .venv, .venv-golden, dist, playwright-report, test-results, coverage, e2e/fixtures; add globals for node in scripts/**, e2e/**, *.config.js, and vitest globals for *.test.js(x). "npm run lint" must exit 0 (warnings allowed for the legacy App.jsx only).
DONE CRITERIA (run and paste results into gates): npm run lint; npm run typecheck; npm run test; npm run build && npm run bundle; npm run e2e:baseline twice (both green, 16 screenshots); node scripts/check-ownership.mjs Q0. In notes_for_next_streams explain exactly how to run the baseline, how HAR replay works, how guards are used, and how a new spec should mock the API.`

const R0 = `${COMMON('R0', 5390)}

YOUR TASK (R0): deterministic record/replay of every upstream data provider used by backend.py, plus characterization goldens of the CURRENT (old) backend so the upcoming refactor into a FastAPI package can prove it preserves behavior, and later streams can test offline.
1. tests/replay/ (importable Python package, no network at replay time):
   - A recorder and a replayer installed by monkeypatching at the OUTERMOST I/O boundary used by backend.py: yfinance.Ticker (all attributes/methods backend.py uses: history(**kwargs), info, fast_info (attribute access and dict-like get), financials, income_stmt, balance_sheet, cashflow, quarterly_* variants, news, insider_transactions/insider_purchases, dividends, calendar, get_* methods if used; grep backend.py for every usage), yfinance.download, and plain HTTP via requests (requests.get/post, requests.Session.request, including the module-level _session in backend.py) for FRED, CBOE, Stooq, SEC EDGAR, RSS feeds. Use the 'responses' library or a Session.request patch; pick what reliably captures all calls (verify by grepping requests./_session. in backend.py).
   - Keys: for yfinance (symbol uppercased, attribute, normalized kwargs); for HTTP (method, URL without volatile params, sorted params). Store under tests/fixtures/recorded/<set>/ (set = "2026-09-22"), one JSON file per key (hash-named) plus an index.json with human-readable keys. Also store the recording timestamp.
   - Serialization must round-trip pandas objects exactly enough for backend math: DataFrame/Series with DatetimeIndex (tz-aware, e.g. America/New_York and America/Mexico_City), MultiIndex columns from yf.download, object/float/int dtypes, NaN, empty frames; dicts with numpy scalars; lists of news dicts. Write unit tests in tests/replay/test_roundtrip.py covering each case.
   - Replay mode must raise a clear ReplayMiss(key) on any unrecorded call and must block real network (patch socket.socket.connect in the pytest fixture to raise).
   - Public API: from tests.replay import recording, replaying (context managers), install_replay(set) for use outside pytest.
2. scripts/record_fixtures.py: imports the OLD backend.py module (sys.path insert of the repo root; import backend) inside recording(...), throttled to ~1 upstream call per second, and calls every data function for these symbols: AAPL, AAPL.MX, WALMEX.MX, CEMEXCPO.MX, FUNO11.MX, SPY, ^MXX, and one invalid ticker "ZZZNOTREAL". Cover: get_stock, get_chart (periods 1mo, 1y, 5y; ccy "" and "MXN"), get_returns, get_dcf, get_edgar_financials (AAPL and one non-SEC like WALMEX.MX), get_momentum, get_news, get_insiders (AAPL), get_magic_one (AAPL, MSFT), get_fibras() default plus get_fibras("FUNO11.MX"), get_market, get_worldmap, get_macro, get_market_news, get_rf, get_fx, and get_magic_formula() (the 86-ticker batch; throttle, it takes a few minutes; if Yahoo rate-limits, back off and resume; record partial failures as they happen since the backend handles them). Also record the extra yfinance/HTTP calls the functions make internally (the recorder captures them automatically). Save each function's JSON-normalized output as a golden in tests/goldens_legacy/<function>__<args-slug>.json together with a list of volatile field paths (timestamps like 'asOf', 'updated', 'fetched', relative times) that comparisons must ignore. Freeze time during recording with time-machine at a fixed instant you record in the index, and freeze it identically at replay, so any Date/relative-time logic reproduces.
   Note: backend.py has in-memory caches (_cached with TTL); clear them between calls (inspect backend.py for the cache dict) so each call exercises the providers.
3. tests/characterization/test_legacy_goldens.py: parametrized over every golden: in replay mode (network blocked, time frozen, caches cleared) call the same old backend function and assert the normalized output equals the golden (ignoring the volatile paths; floats compared with rel 1e-9). Must pass fully offline.
4. scripts/run_replay_backend.py: starts the backend HTTP server (today: old backend.py's Handler with ThreadingHTTPServer; make the target module configurable via --module so S1 can later point it at kaizen_api) with replay installed and time frozen, on --port (default 8190). This will be used to record deterministic browser fixtures. Verify it serves /health, /stock/AAPL, /chart/WALMEX.MX?period=1y&ccy=MXN, /market in replay with the network blocked.
5. pyproject.toml: [tool.pytest.ini_options] testpaths=["tests"], addopts="-q", markers (live: needs network); [tool.ruff] target-version py311, line-length 120, extend-exclude ["backend.py", ".venv", ".venv-golden", "node_modules"], lint select ["E","F","I","B","UP"] with sensible ignores so that "ruff check ." passes on tests/ and scripts/ you write. tests/__init__.py and tests/conftest.py (fixtures: replay_set, frozen_time, no_network).
DONE CRITERIA (run and paste results into gates): the recording completed (report counts of recorded keys per provider and any symbols that failed upstream); "${MAIN}/.venv/bin/python -m pytest -q" passes fully OFFLINE (prove by running with network blocked, e.g. the socket guard, and report the count of goldens); ruff check . passes; scripts/run_replay_backend.py serves the 4 sample routes with the network blocked (curl them); node scripts/check-ownership.mjs R0. In notes_for_next_streams document the replay API, where fixtures live, how to add a new recorded call, the volatile-field convention, and anything surprising about yfinance data (currencies, financialCurrency, empty quarterly statements for .MX, etc.) that later streams must know.`

phase('Build')
const outs = await parallel([
  () => agent(Q0, { label: 'Q0 harness+baseline', phase: 'Build', schema: RESULT }),
  () => agent(R0, { label: 'R0 record/replay', phase: 'Build', schema: RESULT }),
])

phase('Review')
const reviews = await parallel(outs.map((o, i) => () => {
  if (!o) return Promise.resolve(null)
  const id = i === 0 ? 'Q0' : 'R0'
  return agent(`Independent reviewer for stream ${id} of the NEWKAIZEN overhaul. Worktree: "${WT}/${id}" (branch ws/${id}). Do NOT edit files. git must be run as DEVELOPER_DIR=/Library/Developer/CommandLineTools git ...
The stream claims:
${JSON.stringify(o, null, 2)}
Re-run the done-criteria commands yourself in that worktree (for Q0: npm run lint, npm run typecheck, npm run test, npm run build && npm run bundle, npm run e2e:baseline ONCE; for R0: "${MAIN}/.venv/bin/python" -m pytest -q, ruff check . using "${MAIN}/.venv/bin/ruff" or python -m ruff, and start scripts/run_replay_backend.py on port 8199 then curl /health and /stock/AAPL and stop it). Check ownership with node scripts/check-ownership.mjs ${id}. Inspect the code for shortcuts that make gates pass without real coverage (skipped tests, empty goldens, masks covering whole pages, network not actually blocked, snapshots that are blank or error pages - open 2-3 PNGs with the Read tool to look at them). Report pass/fail per command and concrete defects.`,
    { label: `review ${id}`, phase: 'Review', schema: {
      type: 'object',
      properties: {
        stream: { type: 'string' },
        verdict: { type: 'string', enum: ['pass', 'pass_with_issues', 'fail'] },
        commands: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['cmd', 'ok', 'detail'] } },
        defects: { type: 'array', items: { type: 'string' } },
      },
      required: ['stream', 'verdict', 'commands', 'defects'],
    } })
}))
return { outs, reviews }
