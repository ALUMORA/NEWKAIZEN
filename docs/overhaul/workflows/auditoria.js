export const meta = {
  name: 'newkaizen-understand',
  description: 'Read-only multi-lens audit of NEWKAIZEN (finance theory, UX, architecture, product gaps) with adversarial verification',
  phases: [
    { title: 'Audit', detail: 'parallel read-only readers, one per lens and code area' },
    { title: 'Verify', detail: 'skeptic per high-impact finding tries to refute it' },
  ],
}

const REPO = '/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN'
const PRE = `You are auditing the NEWKAIZEN repo at "${REPO}" (React 19 + Vite JS frontend in src/App.jsx ~5500 lines, src/ui.jsx, src/theme.css, src/theme.js; Python backend backend.py ~2000 lines using yfinance, FRED, CBOE, Stooq, SEC EDGAR, RSS). Frontend deploys to Vercel, backend to Render.
Product vision from the owner: a cheap "Bloomberg terminal" that an everyday financial enthusiast can afford, or that small companies can give to their employees. Users are mainly in Mexico (MXN, BMV tickers ending in .MX, FIBRAs, CETES/Bono M) and also invest in US stocks. UI text is Spanish.
STRICT READ-ONLY: do NOT edit, create, move or delete any file; do NOT run builds, installs, servers, formatters or git. You may use Read, Grep, Glob and read-only shell commands (sed -n, grep, wc, cat). Read your assigned line ranges IN FULL (use Read with offset/limit in chunks), not excerpts.
Every finding must cite file and line numbers and quote or paraphrase the exact code as evidence. Be concrete: say what is wrong, why (cite the finance/economics principle, UX principle or engineering reason), and the precise fix. Prefer fewer, correct, high-value findings over many speculative ones. Severity: critical = wrong numbers users would act on or security hole; high = materially misleading or broken feature; medium = noticeable quality issue; low = polish.`

const FINDING = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    file: { type: 'string' },
    lines: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    category: { type: 'string' },
    evidence: { type: 'string' },
    why: { type: 'string' },
    fix: { type: 'string' },
  },
  required: ['title', 'file', 'lines', 'severity', 'category', 'evidence', 'why', 'fix'],
}
const READER_SCHEMA = {
  type: 'object',
  properties: {
    inventory: { type: 'string', description: 'What this area contains and does today: features, formulas, data flow, UI elements. Dense, factual, 150-400 words.' },
    findings: { type: 'array', items: FINDING },
  },
  required: ['inventory', 'findings'],
}
const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    inventory: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          why_valuable: { type: 'string' },
          audience: { type: 'string', enum: ['enthusiast', 'employer', 'both'] },
          effort: { type: 'string', enum: ['S', 'M', 'L', 'XL'] },
          data_source: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        },
        required: ['feature', 'why_valuable', 'audience', 'effort', 'data_source', 'priority'],
      },
    },
    b2b_needs: { type: 'string' },
    data_licensing: { type: 'string' },
    reuse_from_kaizen02: { type: 'string' },
  },
  required: ['inventory', 'strengths', 'gaps', 'b2b_needs', 'data_licensing', 'reuse_from_kaizen02'],
}
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'partially', 'refuted'] },
    reasoning: { type: 'string' },
    corrected_fix: { type: 'string' },
  },
  required: ['verdict', 'reasoning', 'corrected_fix'],
}

