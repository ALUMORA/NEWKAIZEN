# KAIZEN frontend skeleton spec (input for S2; later C and F1-F5 build on it)

## Routes (Spanish URLs). `src/app/paths.js` exports these constants; `nav.js` (C) and features import them.
Public (no session): `/login`, `/aprender`, `/aprender/:termino`, `/legal/terminos`, `/legal/privacidad`, `/legal/aviso`.
Private (RequireAuth, inside AppShell):
- `/` → redirect `/mercados`
- Mercados (F2): `/mercados` (panorama), `/mercados/mexico` (tasas, CETES, inflación, FIX), `/mercados/cetes` (calculadora), `/mercados/noticias`
- Mi portafolio (F1): `/portafolio` (resumen y posiciones), `/portafolio/movimientos` (ledger), `/portafolio/rendimiento`, `/portafolio/riesgo`, `/portafolio/rebalanceo`
- Investigar (F3): `/investigar` (buscador), `/investigar/:symbol` (emisora), `/investigar/comparar` (?symbols=A,B), `/screener` (factores), `/screener/formula-magica`, `/screener/fibras`
- Herramientas (F4): `/herramientas/optimizador`, `/herramientas/backtest`, `/herramientas/simulador` (Monte Carlo, metas, retiro)
- F5: `/watchlist`, `/bienvenida` (onboarding)
- DEV only: `/dev/ui` (C)
- `*` → NotFound page (S2, simple)

Each feature folder owns `src/features/<area>/routes.jsx` exporting `export const routes = [{ path, element, handle:{ title, nav? } }]` (relative to root, e.g. `"portafolio"`, `"portafolio/movimientos"`), with pages lazy-loaded inside the feature (`const Page = lazy(() => import("./pages/X.jsx"))`). `router.jsx` (S2) imports all feature `routes.jsx` statically once and never changes again. Areas: markets, portfolio, research, tools, watchlist, learn, onboarding, auth, legal.
Until a feature is migrated, its routes render `<LegacyPage tab="..."/>` which mounts the legacy Workspace on the matching legacy tab: portafolio→"portfolio", mercados→"news", herramientas/backtest→"analytics", herramientas/optimizador→"optimize", screener→"screener", investigar→"analisis", screener/fibras→"fibras", screener/formula-magica→"magic". New-only routes render a simple "Próximamente" placeholder.

## Providers (`src/app/AppRoot.jsx`)
`<QueryClientProvider> <SessionProvider> <CapabilitiesProvider> <UiProvider (stub now; C fills: theme, toasts, dialogs)> <RouterProvider/>`. Theme: keep `src/theme.js` `useTheme()` (data-theme on <html>, key `kaizen_theme`).

## lib/api
- `client.js`: `API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8002" : "https://app-4-everyone.onrender.com")`. `apiFetch(path, { method="GET", body, signal, timeoutMs=20000, auth=true, retryColdStart=true })` → parsed JSON; throws `ApiError { status, code, message, details }` built from `{error:{code,message}}` or a generic Spanish message. GET retries network errors / 502 / 503 / 504 with backoff (2s, 5s, 10s, 20s, 30s) up to ~70 s while `capabilities.status==="waking"`; never retries 4xx. On 401: `session.clear()` and dispatch `window` event `kaizen:unauthorized` (RequireAuth listens and redirects to `/login?next=`).
- `capabilities.js`: `probeHealth()` → `{ status:"ready"|"legacy"|"down", apiVersion, authRequired, capabilities:Set, providers }`; `useCapabilities()`, `hasCapability(name)`. Legacy = `/health` answers without `apiVersion`. Show a non-blocking banner "Despertando el servidor…" while probing takes >3 s. Never block the whole UI on the probe.
- `legacy.js`: only when `import.meta.env.VITE_ALLOW_LEGACY === "true"`; adapters v1→v2 for: history (from `/chart/{s}?period&ccy=MXN` → `{dates:null, close, currency}` with `meta.notes=["alineación aproximada"]`), quotes (from `/stock/{s}`), fx (`/fx`), rf (`/rf` → constant series, `fallback:true`).
- `endpoints.js`: one function per v2 endpoint of `api-v2-spec.md` (JSDoc typedefs in `types.js`).
- `queries.js`: TanStack Query keys and options per data class: quotes `staleTime 30s, refetchInterval 60s (only when document visible)`, history `1h`, instrument/fundamentals `6h`, macro/rates `1h`, news `10m`, screeners `12h`, search `24h`. `retry` defers to client-level cold-start retry (retry: false for 4xx).

