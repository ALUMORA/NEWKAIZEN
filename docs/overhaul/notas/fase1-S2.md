# Fase 1, S2 (build; la corrección quedó a medias en el commit wip 464cd79)

## Resumen

The new frontend skeleton is built around the legacy app in worktree /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/S2 (branch ws/S2, 5 commits, not pushed). The legacy app still looks exactly the same: it passes the baseline with no snapshot updates, and it also matches the untouched legacy app pixel for pixel.

Legacy app: src/App.jsx moved to src/legacy/App.legacy.jsx (git sees it as a 98% rename, +22/-120 lines). Only these edits:
- the relative imports now point one folder up;
- detectBackend(candidates) takes the list of backends to try;
- the new exported LegacyWorkspaceHost({ tab, apiBase, onLogout }) detects the backend, shows the same "CONECTANDO" / "SIN CONEXIÓN" screens as before and renders Workspace on the requested tab (it follows tab changes by adjusting state during render, not with an effect);
- LoginScreen, AUTH_QUOTES, the "Investments" password, the kaizen_authed flag in localStorage, the dev-only skip-login shortcut and the icons only the login used are deleted.
grep finds 0 "Investments" in both dist/ and dist-e2e/ JS. The dev session and Google Fonts are also absent from dist, and there are no sourcemaps.

Fonts: @fontsource-variable/plus-jakarta-sans and jetbrains-mono are imported in src/main.jsx (normal and italic), and the Google @import is gone. --font-sans points to "Plus Jakarta Sans Variable". The woff2 files are byte-identical to Google's (checked by sha256 against the HAR). One difference remained: Google declared JetBrains Mono for weights 300 to 700 and @fontsource for 100 to 800, so the legacy score number drawn at weight 800 came out bolder (about 280 px off on Noticias). src/index.css now declares "JetBrains Mono" (latin, latin-ext and greek, normal and italic) with Google's 300 to 700 range over the same @fontsource files; other characters fall back to "JetBrains Mono Variable". Result, with exact pixel equality: 0 px difference from the untouched legacy on all 16 tab/viewport captures. The only differences from the committed PNGs (1 px of run-to-run noise on mobile Noticias, 1 px of height on Portfolio) also happen with the untouched code.

App structure (src/app/): AppRoot, router, paths, RequireAuth, ErrorBoundary + RouteError, NotFound, ComingSoon, LegacyPage, CapabilitiesBanner, RootLayout, PrivateLayout, shell/AppShell (placeholder) and app.css.
- AppRoot stacks ErrorBoundary > QueryClientProvider > SessionProvider > CapabilitiesProvider > UiProvider stub > ThemeSync + RouterProvider.
- The router uses createBrowserRouter: public routes, then a PrivateLayout (RequireAuth + AppShell), "/" redirects to /mercados, and anything else hits NotFound.
- LegacyPage lazily imports the legacy chunk (45 kB gzip) so it does not count against the first-load budget.
- The server banners do not block the page: "Despertando el servidor…" after 3 s, "Servidor sin actualizar" (closable, hidden on legacy routes), and "Sin conexión" with a Reintentar button.
- ErrorBoundary shows a Spanish message with "Recargar"; the stack trace appears only in development.

Feature routes: src/features/<area>/routes.jsx exists for markets, portfolio, research, tools, watchlist, learn, onboarding, auth and legal. Legacy-mapped routes render LegacyPage (the tab mapping follows the spec); new-only routes render "Próximamente" with a Spanish description. features/auth has a working login: username + password, show/hide toggle, Spanish messages for 401, 429 (with wait time), no network / server waking, legacy server and 5xx. It redirects to a safe ?next (internal paths only, never back to /login) and shows a note when the session expired or the person logged out.

Libraries (src/lib/):
- api/: config.js (API_BASE, buildUrl), http.js (ApiError, timeouts, Spanish messages, Retry-After read from the header or error.details.retryAfter), client.js (apiFetch with Bearer token, 401 clears the session and fires kaizen:unauthorized, cold-start retries), capabilities.js, CapabilitiesProvider.jsx, legacy.js, endpoints.js (every v2 endpoint, async, symbols checked before calling), queries.js, types.js.
- auth/: session.js and SessionProvider.jsx.
- format.js, storage.js (kaizen:v2 with migration, backups, validation, import/export, useStore), csv.js, portfolio/portfolios.js + usePortfolios.js, finance/ledger.js (average-cost stub).
- components/ui/UiProvider.jsx is a pass-through stub.