const READERS = [
  {
    key: 'quant-frontend', lens: 'finance',
    prompt: `${PRE}
LENS: portfolio theory and quantitative finance correctness (frontend math).
Read src/App.jsx lines 1-440 (MXN helpers, calcSharpe, calcPortfolioSharpe, buildCovMatrix, optimizeSharpe with W_MIN/W_MAX, tracking error, beta, Treynor, Jensen alpha, information ratio, cumulativeReturns, mlScoreStock), 818-911 (MonteCarloChart), 1291-1870 (computeStats, corrBetween, sharpeOf, runOptimization, runBacktest, runMonteCarlo, loadSharpeData), and the render code of the optimize tab (3184-3500) and analytics tab (4242-4550).
Check: return frequency vs annualization (weekly/daily factor, sqrt-time), arithmetic vs geometric/log returns, sample vs population variance, covariance estimation and alignment of dates across tickers, risk-free rate units and currency consistency (MXN rf applied to USD returns?), currency conversion of returns for a MXN investor (USD assets need FX-adjusted returns), Sharpe on excess returns, beta/alpha definitions (Jensen uses excess returns), information ratio uses active returns, max drawdown, Monte Carlo design (i.i.d. normal vs bootstrap, drift, volatility drag, lognormal compounding, percentiles), backtest look-ahead bias and survivorship, optimizer (random portfolios vs proper mean-variance, weight constraints, estimation error, in-sample overfitting), labels that overclaim ("ML", "optimal").`,
  },
  {
    key: 'valuation-backend', lens: 'finance',
    prompt: `${PRE}
LENS: corporate finance, valuation and data correctness (backend).
Read backend.py lines 30-520 (cache, _fetch_hist, safe/pct helpers, debt-to-assets, dividend yield, leverage, get_stock, get_fx, get_returns, get_chart incl. MXN conversion), 806-1180 (get_dcf, EDGAR ticker map and financials), 1700-1845 (get_momentum, classify_sentiment, news, get_rf).
Check: DCF mechanics (FCFF vs FCFE consistency with discount rate, WACC build: CAPM cost of equity, beta source, equity risk premium, country risk premium for Mexico, after-tax cost of debt, market-value weights), terminal value (Gordon growth g < r, g vs long-run nominal GDP/inflation, share of TV in EV), EV to equity bridge (net debt, minorities, share count), currency consistency (MXN cash flows discounted at USD rate?), per-share value and margin of safety; ratio definitions (P/E, PEG, EV/EBITDA, ROE, ROIC, debt/equity, dividend yield units %, payout), yfinance field pitfalls (units, stale/cached, percent vs fraction, trailing vs forward), EDGAR annual period detection, momentum definitions (12-1 month skip), risk-free rate choice and units, keyword sentiment classifier validity.`,
  },
  {
    key: 'screeners', lens: 'finance',
    prompt: `${PRE}
LENS: screening methodology correctness (factor investing, Greenblatt Magic Formula, REIT/FIBRA valuation, insider data, the "ML" score).
Read backend.py lines 1179-1710 (_fetch_magic_ticker, get_magic_formula, get_magic_one, get_fibras, get_insiders) and src/App.jsx lines 60-82 (ticker universes), 312-434 (mlScoreStock, ScoreBar, MetricBadge), 1702-1815 (runScreener, runMagicFormula, runFibrasScreener), 3500-3721 (screener tab), 4550-4713 (fibras tab), 4713-4964 (magic formula tab).
Check: Magic Formula definition (Earnings Yield = EBIT/EV, Return on Capital = EBIT/(Net Working Capital + Net Fixed Assets), exclusion of financials and utilities, minimum market cap, combined rank = sum of ranks), universe size/survivorship, FIBRA metrics (FFO/AFFO, cap rate = NOI/property value, NAV per CBFI, P/NAV, distribution yield, LTV, the 0.85 discount heuristic), whether the "ML Screener" is actually machine learning or a hand-weighted heuristic (and whether it is labeled honestly), scoring thresholds that ignore sector context (e.g. P/E thresholds identical for banks and tech), look-ahead or stale data, insider transaction interpretation (buys vs sells, 10b5-1 plans, option exercises).`,
  },
  {
    key: 'macro-news', lens: 'finance',
    prompt: `${PRE}
LENS: macroeconomics and market-data presentation correctness plus news UX.
Read backend.py lines 516-806 (_fred_rate, _cboe_vix, _stooq_dxy, _make_entry, macro, _bulk_download, market, worldmap, RSS news, get_market_news) and src/App.jsx lines 435-800 (LineChart, COUNTRY_ROWS, GlobalMarketsTable, SectionLabel, MktCard, ResumenManero, MarketNewsItem) and 3721-4242 (news / market overview tab incl. Style Box and Fear & Greed).
Check: yield curve (10Y-2Y spread, which series, ^IRX is the 13-week bill NOT 2Y), units (bps vs %), VIX/DXY sources, "Fear & Greed" index construction (is it CNN's or homemade? labeled honestly?), Style Box methodology (Morningstar-like size/value-growth, how computed), daily % change computation (prev close vs open, stale weekend data), index/FX quotes conventions (USD/MXN direction), Banxico rate, Mexican inflation (INPC), CETES, whether narrative text generated from data ("Resumen") draws economically valid conclusions (e.g. inverted curve => recession claims, DXY interpretation), timestamps/staleness shown to users, and news relevance/dedup/sentiment.`,
  },
  {
    key: 'ux-ui', lens: 'ux',
    prompt: `${PRE}
LENS: UI/UX, information architecture, visual design system, accessibility (WCAG 2.1 AA), responsive/mobile behavior at 390px and 1440px, loading/empty/error states, microcopy (Spanish), data density and readability of financial numbers (tabular numerals, signs, colors for gains/losses, units, currency labels).
Read src/theme.css, src/theme.js, src/ui.jsx, src/cn.js, src/index.css, src/main.jsx IN FULL; src/App.jsx lines 900-1044 (LoginScreen, App), 1044-1170 (Workspace state), 2040-2299 (shell, sidebar/nav, header, TABS), 2299-3184 (portfolio tab), 4964-5512 (análisis / stock detail page). Skim other tabs for consistency (inline styles vs design tokens, hardcoded colors, duplicated components).
Report: navigation/IA problems (9 tabs flat? naming like "ML Screener", "Analytics vs SPY" for a Mexican investor), what a first-time user sees, onboarding, hierarchy, consistency with tokens, hardcoded colors that break the theme, keyboard/focus/ARIA issues, charts without accessible text, touch targets, horizontal overflow on mobile, number formatting, destructive actions without confirmation, lack of persistence/feedback. Include which primitives in ui.jsx exist and should be reused.`,
  },
  {
    key: 'architecture', lens: 'engineering',
    prompt: `${PRE}
LENS: architecture, reliability, security, performance, maintainability, deployability.
Read backend.py lines 1-180 and 640-730 and 1840-2002 IN FULL (sessions, caching, bulk download, auth, HTTP handler, CORS, server), src/App.jsx lines 1-60, 795-820 (portfolio persistence), 1004-1044, 1169-1290 (effects, loadStockData), 1440-1455 (ensureBackend), 1936-2040 (market loaders, auto-refresh, addStock), plus package.json, vite.config.js, eslint.config.js, render.yaml, Procfile, requirements.txt, index.html, README.md, .gitignore. You MAY run "cd '${REPO}' && npx eslint . 2>&1 | tail -60" (read-only lint) and report counts.
Check: auth model (login returns ok and client stores a localStorage flag; are data endpoints protected? plaintext USERS env), CORS "*", error messages leaking internals, no rate limiting on expensive endpoints (/magic, /fibras), thread safety of caches, cold starts on Render free plan, Yahoo rate limiting and yfinance ToS for a commercial product, 5500-line App.jsx monolith with ~100 useState (re-render cost, impossible to test, merge conflicts with collaborator), no tests at all, no TypeScript, bundle size (dist js ~387KB), request waterfalls/duplication, auto-refresh intervals, localStorage schema versioning, secrets handling, observability. Propose a concrete target architecture (module split of App.jsx into features, data layer, backend framework e.g. FastAPI, persistence e.g. Postgres/Supabase for users and portfolios, caching) with migration order that minimizes conflict with the collaborator.`,
  },
]

