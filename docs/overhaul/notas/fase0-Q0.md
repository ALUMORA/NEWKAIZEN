HOW TO RUN THE BASELINE
- `npm run e2e:baseline`: 16 tests, about 30 s, and it does not need the backend. Playwright starts the Vite dev server of the legacy app on 127.0.0.1:5290 (E2E_BASELINE_PORT) with VITE_API_URL=http://127.0.0.1:8002 and VITE_SKIP_LOGIN=true. It fails if the port is already taken, because reuseExistingServer is false.
- Screenshots are stored in e2e/baseline.spec.js-snapshots/legacy-<slug>-baseline-<desktop|mobile>-darwin.png. The slugs are noticias, portfolio, analytics, sharpe, ml-screener, analisis, fibras and formula-magica.
- Re-record only if the legacy app changes on purpose:
  1. Start the backend with `.venv/bin/python backend.py` on :8002.
  2. Run `npm run fixtures:legacy` (options: RECORD_VIEWPORTS=desktop,mobile and RECORD_HEADED=1).
  3. Run `npx playwright test --project=baseline-desktop --project=baseline-mobile --update-snapshots=all`. Plain --update-snapshots now means "changed": it keeps any old image that still falls inside the 2% tolerance.
- Choosing a suite: E2E_SUITE=baseline|app|all. Without it, the suite comes from --project flags (all baseline-* means baseline) or from file names (baseline.spec). `npm run e2e` runs the app suite (projects desktop and mobile) against `npm run build:e2e && vite preview` on 5291 (E2E_PORT).

HOW HAR REPLAY WORKS
- Each test registers two routes. First `blockExternalRequests(page, [baseURL])` aborts anything that is not the dev server. Then `replayHar(page, legacyHarPath(viewport), { url: LEGACY_HAR_URL })` answers requests to 127.0.0.1:8002 and fonts.googleapis.com / fonts.gstatic.com from the HAR, with notFound 'abort'. Playwright checks the route registered last first, so the HAR wins for its own URLs.
- Matching is by method and URL. When the same URL was recorded more than once (StrictMode fires every fetch twice), the first recorded response is always served.
- The clock is fixed with fixTime(page, meta.recordedAt[viewport]). Timers keep running in real time.
- waitForSettled(page, net) waits for three things at once: no API requests in flight for 1.2 s, no element with a 'spin' animation, and no 'Cargando', 'CONECTANDO' or 'Analizando' text. The condition must hold on two polls in a row, and fonts must be ready.
- Before each capture the spec scrolls to the top.
- If the page never settles, the guards report the cause first, for example `[requestfailed] GET http://127.0.0.1:8002/worldmap :: net::ERR_FAILED`.

HOW THE GUARDS WORK
Option 1, the automatic fixture:
```js
import { test, expect } from './support/guards.js'
test('x', async ({ page, guards }) => { /* ... */ })
```
It calls assertClean() when the test finishes, and fails on any console.error, pageerror, requestfailed or response of 400 or more. A 4xx or 5xx also shows up a second time as a "Failed to load resource" console.error, which is expected.

Option 2, by hand: `const g = attachGuards(page)` before goto, then `g.assertClean()` at the end.

To tolerate a third-party problem, do it explicitly and give the reason:
```js
attachGuards(page, { allow: [{ kind: 'console.error', match: /.../, reason: '...' }] })
```
Never silence the guard any other way.

HOW A NEW SPEC SHOULD MOCK THE API
- The e2e build points at http://api.test (.env.e2e). That host does not exist, so every call has to be mocked:
```js
const api = await mockApi(page, {
  'GET /health': { json: { status: 'ok' } },
  'GET /quotes/:symbol': ({ params }) => ({ json: { symbol: params.symbol } }),
  'POST /auth/login': ({ body }) => ({ status: 200, json: {} }),
})
```
- Keys look like "METHOD /path". A path may use :param and * (one segment) and is compared without the query. If the key contains "?", the query must match exactly.
- Mocks accept { status, json | body, contentType, headers, delayMs }. You can add routes later with api.on(key, spec); newer routes win.
- CORS preflight is answered automatically, and the Origin header is reflected so credentials work.
- An API request with no mock is answered with a 501 that names the request. The guards flag it, and api.assertAllMatched() lists it.
- If the base URL includes a path, for example http://api.test/v2, pass { baseUrl } and write the keys relative to it.
- For a session, call `seedSession(page, session)` from e2e/support/auth.js. It writes sessionStorage 'kaizen.session' through addInitScript. It is a placeholder: S2 must settle the session shape and update DEFAULT_SESSION.
- For time, use `fixTime(page, iso)`, or `installClock` if you need fake timers.
- Viewports and locale/timezone live in e2e/support/viewports.js. Use them instead of redefining them.

VITEST
- *.test.js runs in node, *.test.jsx in jsdom. A single file can switch with the comment `// @vitest-environment jsdom`.
- Globals (describe/it/expect/vi) are on and recognized by ESLint.
- localStorage and sessionStorage exist in both environments and are emptied after every test. `vi.spyOn(Storage.prototype, ...)` works in jsdom.

TYPECHECK
- It covers src/lib/**/*.js except *.test.js. The vite/client types are loaded.
- Delete src/test/typecheck-anchor.js only once src/lib has at least one .js file. Until then tsc fails with TS18003 (no inputs found).

BUNDLE
- `npm run bundle` only counts what dist/index.html loads on first paint: the entry script, modulepreload links and CSS. Chunks loaded later through import() are listed but do not count against the budget (BUNDLE_BUDGET_KB, default 180; kB = 1000 bytes).