Config:
- vite.config.js keeps the react plugin and sets build.sourcemap false. No manualChunks: I measured it, and with a vendor chunk the first load was 106.63 kB against 105.78 kB without.
- vercel.json rewrites every non-/assets path to /index.html, so /investigar/WALMEX.MX works, and sets the requested security headers plus immutable caching for /assets.
- .env.example documents the three variables; it was added with -f because .gitignore ignores it.
- index.html has lang es-MX, the new title and Spanish description, theme-color for light and dark, and no external resources.

Tests: 280 unit tests (vitest) and 51 app e2e tests with 1 skipped. The e2e run passed twice in a row with --repeat-each=2 (82 passed, 2 skipped). The app e2e fixture e2e/fixtures/app/legacy-api.har (21 v1 responses) is derived from the legacy HAR by scripts/record-api-fixtures.mjs (npm run fixtures:api), with no network.

Visual check: I ran the replay backend (old module) on 8102 and `npm run dev` on 5202 with VITE_SKIP_LOGIN=true, then took Playwright screenshots at 1440x900 and 390x844 of /mercados, /portafolio, /portafolio/riesgo and an unknown route, plus /login from a production build served on 5203. I opened every image. The legacy sidebar and topbar render at /mercados (Noticias) and /portafolio (Portfolio). On a new route the legacy-server banner shows, and the login, NotFound and Próximamente pages lay out correctly at both widths.

## Commits

- a7910a0 feat: librerías base del cliente: API v2 con arranque en frío, sesión, formato es-MX, storage v2 con migración, CSV y ledger
- af0d1dd feat: esqueleto de la app con router, sesión, avisos del servidor y login; el legado pasa a src/legacy sin la contraseña fija
- 2ac6b88 chore: vercel.json con reescritura SPA y cabeceras de seguridad, y .env.example con las variables del frontend
- ccc6f79 test: e2e de la app nueva con login, rutas privadas, legado en LegacyPage, avisos y axe; fixture del API derivado del HAR
- d1ef9e1 test: endpoints v2 y adaptadores del API viejo; los endpoints siempre rechazan como promesa

## Compuertas

- `npm run lint`: Pass: 0 errors and 3 warnings (react-hooks/exhaustive-deps in legacy Workspace effects). The same 3 warnings appear on the untouched src/App.jsx at the base commit. Run with dist-e2e/ deleted; see open issues.
- `npm run typecheck`: Pass (tsc -p jsconfig.check.json, exit 0). src/lib type-checks; src/test/typecheck-anchor.js was deleted as Q0's notes asked.
- `npm run test`: Pass: 14 files, 280 tests (format, storage, csv, session, client, capabilities, endpoints and legacy adapters, ledger contract, portfolios, usePortfolios, paths, router, Q0 sanity).
- `npm run build && npm run bundle`: Pass: first-load JS 105.78 kB gzip (index 336,238 bytes) against a 180 kB budget (59% used); CSS 14.80 kB gzip; lazy chunks App.legacy 45.39 kB, LoginPage 2.28 kB, chart-line 0.17 kB.
- `grep -c Investments dist/assets/*.js && grep -c Investments dist-e2e/assets/*.js`: 0 in every JS file of dist/ (4 files) and dist-e2e/ (4 files). Also 0 matches for kaizen_authed, AUTH_QUOTES, displayName:"Dev" and googleapis/gstatic, and no .map files.
- `E2E_BASELINE_PORT=5202 npm run e2e:baseline`: 16 passed (34.6s), no snapshot updates. An extra exact-equality comparison against a git-archive copy of the base commit: 0 differing pixels on all 16 captures.
- `E2E_PORT=5203 npm run e2e`: 51 passed, 1 skipped (logout from the legacy on mobile: the legacy hides its sidebar under 768 px). --repeat-each=2 on app.spec.js: 82 passed, 2 skipped.
- `node scripts/check-ownership.mjs S2`: ✓ S2 (ws/S2): 71 archivo(s), todos dentro de su propiedad.
- `replay backend on 8102 + npm run dev on 5202 (VITE_SKIP_LOGIN=true) + Playwright screenshots at 1440x900 and 390x844`: /mercados shows legacy Noticias and /portafolio shows legacy Portfolio; /login, NotFound and Próximamente render correctly; no external requests. The legacy default portfolio gets HTTP 500 on /stock/MSFT, /stock/AMZN, /chart/MSFT and /chart/AMZN from the replay backend (ReplayMiss yf:MSFT:financials). The untouched legacy at the base commit, run against the same backend, gets the exact same 4 errors.