const PRODUCT_PROMPT = `${PRE}
LENS: product strategy. Goal: turn this into the best affordable "Bloomberg for everyday investors and for employers' financial-wellness programs" in Mexico/LatAm (plus US markets).
1) Build a feature inventory by skimming src/App.jsx (tabs: portfolio, news/market overview, analytics vs SPY, Sharpe optimizer, ML screener, análisis stock page, FIBRA screener, Fórmula Mágica; grep for tab === and section labels) and backend.py endpoints (/stock /chart /rf /news /macro /market /worldmap /dcf /edgar /fibras /magic /magic_one /insiders /momentum /returns /fx /login).
2) Also look at the sibling project "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/02 Kaizen" (TypeScript React app by the same owner): read its README/CLAUDE.md and list its src/ features and pages (grep routes, pages, components) to find ideas, content (e.g. education, risk profiling, rules, goals) or primitives worth porting. Read-only there too.
3) Produce the gap analysis vs a Bloomberg-lite: watchlists with alerts, transaction ledger (buys/sells/dividends, cost basis, realized vs unrealized P&L, TWR vs MWR/IRR), dividends calendar, earnings calendar, economic calendar (Banxico, INEGI, Fed, BLS), Mexican fixed income (CETES, Bonos M, Udibonos, UDI), FX, crypto maybe, command palette / ticker search with autocomplete (Bloomberg-like keyboard workflow), comparison of tickers, sector/country exposure and concentration, factor exposure, risk metrics (VaR/CVaR, max drawdown), rebalancing with transaction costs and Mexican tax (ISR on gains/dividends 10%, SIC), goals planning, retirement (AFORE, PPR), education/glossary tooltips for every metric, CSV/broker import (GBM, Bursanet, Actinver), export/reports PDF, mobile PWA, notifications. For employers: SSO, seats/admin console, privacy (employer must NOT see employee holdings), compliance disclaimers (not investment advice, CNBV), financial wellness content, group challenges. Be realistic about effort and data sources (free vs licensed; Banxico SIE API and INEGI API are free; yfinance is unofficial scraping and violates Yahoo ToS for commercial use: name licensed alternatives with rough pricing if you know them, flag uncertainty).
Prioritize: P0 = must fix/build for credibility, P1 = core differentiators, P2 = nice, P3 = later.`