## Session (`src/lib/auth/session.js`)
`sessionStorage["kaizen.session"] = { token, expiresAt (ISO), user:{ username, displayName } }` plus in-memory copy. API: `getSession()`, `login(username, password)` (POST /auth/login), `logout()`, `isAuthenticated()`, `subscribe(fn)`. DEV + `VITE_SKIP_LOGIN=true` → synthetic session `{ token:null, user:{ username:"dev", displayName:"Dev" }, expiresAt: +12h }` (never in production builds: guard with `import.meta.env.DEV`). If `/health.authRequired === false`, requests go without Authorization header.
The legacy hardcoded password path must be REMOVED from the bundle (LegacyPage renders the legacy Workspace directly; delete LoginScreen/"Investments").

## Formatting (`src/lib/format.js`), es-MX
- `fmtMoney(value, currency, { decimals=2, compact=false, sign=false })` → `"$1,234.56 MXN"`, `"−$1,141.00 USD"`; null/NaN → `"—"`? NO em dash (user style): use `"s/d"` (sin dato) as the missing marker everywhere. Minus sign is U+2212.
- `fmtNumber(value, { decimals, compact })` (`compact` → "153.9 mil", "1.2 M", "3.4 mil M").
- `fmtPct(fraction, { decimals=2, sign=false })` → `"+1.23%"`, `"−0.45%"`.
- `fmtPp(fractionDiff)` → `"+0.35 pp"`; `fmtBp(bp)` → `"+12 pb"`.
- `fmtMultiple(x)` → `"15.6x"`; negative multiples → `"n/s"` (no significativo) with title text.
- `fmtDate(iso)` → `"19 sep 2026"`; `fmtDateTime(iso)` in America/Mexico_City → `"19 sep 2026, 14:05"`; `fmtRelative(iso, now)` → `"hace 5 min"`.
- `signOf(value)` → "up" | "down" | "flat" for coloring; components always show sign + color + (optionally) arrow, never color alone.

## Storage (`src/lib/storage.js`)
Key `kaizen:v2` → `{ v:2, updatedAt, portfolios:[{ id, name, baseCurrency:"MXN", createdAt, transactions:Transaction[], targets:{ [symbol]: fraction }, notes }], activePortfolioId, watchlists:[{ id, name, symbols:string[] }], settings:{ benchmark:"NAFTRAC.MX", riskProfile|null, onboardingDone:bool } }`.
`Transaction = { id, type:"buy"|"sell"|"dividend"|"deposit"|"withdrawal"|"split"|"fee", date:string|null, symbol|null, quantity|null, price|null, currency:"MXN"|"USD", fxRate|null (MXN per USD at trade date), fees:number, amount|null (cash for dividend/deposit/withdrawal/fee), ratio|null (split), note }`.
Migration v1 → v2 on first load: read legacy `momentum_portfolios` (array of `{id,name,positions:[{ticker,shares,cost,expPct?}],experimentalTotal?}`) or `momentum_portfolio` (positions array); `$MXN` position → `deposit` transaction of `shares*1` MXN; other positions → `buy` with `date:null`, `price:cost`, currency by `.MX` suffix, `fxRate:null`, `note:"Saldo inicial migrado"`. Also migrate `momentum_screener` (ticker list) into a watchlist "Mi lista". Before writing v2, copy each legacy key to `kaizen:backup:<ISO>:<key>`; NEVER delete legacy keys. Validation: drop malformed entries, keep a `migrationReport`. Expose `load()`, `save(state)`, `subscribe`, `exportJSON()`, `importJSON(text)` (validated), and `useStore(selector)` via useSyncExternalStore.
If storage is empty: start with NO portfolio (onboarding offers "Portafolio de ejemplo" clearly labeled EJEMPLO).