## Pendientes

- R0: the 2026-09-22 replay set has no MSFT or AMZN data (ReplayMiss for yf:MSFT:financials and others). With the replay backend, the legacy default portfolio (AAPL, MSFT, AMZN, CEMEXCPO.MX, WALMEX.MX) gets 4 HTTP 500s and the Portfolio tab stays on 'Cargando...'. The untouched legacy fails the same way. Recording those symbols would give clean dev screenshots.
- O: .gitignore line `.env.*` ignores .env.example. I added it with -f; please add `!.env.example` (filed in docs/requests/S2.md).
- O / deploy: the new build no longer has the hardcoded password. Do not deploy the frontend to Vercel until Render runs the v2 backend with POST /auth/login. Against the old backend the login page can only say 'El servidor todavía no tiene el nuevo inicio de sesión'.
- Q0: the baseline webServer probe in playwright.config.js still requests /src/App.jsx. Vite answers 200 with index.html, so the baseline keeps working, but the probe no longer warms up the legacy module. Suggested: /src/legacy/App.legacy.jsx.
- Q0: eslint.config.js ignores dist but not dist-e2e. After `npm run e2e`, `npm run lint` reports about 155 errors from minified code. Add 'dist-e2e' to globalIgnores.
- S1/B1: CORS must send `Access-Control-Expose-Headers: Retry-After`, otherwise the browser cannot read it cross-origin. The client also accepts error.details.retryAfter (seconds); ideally send both. Preflight must allow the Authorization header. v2 /health must keep status:'ok', because the legacy detection checks it.
- C1: two useTheme() instances are live (ThemeSync in AppRoot and the legacy Workspace). They agree on load but do not share toggle state. UiProvider should own a single theme store.
- Legacy on mobile has no logout control (the sidebar is hidden under 768 px). This predates S2; the e2e logout test is skipped on mobile with that reason.
- Nothing in the running app calls storage.load() yet, so the kaizen:v2 migration first runs when F1 or F5 use useStore / usePortfolios. Until the legacy portfolio page is replaced, the legacy keeps writing momentum_* keys, which are never deleted.

## Notas para los siguientes streams

ROUTES / FEATURES
- Every area has src/features/<area>/routes.jsx exporting `routes = [{ path: route(PATHS.x), element, handle: { title, public?, legacy?, description? } }]`.
- src/app/router.jsx imports them statically; do not edit router.jsx.
- `path` is relative. Always use the constants and helpers in src/app/paths.js: PATHS, route(), pathInstrument(symbol), pathCompare(symbols), pathLearnTerm(term), pathLogin(next), safeNext(next).
- handle.title sets the tab title ("Riesgo · Kaizen"). handle.public:true puts the route outside RequireAuth. handle.legacy:true marks a route that renders <LegacyPage tab=…/> and hides the 'Servidor sin actualizar' banner there.
- Lazy pages must live in an object, or react-refresh lint fails: `const Pages = { Risk: lazy(() => import('./pages/RiskPage.jsx')) }` then `element: <Pages.Risk />`. RootLayout provides the Suspense boundary.
- To migrate a route: replace `<LegacyPage tab=…/>` with your page and drop `legacy:true`.
- New-only routes use `<ComingSoon/>`, which reads handle.title and handle.description.
- dev-ui (C1): src/features/dev-ui/routes.jsx exists with `routes = []`; the router registers it only when import.meta.env.DEV.
- Shell (C3): src/app/shell/AppShell.jsx is a pass-through `<Outlet/>` wrapped around every private route. Replace it in place.
- The legacy host API is LegacyWorkspaceHost({ tab, apiBase, onLogout }) in src/legacy/App.legacy.jsx. Tabs: news, portfolio, analytics, optimize, screener, analisis, fibras, magic.

