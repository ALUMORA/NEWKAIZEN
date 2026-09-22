# KAIZEN API v2: contract spec (input for S1; S1 turns this into kaizen_api/schemas.py + docs/api-v2.md)

## Conventions (non-negotiable)
- JSON, UTF-8. Field names camelCase.
- **Units:** every rate, return, yield, margin, growth, weight, probability is a DECIMAL FRACTION (0.0123 = 1.23%). Multiples (P/E, EV/EBITDA, P/B, P/NAV, D/E) are plain ratios. Changes in interest rates are basis points in fields ending in `Bp`. Money amounts are in the currency named by the nearest `currency` field. Dates are ISO `YYYY-MM-DD`; instants are ISO 8601 with offset (UTC `Z`).
- **Provenance:** every successful response has `meta`:
  `{ asOf: string|null (date or instant of the newest data point), source: string ("yahoo"|"banxico"|"fred"|"sec"|"cboe"|"stooq"|"rss"|"computed"|"replay"|comma list), delayMinutes: int|null, stale: bool, fallback: bool, generatedAt: instant, notes: string[] }`.
  `fallback=true` means a substitute source or a fixed reference value was used; the UI must say so. There is NO silent fixed USD/MXN 17.5 or rf 8.6% anymore: if no real value exists, return 503 UPSTREAM_UNAVAILABLE.
- **Errors:** real HTTP status + `{ "error": { "code": str, "message": str (Spanish, user-safe), "details"?: object } }`.
  Codes: `VALIDATION_ERROR` 422, `INVALID_SYMBOL` 400, `NOT_FOUND` 404, `UNAUTHORIZED` 401, `RATE_LIMITED` 429 (+ `Retry-After`), `UPSTREAM_UNAVAILABLE` 502/503, `NOT_CONFIGURED` 503, `NOT_IMPLEMENTED` 501, `INTERNAL` 500 (no stack traces, no exception text).
- **Auth:** when env `AUTH_REQUIRED=true`, every route except `GET /health`, `POST /auth/login` and `OPTIONS` requires `Authorization: Bearer <jwt>`. When false (local dev), routes are open.
- **Symbols:** `^[A-Za-z0-9.\-\^=$]{1,20}$`, uppercased server-side. `.MX` = BMV/SIC in MXN. FX pairs like `USDMXN`.
- **Caching headers:** `Cache-Control: private, max-age=<n>` per data class (quotes 30, history 3600, fundamentals 21600, macro 3600, news 600, screeners 43200).
- v1 routes (the old `/stock`, `/chart`, ... with HTTP-200-plus-`{"error"}` semantics) exist only when `KAIZEN_LEGACY_ROUTES=1` (tests/dev, and the transitional legacy UI).

## Endpoints

### Platform
- `GET /health` (public) → `{ status:"ok", apiVersion:2, version, commit|null, authRequired:bool, capabilities:string[], providers:{ yahoo:{ok:bool|null}, banxico:{configured:bool}, fred:{configured:bool}, sec:{ok:bool|null}, eodhd:{configured:bool} }, serverTime }`
  capabilities include e.g. `"history.dates"`, `"fx.fix"`, `"rates.mx"`, `"rf.series"`, `"valuation.dcf"`, `"screeners.factors"`, `"statements.real"`, `"search"`, `"events"`.
- `POST /auth/login` body `{username, password}` → 200 `{ token, expiresAt, user:{ username, displayName } }` | 401 UNAUTHORIZED | 429 RATE_LIMITED.
- `GET /auth/me` → `{ user:{username, displayName}, expiresAt }`.