const results = await pipeline(
  [...READERS, { key: 'product', lens: 'product', prompt: PRODUCT_PROMPT }],
  (r) => agent(r.prompt, {
    label: `audit:${r.key}`,
    phase: 'Audit',
    agentType: 'Explore',
    schema: r.key === 'product' ? PRODUCT_SCHEMA : READER_SCHEMA,
  }),
  async (out, r) => {
    if (!out) return { key: r.key, lens: r.lens, out: null }
    if (r.key === 'product') return { key: r.key, lens: r.lens, out }
    const toVerify = out.findings.filter(f =>
      f.severity === 'critical' || f.severity === 'high' || (r.lens === 'finance' && f.severity === 'medium'))
    const skipped = out.findings.length - toVerify.length
    if (skipped) log(`${r.key}: ${skipped} low/medium non-finance findings kept unverified`)
    const verdicts = await parallel(toVerify.map((f, i) => () => agent(
      `${PRE}
You are a skeptical senior reviewer (CFA-level for finance claims, staff engineer for code claims). Try hard to REFUTE the following audit finding by reading the actual code at the cited lines and surrounding context (callers, units, how the value is displayed). A finding is refuted if the code does not do what is claimed, if the claimed principle is wrong or misapplied, or if the issue is already handled elsewhere. "partially" if the core point stands but details, severity or the fix are wrong. If uncertain after checking, lean to "partially" and explain. Also give the corrected, precise fix.
FINDING:
${JSON.stringify(f, null, 2)}`,
      { label: `verify:${r.key}#${i + 1}`, phase: 'Verify', agentType: 'Explore', schema: VERDICT },
    ).then(v => ({ ...f, verdict: v ? v.verdict : 'unverified', verify_reasoning: v ? v.reasoning : '', corrected_fix: v ? v.corrected_fix : '' }))))
    const verifiedSet = new Set(toVerify)
    const unverified = out.findings.filter(f => !verifiedSet.has(f)).map(f => ({ ...f, verdict: 'unverified' }))
    return { key: r.key, lens: r.lens, inventory: out.inventory, findings: [...verdicts.filter(Boolean), ...unverified] }
  },
)

const all = results.filter(Boolean)
const findings = all.filter(x => x.key !== 'product').flatMap(x => (x.findings || []).map(f => ({ area: x.key, ...f })))
const refuted = findings.filter(f => f.verdict === 'refuted').length
log(`${findings.length} findings, ${refuted} refuted by skeptics`)
return {
  inventories: Object.fromEntries(all.filter(x => x.key !== 'product').map(x => [x.key, x.inventory])),
  findings: findings.filter(f => f.verdict !== 'refuted'),
  refuted: findings.filter(f => f.verdict === 'refuted').map(f => ({ area: f.area, title: f.title, reason: f.verify_reasoning })),
  product: (all.find(x => x.key === 'product') || {}).out || null,
}