API
- Use `import { getQuotes, getHistory, … } from 'src/lib/api/endpoints.js'` (all async, all take `{ signal }`).
- With TanStack Query: `useQuery(quotesQuery(['AAPL','WALMEX.MX']))`, `useQuery(historyQuery('NAFTRAC.MX', { range:'5y', interval:'1wk', ccy:'MXN' }))`, and so on. queryKeys and STALE_TIME are in queries.js; createQueryClient() retries at most once and never on 4xx.
- Errors are ApiError { status, code, message (Spanish, safe to show), details, retryAfter, fromApi }. status 0 means network or timeout (code NETWORK_ERROR / TIMEOUT). LEGACY_SERVER means the server still runs the v1 API.
- Endpoints wait for the /health probe. On a legacy server they throw LEGACY_SERVER, except history, quotes, FX and rf when VITE_ALLOW_LEGACY=true (adapters in legacy.js; history comes back with dates:null and meta.notes ['alineación aproximada']; rf comes back as a constant series with fallback:true and source 'legacy_bono_m_10y').
- Low-level calls: apiFetch(path, { method, body, query, signal, timeoutMs, auth, retryColdStart }).
- Server state: useCapabilities() → { status: 'probing'|'waking'|'ready'|'legacy'|'down', apiVersion, authRequired, capabilities:Set, providers }, plus hasCapability('history.dates').
- Always render meta.asOf, meta.source, meta.fallback and meta.notes: the contract requires telling the person where data came from.

SESSION
- Storage: sessionStorage['kaizen.session'] = { token, expiresAt ISO, user:{ username, displayName } }.
- src/lib/auth/session.js: useSession(), getSession(), login(u,p), logout(), isAuthenticated(), getToken(), peekEndReason() / consumeEndReason() ('expired'|'unauthorized'|'logout').
- With VITE_SKIP_LOGIN=true, `npm run dev` has a 12-hour synthetic 'dev' session with token null; it is compiled out of every build.
- A 401 clears the session and RequireAuth redirects to /login?next=…; after an explicit logout it goes to plain /login.
- F5 may restyle src/features/auth/pages/LoginPage.jsx but must keep its labels. The e2e tests find fields by label ('Usuario', 'Contraseña'), the button by name 'Entrar', and the error by role=alert.

STORAGE
- Key: localStorage['kaizen:v2'] = { v:2, updatedAt, portfolios:[{ id, name, baseCurrency:'MXN', createdAt, transactions, targets:{SYM:fraction}, notes }], activePortfolioId, watchlists:[{ id, name, symbols }], settings:{ benchmark:'NAFTRAC.MX', riskProfile, onboardingDone }, migrationReport }.
- Transaction = { id, type: buy|sell|dividend|deposit|withdrawal|split|fee, date: 'YYYY-MM-DD'|null, symbol, quantity, price, currency: MXN|USD, fxRate (MXN per USD), fees, amount, ratio, note }.
- API: load(), save(state), update(fn), subscribe, useStore(selector), exportJSON(), importJSON(text) (throws ImportError; backs up the current state first), validateTransaction(raw), getStorageError().
- Migration runs once on the first load(). momentum_portfolios wins over momentum_portfolio. $MXN becomes a deposit; other positions become buys with date null and note 'Saldo inicial migrado'; momentum_screener becomes the watchlist 'Mi lista'.
- Each legacy key is backed up to kaizen:backup:<ISO>:<key>; legacy keys are never deleted.
- migrationReport includes legacyExample:true when the old demo portfolio is detected. F5 can use it to decide whether to show onboarding; onboardingDone stays false after migration.
- Empty storage means no portfolio at all; the example portfolio labeled EJEMPLO is F5's job.
- Hooks in src/lib/portfolio/usePortfolios.js: usePortfolios({ asOf }) → { portfolios, active, activeId, positions, actions }; also useWatchlists() and useSettings(). Pure operations in portfolios.js throw PortfolioError with Spanish messages.
- derivePositions(transactions, { asOf }) in src/lib/finance/ledger.js is a stub (average cost; buys without a price give costBasis null). Stream A replaces the internals and must keep src/lib/portfolio/ledger.contract.test.js passing.