### Market data
- `GET /v2/quotes?symbols=A,B,...` (≤50) → `{ quotes:[{ symbol, name, price, previousClose, change, changePct, currency, exchange, type, marketState|null, asOf }], missing:string[], meta }`
- `GET /v2/search?q=&limit=10` → `{ results:[{ symbol, name, exchange, type:"equity"|"etf"|"fibra"|"index"|"fx"|"crypto"|"commodity"|"fund", currency, aliases:string[] }], meta }` (SEC company_tickers + curated data/symbols_mx.json with Spanish aliases; no network needed for MX list)
- `GET /v2/history/{symbol}?range=1mo|3mo|6mo|1y|2y|5y|10y|max&interval=1d|1wk|1mo&ccy=native|MXN|USD` → `{ symbol, currency, interval, adjusted:true, dates:string[], close:number[], fx:{ pair:"USDMXN", source }|null, meta }`
  Adjusted closes (splits + dividends = total return). Conversion uses the FX of the SAME date (forward-filled at most 3 days for FX gaps, reported in meta.notes).
- `GET /v2/panel?symbols=A,B&range=&interval=&ccy=MXN` → `{ currency, interval, dates:string[], prices:{ [symbol]: number[] }, dropped:[{symbol, reason}], meta }` — INNER JOIN on date, no forward fill of prices; returns are computed client-side.
- `GET /v2/fx?pair=USDMXN` → `{ pair, rate, asOf, source:"banxico_fix"|"yahoo", stale, meta }`
- `GET /v2/fx/history?pair=USDMXN&start=&end=` → `{ pair, dates, values, source, meta }` (Banxico FIX SF43718 when token, else Yahoo `MXN=X`, flagged)

### Rates and macro
- `GET /v2/rates/mx` → `{ items:[{ id, label, value, unit:"fraction"|"index"|"mxn", asOf, seriesId, source, previous|null, changeBp|null }], meta }`
  ids: `target` (Banxico objetivo SF61745), `tiie28`, `tiieFondeo`, `cetes28`, `cetes91`, `cetes182`, `cetes364`, `bonoM10` (if available), `inflationYoY` (INPC anual), `coreInflationYoY`, `udi`, `fix`.
  SIE series ids other than SF43718/SF61745 must be verified against the SIE metadata endpoint in a test before use.
- `GET /v2/rates/rf?start=&end=&tenorDays=28` → `{ tenorDays:28, convention:"simple_act360", dates, values, source:"banxico"|"fred_ir3tib", fallback, meta }` (annualized simple yields as fractions; client converts to per-period rf_d = (1+y·28/360)^(d/28) − 1)
- `GET /v2/macro/us` → `{ items:[{ id:"ust3m"|"ust2y"|"ust10y"|"spread10y2y"|"spread10y3m"|"vix"|"dxy"|"fedFunds", label, value, previous, change, changeBp|null, unit:"fraction"|"bp"|"index", asOf, source }], meta }`

### Markets and news
- `GET /v2/markets/overview` → `{ groups:[{ id:"mx"|"us"|"global"|"fx"|"commodities"|"crypto", label, items:[{ symbol, label, price, change, changePct, currency, asOf }] }], marketStatus:{ bmv:{ open, label, nextOpen|null, nextClose|null }, nyse:{...} }, meta }`
- `GET /v2/markets/world` → `{ items:[{ country, symbol (ETF), label, changePct, currency:"USD", asOf }], method:"iShares country ETFs in USD", meta }`
- `GET /v2/news?symbol=&lang=es|en|all&limit=30` → `{ items:[{ id, title, url, source, publishedAt, summary|null, lang, tone:{ label:"positivo"|"negativo"|"neutral", score, method:"heuristic" }|null }], meta }` (headline + link only; HTML entities decoded; deduped by normalized title)
- `GET /v2/events?symbols=A,B` → `{ items:[{ symbol, type:"earnings"|"exDividend"|"dividendPay", date, estimate|null, amount|null, currency|null }], meta }`

### Research
- `GET /v2/instrument/{symbol}` → `{ symbol, name, exchange, type, sector, industry, country, description, website|null, priceCurrency, financialCurrency, fxUsed:{ pair, rate, asOf }|null, quote:{ price, previousClose, change, changePct, dayLow, dayHigh, low52w, high52w, volume, avgVolume, marketCap, asOf }, fundamentals:{ pe, forwardPe, pb, ps, evEbitda, pfcf, earningsYield, fcfYield, dividendYield, payoutRatio, roe, roa, grossMargin, operatingMargin, netMargin, revenueGrowthYoY, epsGrowthYoY, debtToEquity, netDebtToEbitda, currentRatio, enterpriseValue, sharesOutstanding }, beta:{ value, adjusted, benchmark, currency, window, observations, source:"computed"|"yahoo" }|null, sectorMedians:{...}|null, coverage:{ available:int, total:int }, meta }`
  Every ratio mixing price with statements must convert statements from financialCurrency to priceCurrency first; debtToEquity is a ratio (Yahoo reports it in %; divide by 100).
- `GET /v2/instrument/{symbol}/statements?freq=annual|quarterly` → `{ symbol, currency, freq, source:"sec"|"yahoo", periods:[{ end, fiscalYear, fiscalQuarter|null, form|null }], rows:[{ id:"revenue"|"grossProfit"|"operatingIncome"|"netIncome"|"eps"|"totalAssets"|"totalDebt"|"cash"|"equity"|"operatingCashFlow"|"capex"|"freeCashFlow"|"dividendsPaid", label, values:(number|null)[] }], meta }` — real rows only, never synthesized; empty periods if unavailable.
- `GET /v2/instrument/{symbol}/dividends` → `{ symbol, currency, ttm, yield, history:[{ date, amount }], meta }`
- `GET /v2/valuation/{symbol}?erp=&crp=&terminalGrowth=&years=&growth=` → `{ symbol, currency, assumptions:{ rf, erp, crp, lambda, taxRate, terminalGrowth, source, asOf }, multiples:{ applicable, reason|null, market:"US"|"EM", source, asOf, methods:[{ id:"pe"|"pb"|"evEbitda"|"pfcf", label, current, benchmark, impliedPrice|null, applicable }], fairValueRange:{ low, mid, high }|null }, dcf:{ applicable, reason|null, inputs:{ fcff0, growth, years, terminalGrowth, betaU, betaL, debtToEquity, taxRate, costOfEquity, costOfDebt, wacc, currency }, projection:[{ year, fcff, discountFactor, pv }], terminalValue, pvTerminal, tvShare, enterpriseValue, netDebt, minorityInterest, equityValue, sharesOutstanding, perShare, sensitivity:{ waccs:number[], growths:number[], grid:(number|null)[][] }, warnings:string[] }, bank:{ applicable, justifiedPB, roe, costOfEquity, growth, impliedPrice }|null, meta }`
- `GET /v2/momentum/{symbol}` → `{ symbol, currency, benchmark, r12m1, r6m, r3m, benchmarkR12m1, relative12m1, meta }`

### Screeners
- `GET /v2/screeners/factors?universe=mx|us|custom&symbols=` → `{ universe:{ id, name, size }, method:str, rows:[{ symbol, name, sector, scores:{ value, quality, momentum, lowVol, growth, composite }|null, coverage, excluded:bool, reason|null, checks:[{ id, label, pass:bool|null, value, threshold }], metrics:{...} }], meta }`
- `GET /v2/screeners/magic?universe=us|mx` → `{ universe:{ id, name, size, description }, rows:[{ symbol, name, sector, ebit, enterpriseValue, earningsYield, returnOnCapital, rankEY, rankROC, rank, currency, fiscalPeriodEnd }], excluded:[{ symbol, reason }], partial:bool, meta }` (never mixes estimated EBIT)
- `GET /v2/screeners/fibras?extra=A,B` → `{ rows:[{ symbol, name, price, currency, financialCurrency, marketCap, distributionYield, capRate|null, navPerCbfi|null, pNav|null, ltv|null (debt/total assets), debtToMarketCap|null, cashFlowYield|null, cashFlowBasis:"ffo_approx"|"ocf"|"fcf"|null, spreadVsCetes|null, signal:"descuento"|"en_linea"|"prima"|"sin_datos", type:"propiedades"|"hipotecaria"|"energia"|"otro" }], cetes28, meta }`
- `GET /v2/insiders/{symbol}` → `{ items:[{ date, insider, role, type:"compra"|"venta"|"otorgamiento"|"ejercicio"|"otro", shares, value, planned10b5_1|null }], summary:{ openMarketBuys, openMarketSells }, meta }`