FORMAT (src/lib/format.js)
- fmtMoney(v, 'MXN', { decimals, compact, sign }) → '$1,234.56 MXN' or '−$1,141.00 USD'.
- fmtNumber(v, { compact }) → '153.9 mil', '1.2 M', '3.4 mil M', '2.5 B'; fmtInt.
- fmtPct(fraction, { sign }) → '+1.23%'.
- fmtPp → '+0.35 pp'; fmtBp → '+12 pb'.
- fmtMultiple → '15.6x', or 'n/s' for negatives; describeMultiple() also returns the title text.
- fmtDate → '19 sep 2026'; fmtDateTime → '19 sep 2026, 14:05' (America/Mexico_City); fmtRelative(iso, now) → 'hace 5 min'.
- signOf(v, eps) → 'up'|'down'|'flat'.
- Missing values always render as 's/d'. The minus sign is U+2212. Month abbreviations are fixed ('sep', never 'sept').
- CSV: toCSV (BOM, CRLF, formula-injection guard that stays reversible), parseCSV({ unguard }), rowsToObjects, objectsToCSV, downloadCSV.

E2E
- Use `import { test, expect } from './support/guards.js'` and `setupApp(page, { baseURL, health: 'v2'|'legacy'|'down'|object, healthDelayMs, legacyApi, session, routes })` from e2e/support/app.js. It blocks external hosts, mocks /health and your routes through mockApi, can replay v1 legacy responses from e2e/fixtures/app/legacy-api.har, can seed a session (DEFAULT_SESSION in e2e/support/auth.js now has the final shape) and pins the clock.
- To mock v2 data: `routes: { 'GET /v2/quotes': { json: {...} } }`.
- For an intentional 4xx/5xx, use Playwright's plain `test`, attach guards yourself with `attachGuards(page, { allow: expectedHttpError(401, 'POST', '/auth/login', 'motivo') })` and call assertClean() at the end.
- Wait for the legacy app with trackNetwork(page, API_URL_RE) + waitForSettled.
- Run with your own ports: E2E_PORT=<web port> npm run e2e; E2E_BASELINE_PORT=<web port> npm run e2e:baseline.
- axe: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])`.

C / C1 / C3
- src/index.css now declares the JetBrains Mono alias limited to weights 300 to 700 and overrides --font-sans / --font-mono after importing theme.css. Keep that until the legacy is retired, or the baseline breaks.
- src/app/app.css holds the .kz-* classes for banners, message pages and the login field (tokens only). C may replace them.
- UiProvider is a stub, mounted inside the session and capabilities providers and above the router.
- The CSP in vercel.json allows only 'self' plus https://*.onrender.com for connect-src, and fonts only from 'self'. Never add external fonts or scripts.

# Revisión independiente de S2 (defectos por corregir)

Veredicto: **pass_with_issues**

## Comandos

- OK `npm run lint`: 0 errors and 3 warnings (react-hooks/exhaustive-deps in src/legacy/App.legacy.jsx lines 1122, 1190 and 1873, carried over from the legacy code). With dist-e2e/ present after `npm run e2e`, it reports 158 problems (155 errors) because eslint.config.js (owned by Q0) does not ignore dist-e2e. After I deleted the dist-e2e/ I had created, the run was clean again.
- OK `npm run typecheck`: tsc -p jsconfig.check.json, exit 0 (checks src/lib/**/*.js).
- OK `npm run test`: 14 files, 280 tests passed in 1.08 s.
- OK `npm run build && npm run bundle`: First-load JS is 105.78 kB gzip (index-DPCtUcLd.js, 336,238 bytes) against a 180 kB budget, 59% used. CSS is 14.80 kB gzip. Lazy chunks: App.legacy 45.39 kB, LoginPage 2.28 kB, chart-line 0.17 kB. No .map files.
- OK `grep -c Investments dist/assets/*.js ; dist-e2e/assets/*.js`: 0 in all 4 JS files of dist/ and all 4 of dist-e2e/. Also 0 matches for kaizen_authed, AUTH_QUOTES, googleapis and gstatic, and none for displayName:"Dev" or username:"dev".
- OK `VITE_SKIP_LOGIN=true vite build --outDir <scratch>/dist-skip`: Produces the same index-DPCtUcLd.js hash as the normal build, so the dev session is compiled out of production builds.
- OK `E2E_BASELINE_PORT=5212 npx playwright test --project=baseline-desktop --project=baseline-mobile`: 16 passed (34.2s). git status is clean, and no commit touches e2e/baseline.spec.js or its snapshots.
- OK `Strict pixel check: baseline spec with snapshotPathTemplate pointed at scratchpad + node PNG compare against committed e2e/baseline.spec.js-snapshots/*.png`: 0 differing pixels on all 16 tab/viewport captures, with identical sizes. The legacy UI is pixel-identical to the committed baseline.
- OK `E2E_PORT=5213 npx playwright test`: 51 passed, 1 skipped. The skip is logout-from-legacy on mobile, where the legacy hides its sidebar under 768 px; this predates S2.
- OK `node scripts/check-ownership.mjs S2`: ✓ S2 (ws/S2): 71 archivo(s), todos dentro de su propiedad. exit 0
- OK `Replay backend (old module) on 8112 + vite dev on 5212 (VITE_API_URL=http://127.0.0.1:8112, VITE_SKIP_LOGIN=true); Playwright screenshots of /mercados, /portafolio, /portafolio/riesgo, /no-existe and / at 1440x900 and 390x844`: I opened 6 images: mercados-desktop, mercados-mobile, portafolio-desktop, portafolio-mobile, portafolio_riesgo-mobile and no-existe-desktop, all in scratchpad/rev-s2/shots/.
- /mercados shows the legacy Panorama de Mercados with real KPIs and Resumen Mañanero.
- /portafolio shows the legacy Portfolio with valuation cards.
- / redirects to /mercados.
- The Próximamente and NotFound pages render, with the 'Servidor sin actualizar' banner.
- Computed font is "Plus Jakarta Sans Variable". No external requests. No horizontal overflow on these routes.
- 4 HTTP 500s on /stock|/chart MSFT and AMZN come from replay misses (R0 set), not from S2.
- OK `Probe on dist-e2e via vite preview :5213 (scratch spec using e2e/support/app.js)`: A) Seeded session, /health v2 with authRequired:true, /mercados: 0 of 23 legacy API requests carried an Authorization header.
B) Tab/newline trick in ?next: /login?next=%2F%09%2Fexample.com with a session renders 'Algo salió mal' ('External navigation is not allowed' from React Router). No open redirect, but the login flow crashes.
C) Clicking 'Sharpe Optimizer' in the legacy sidebar at /mercados changes the view, but the URL stays /mercados and the title stays 'Mercados · Kaizen'. Reload returns to Noticias.
D) A forged sessionStorage session opens private routes. That is expected for a client-side guard.
- OK `node spot-check of src/lib/format.js`: Minus sign is U+2212, s/d for missing values, no em or en dashes in new code (grep over src/app, src/features, src/lib, src/components, index.html, index.css). fmtDateTime is correct in America/Mexico_City. Impossible dates are accepted: fmtDate('2026-02-31') gives '31 feb 2026'.

## Defectos

- [major] The legacy UI mounted by LegacyPage never sends the session token. In the e2e build with a seeded session and /health {apiVersion:2, authRequired:true}, 0 of 23 legacy requests (/rf, /macro, /fx, /stock/*, /chart/*, /market, /news/market, /worldmap, /dcf/*) had an Authorization header. S1's kaizen_api/routers/legacy_v1.py puts Depends(require_user) on every v1 GET route. So once the v2 backend runs with AUTH_REQUIRED=true and KAIZEN_LEGACY_ROUTES=1, every legacy-mapped route (/mercados, /portafolio, /investigar, /screener*, /herramientas/*), which are all the working pages today, gets 401s and renders empty. Because those 401s bypass apiFetch, the session is not cleared either. Against the old backend nobody can log in, so no backend configuration with real auth makes this build usable. The e2e test (c) misses this because the HAR fixture answers regardless of headers. Fix, inside S2's files: in LegacyPage/LegacyWorkspaceHost, add a scoped fetch wrapper while the legacy is mounted, or a single legacyFetch helper as a one-line-per-call legacy edit. It should add `Authorization: Bearer ${getToken()}` for URLs starting with API_BASE when getCapabilities().authRequired !== false, and on a 401 call clearSession('unauthorized') and dispatch kaizen:unauthorized. Add an e2e case where the mocked v1 routes return 401 without the header and assert the legacy renders data only when the header is present.
- [minor] safeNext() in src/app/paths.js does not reject ASCII control characters. /login?next=%2F%09%2Fexample.com (or %0A) passes the check. The URL parser strips the tab and sees //example.com. React Router refuses the navigation ('External navigation is not allowed'), so the page shows the 'Algo salió mal' error screen instead of falling back to /mercados. A crafted link can therefore break the login flow; it is not an open redirect. Fix: return the fallback when next matches /[ -]/, or when new URL(next, location.origin).origin !== location.origin. Add unit cases to paths.test.js and an e2e case next to the '?next externo' test.
- [minor] The URL and the legacy tab get out of sync. Clicking another tab in the legacy sidebar (e.g. Sharpe Optimizer at /mercados) changes the view, but the URL stays /mercados and the title stays 'Mercados · Kaizen'. Reload and browser Back return to the route's tab, and links cannot be shared. Fix: pass an onTabChange callback from LegacyPage to Workspace, a one-prop legacy edit alongside initialTab, that calls navigate() to the path mapped from the tab (inverse of the routes' tab mapping), or document this as a known limitation until the features replace the legacy.
- [minor] Retries stack on top of each other. apiFetch already retries GET network, timeout and 502/503/504 errors for about 67 s (5 attempts). Then shouldRetry in src/lib/api/queries.js lets TanStack Query retry once more, so the whole cold-start loop runs again. A server that is really down makes a query wait about 140 s before showing its error. Fix: in shouldRetry, return false when isColdStartError(error) or error.status === 0, since the client already retried those. Add a queries unit test.
- [minor] fmtDate accepts impossible calendar dates: fmtDate('2026-02-31') returns '31 feb 2026' instead of 's/d'. Fix: validate the YYYY-MM-DD with a UTC round trip (as storage.js isIsoDate already does) before formatting, and add a test.
- [minor] storage.load() treats any well-formed state whose v is not 2 (for example a future v:3 written by a newer build) as corrupt. It backs the state up, then re-migrates from the momentum_* keys or starts empty, and overwrites kaizen:v2. After a rollback, newer data would silently disappear from the active state (it is only recoverable from the backup key). Fix: when raw.v > 2, do not overwrite. Serve an in-memory empty or read-only state, set getStorageError() to a Spanish 'datos de una versión más nueva' message, and add a test.
- [minor] The migration is a one-time snapshot. After the first load() of kaizen:v2, the legacy app keeps writing momentum_portfolios and momentum_screener, and those edits never reach v2 (and v2 edits never reach the legacy). Nothing calls load() yet, so this is latent. It becomes real data divergence as soon as F1 ships a new portfolio page while legacy tabs such as the Sharpe optimizer still read momentum_portfolios. S2 filed this. Fix: F1/O decide either to re-migrate when the legacy keys' content hash changes and v2 has no user edits yet, or to retire the legacy portfolio tabs at the same time.
- [minor] Gate order pitfall, owned by Q0 and already filed by S2 in docs/requests/S2.md: eslint.config.js globalIgnores lacks 'dist-e2e'. After `npm run e2e`, `npm run lint` fails with 155 errors from minified code. S2's own lint pass only holds when dist-e2e/ is absent. Fix: add 'dist-e2e' to globalIgnores.