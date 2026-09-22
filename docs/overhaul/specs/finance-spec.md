# Kaizen finance library spec (src/lib/finance/*). Pure ES modules, no React, no fetch. JSDoc on every export (checked by tsc --checkJs). Numbers are plain JS numbers; rates/returns/weights are fractions.

General rules
- Never mix currencies: every price/return series passed in is already in one currency (the API's `ccy=MXN` history). Functions that need FX take it explicitly.
- Periodicity: `periodsPerYear(interval)` → 1d: 252, 1wk: 52, 1mo: 12. Every annualizing function takes `k` explicitly (no hidden 52).
- Sample statistics use n−1. Functions return `null` (not 0, not NaN) when there is not enough data (document the minimum n), so the UI can show "s/d".
- Deterministic: randomness only via `src/lib/rng.js` (seeded).
- Each module has a `*.test.js` with the known-answer cases below (toBeCloseTo with 6+ digits) plus edge cases (empty, one point, zeros, NaN input rejected). Where a Python reference exists (numpy/scipy/scikit-learn/PyPortfolioOpt in `.venv-golden`), `scripts/golden/<module>_golden.py` writes `tests/golden/<module>.json` ({cases:[{name, input, expected, tol}]}) and the JS test iterates it.

## A1: returns.js, stats.js, performance.js, benchmark.js, rates.js, risk.js, backtest.js, fx.js, index.js
returns.js
- `simpleReturns(prices)`, `logReturns(prices)`: P=[100,110,99,108.9] → simple [.10,−.10,.10]; Σlog = ln 1.089 = .0852600.
- `alignPanel(seriesBySymbol: {[s]: {dates:string[], values:number[]}})` → `{ dates, values:{[s]:number[]}, dropped:string[] }` inner join on ISO date, no forward fill. A{d1..d4: 100,110,121,133.1}, B{d1,d3,d4: 50,55,60.5} → dates [d1,d3,d4]; returns afterwards A [.21,.10], B [.10,.10].
- `periodsPerYear(interval)`, `inferInterval(dates)` (median gap: ≤3 days→1d, ≤10→1wk, else 1mo).
- `cumulative(returns)` → growth-of-1 path starting at 1.
stats.js
- `mean`, `variance` (n−1), `stdev`, `covariance(x,y)` (n−1), `correlation`, `quantile(sorted, q)` (type 7), `ols(y, x)` → {alpha, beta, r2, residualStd, n}.
- r=[.01,.02,−.01,.03,0] → mean .01, var 2.5e−4, sd .0158114; annualized weekly vol .114018.
performance.js
- `cagr(startValue, endValue, years)`; `cagrFromReturns(returns, k)`; 100→200 in 3y → .259921; [+50%,−50%] per period → arithmetic mean 0, geometric −.133975.
- `annualizedVol(returns, k)`.
- `sharpe(returns, rfPerPeriod: number|number[], k)` = mean(e)/sd(e)·√k with e = r − rf (arrays aligned); e=[.01,.02,−.01,.03,0] → .632456 per period, 4.560702 annualized (k=52).
- `sortino(returns, rfPerPeriod, k, marPerPeriod=rf)`: DD = √(Σ min(0,e)²/n) over ALL n; e=[.02,−.01,.03,−.02,.01] → per period .6; annualized = mean·k/(DD·√k) = 4.32666.
- `drawdowns(values)` → {series, maxDrawdown, peakIndex, troughIndex, recoveryIndex|null, durationPeriods}; W=[100,120,90,110,80,130] → MDD −.333333, peak 1, trough 4, recovery 5.
- `calmar(cagr, mdd)`.
- `historicalVaR(returns, alpha)`, `historicalCVaR` (k = ⌈n(1−α)⌉ worst, VaR = −r_(k), CVaR = −mean of k worst): r = −.05..+.14 step .01 (20 obs): α=.95 → .05/.05; α=.90 → .04/.045.
- `parametricVaR(mu, sigma, alpha)`, `parametricCVaR` (normal; CVaR = −(μ − σφ(z)/(1−α))): μ=.045, σ=.0591608 → 95%: .052311 / .077032. Include an accurate normal inverse CDF (Acklam) and pdf.
- `summary(returns, {k, rf})` → {cagr, vol, sharpe, sortino, maxDrawdown, calmar, var95, cvar95, best, worst, positivePct, n, years}.
benchmark.js
- `regress(portExcess, benchExcess)` → {alpha (per period), alphaAnnual = (1+α)^k − 1 and also arithmetic α·k, beta, r2}; x=[.01,.02,−.01,.03,0], y=[.02,.025,−.02,.05,0] → β 1.65, α −.0015, R² .972321.
- `blumeBeta(b)` = .67b + .33.
- `trackingError(active, k)` = sd(active)·√k; `informationRatio(active, k)` = mean·k / TE; a=[.01,−.005,.002,.003] weekly → TE .0442568, IR 2.93740.
- `treynor(portReturns, rf, beta, k)`, `jensenAlpha` (from regression on excess returns), `captureRatios(port, bench)` → {up, down}.
rates.js
- `cetesPerPeriod(annualYield, days, tenorDays=28)` = (1 + y·tenorDays/360)^(days/tenorDays) − 1; y=.11, days=7 → .0021321; effective annual (days=365) → .117455.
- `rfSeriesForDates(rfSeries:{dates, values}, targetDates, interval)` → per-period rf aligned to the return dates (use the yield in force at the START of each period; forward-fill yields only, max 45 days, else null).
risk.js
- `effectiveN(weights)` = 1/Σw²: [.5,.3,.2] → 2.631579. `hhi(weights)`.
- `riskContributions(weights, cov)` → {marginal, contribution, percent}; percent sums to 1.
- `exposureBy(positions, key)` (currency, sector, country) → [{key, value, weight}].
- `portfolioVol(weights, cov, k)`.
backtest.js
- `buyAndHold(pricePanel, initialWeights)` and `constantMix(returnPanel, weights, rebalanceEvery:"never"|"monthly"|"quarterly"|"annual"|periods)` → {values, returns, turnover}; A=[.1,−.1], B=[0,0], 50/50 start 1: constant-mix per period → .9975 final; buy-and-hold → .995.
- `withBenchmark(values, benchValues)` → active returns etc.
fx.js
- `toCurrency(amount, from, to, usdmxn)`; `pnlDecomposition({quantity, price0, price1, fx0, fx1})` → {total, priceEffect, fxEffect, cross:0} with price effect q(P1−P0)·X0 and FX effect q·P1·(X1−X0): q=10, P 150→180, X 17→19 → total 8,700 = 5,100 + 3,600.

## A2: linalg.js, covariance.js, expected.js, optimize.js, walkforward.js
linalg.js: matrix helpers (matmul, transpose, cholesky with jitter, symmetric eigen power iteration for λmax, solve via Cholesky), all small-n (n ≤ 40).
covariance.js
- `sampleCov(returnMatrix)` (n−1).
- `ledoitWolfConstantCorrelation(returnMatrix)` → {cov, shrinkage δ∈[0,1]}: matches PyPortfolioOpt `CovarianceShrinkage(...).ledoit_wolf(shrinkage_target="constant_correlation")` within 1e−10 on a fixed 60×5 panel (golden), PSD.
- `annualize(cov, k)`, `corrFromCov(cov)`.
expected.js
- `capmExpected(betas, rfAnnual, erp)` → μ_i = rf + β_i·ERP (default ERP from API assumptions; editable).
- `historicalMean(returnMatrix, k)` (flag as noisy), `jamesStein(means, cov, T)` shrink toward grand mean.
optimize.js (long-only, box constraints l ≤ w ≤ u, Σw = 1)
- `projectBoxSimplex(v, l, u)` → w = clip(v − θ, l, u) with θ by bisection; infeasible (Σl>1 or Σu<1) → throw `InfeasibleError` with Spanish message; v=[.5,.3,.2], u=.4 → [.4,.35,.25].
- `minVariance(cov, {l,u})`, `meanVariance(mu, cov, tau, {l,u})` via FISTA (step 1/λmax), `efficientFrontier(mu, cov, {points=30,l,u})`, `maxSharpe(mu, cov, rf, {l,u})` (frontier + golden-section refine), `riskParity(cov)` (cyclic coordinate descent, risk contributions equal within 1e−8).
- Known answers: min-var σ=(.2,.3), ρ=0 → w₁ .692308, σ_p .166410; ρ=.5 → w₁ .857143, σ_p .196396; tangency μ=(.10,.15), σ=(.2,.3), ρ=0, rf .05 → [.529412,.470588], Sharpe .416667; risk parity σ=(.2,.3), ρ=0 → [.6,.4]; n=2, u=.35 → InfeasibleError; 3-10 asset cases vs scipy SLSQP within 1e−6 (golden).
walkforward.js
- `walkForward(returnMatrix, dates, {estimationWindow=156, holdPeriods=13, method:"minVariance"|"maxSharpe"|"riskParity"|"equalWeight", ...})` → out-of-sample returns, weights history, summary. Never uses an index ≥ the first hold index for estimation (test with a spy strategy). Equal-weight OOS equals a direct computation.

## A3: rng.js, montecarlo.js, goals.js (+ optional montecarlo.worker.js)
rng.js: xoshiro128** seeded (seed from string hash), `uniform()`, `normal()` (Box-Muller with caching or ziggurat), deterministic sequences tested against known first outputs.
montecarlo.js
- `lognormalParams(m, s)` (arithmetic annual mean m, sd s) → σ_l² = ln(1 + s²/(1+m)²), μ_l = ln(1+m) − σ_l²/2; m=.08, s=.15 → μ_l .0674078, σ_l .138226.
- `simulate({ initial, contribution, contributionFrequency:"monthly"|"annual", contributionGrowth (inflation), years, stepsPerYear=12, mu (arith annual), sigma, inflation, paths=10000, seed, method:"lognormal"|"bootstrap", history?:returns, blockSize=6 })` → { percentiles: {p5,p25,p50,p75,p95} per step (nominal and real), terminal distribution summary, probabilityAbove(target), paths not returned by default }. Contributions at the start of each period: W_{t+1} = (W_t + C_t)·e^{ℓ_t}. σ=0 checks (construct so ℓ = ln 1.01 every month, 12 months, W0 100,000, C 5,000 at the start of each month): constant contributions → 176,729.14 at every percentile; contributions growing 1% per month (C_{t+1} = 1.01·C_t) → 180,292.00.
- Performance: 10k paths × 360 steps < 400 ms in node.
goals.js
- `probabilityOfGoal(sim, target, {real:true})`, `requiredContribution({target, years, initial, mu, sigma, inflation, probability=.5|.75|.9, seed})` (bisection on contribution), `retirementIncome(...)` (4% style withdrawal presented as a scenario, not advice).

## A4: ledger.js, performance-ledger.js, xirr.js, tax-mx.js, rebalance.js
ledger.js (replace S2's stub, same export `derivePositions`)
- Transaction types per storage schema: buy, sell, dividend, deposit, withdrawal, split, fee. Average-cost method (Mexican practice for ISR is "costo promedio de adquisición"). Fees added to cost on buys, subtracted from proceeds on sells. Splits multiply quantity and divide price. Cash balances per currency. Realized P&L per sell.
- `derivePositions(transactions, {asOf})` → [{ symbol, quantity, avgCost, currency, costBasis, realizedPnl, firstBuyDate|null, avgFx|null (MXN per USD at purchases, quantity-weighted; null if any lot lacks fx) }]; `cashBalances(transactions)`; `validateTransaction(tx)` (Spanish errors, e.g. selling more than held).
- Known: buy 10@100, buy 10@120, sell 5@130 → realized 100, remaining 15 @110; then split 2:1 → 30 @55.
performance-ledger.js
- `valueSeries(transactions, pricesBySymbolDate, fxByDate, baseCurrency="MXN")` → daily/weekly portfolio value with cash, and external flows (deposits/withdrawals; buys funded without prior deposit are treated as external contributions of the cost).
- `twr(values, flows)` chain-linked at each flow (flow at start of period): 100→110, +50 deposit, 160→144 → −.01.
xirr.js
- `xirr(cashflows:[{date, amount}])` Newton + bisection fallback, Actual/365; −1000 then +1100 after 365 days → .10; Microsoft XIRR doc example (−10000 on 2008-01-01, 2750 on 2008-03-01, 4250 2008-10-30, 3250 2009-02-15, 2750 2009-04-01) → .373362535.
tax-mx.js (label everything "estimación")
- `isrOnGains({ sales: [{ proceeds, cost, costDate, saleDate }], inpc: {[yyyy-mm]: index} })`: art. 129 LISR, 10% on the annual net gain from shares listed on BMV/SIC; cost updated by INPC(month before sale)/INPC(month of purchase) when inpc available; losses offset gains in the same year; → { gain, taxableGain, tax, lossCarry, notes }. Known: cost 550, factor 1.05, proceeds 650 → 7.25.
- Dividends: note 10% withholding on dividends from Mexican issuers (informational), no computation beyond amount×.10 helper.
rebalance.js
- `wholeShareRebalance({ holdings:{[s]: qty}, prices:{[s]: price}, targets:{[s]: weight}, cash, allowSell=true, minTrade=0 })` → { trades:[{symbol, side:"compra"|"venta", quantity, amount}], after:{weights, cash}, deviation }. Floor to whole shares, then greedily buy the share that most reduces Σ|w − target| while cash allows. Known: cash 10,000, empty holdings, targets 50/50, prices 300/700 → A 17, B 7, cash left 0.
- Output wording is neutral ("comprar"/"vender" as mechanical steps to reach YOUR target, not advice).

## A5: content/glossary.js + docs/metodologia/*.md
- `glossary` object keyed by slug (≥60 terms): { titulo, corto (≤160 chars), largo (2-4 short paragraphs), formula (plain text or simple notation), comoLeer, ejemplo, fuente/referencia (e.g. "Sharpe (1966)", "Ledoit y Wolf (2004)", "LISR art. 129"), relacionados:[slugs] }. Terms: rendimiento simple/logarítmico, CAGR, volatilidad, Sharpe, Sortino, drawdown máximo, Calmar, VaR, CVaR, beta, beta ajustada (Blume), alfa de Jensen, tracking error, information ratio, Treynor, correlación, covarianza, contracción Ledoit-Wolf, frontera eficiente, mínima varianza, portafolio tangente, paridad de riesgo, walk-forward, sobreajuste, Monte Carlo, lognormal, interés compuesto, inflación real vs nominal, TWR, MWR/XIRR, costo promedio, efecto precio vs efecto tipo de cambio, ISR por ganancia de capital, retención por dividendos, CETES, tasa objetivo Banxico, TIIE, UDI, INPC, bono M, curva de rendimientos, spread 10A-2A, VIX, DXY, P/U, P/VL, EV/EBITDA, FCF yield, earnings yield, ROE, ROIC, margen operativo, deuda/capital, fórmula mágica (Greenblatt), momentum 12-1, factor valor, factor calidad, baja volatilidad, FIBRA, FFO/AFFO, cap rate, NAV y P/NAV, LTV, rendimiento por distribución, DCF, WACC, CAPM, prima de riesgo de mercado, riesgo país, crecimiento terminal, múltiplos, SIC, BMV, diversificación, rebalanceo, horizonte de inversión, perfil de riesgo.
- Spanish (es-MX), accurate, plain; no em/en dashes; no advice. Also `glossarySearch(q)`.
- docs/metodologia/*.md: one page per tool (portafolio, riesgo, optimizador, backtest, simulador, screener de factores, fórmula mágica, FIBRAs, valuación DCF, fuentes de datos) explaining exact methods, assumptions and limitations; the Learn pages will render them.

## Backend known answers (B3b valuation and momentum, B3c screeners)

Recovered from the planning session on 22 September 2026 and re-derived here, because PLAN.md only
kept the results. Every B stream must test against these.

DCF, two stages, FCFF = EBIT(1−t) + D&A − capex − ΔNWC
- FCFF0 = 100, growth 10% for 5 years, terminal growth 3%, WACC 9%
  → stage-1 PV 513.93, terminal value discounted 1,796.87, enterprise value **2,310.80**.
- Hamada: β_U = .8, D/E = .5, t = .30 → **β_L = 1.08**.
- Re = rf + β_L·ERP + λ·CRP with rf 4.2%, ERP 4.5%, CRP 2.5%, λ = 1 → **11.56%**.
- WACC with E/V = 2/3, Rd = 7%, t = .30 → **9.34%**; converted to MXN with
  (1+WACC_USD)(1+π_MX)/(1+π_US) − 1, π_MX 3.5% and π_US 2.3% → **10.62%**.
- Guards: terminal growth ≤ rf of that currency and WACC − g ≥ 2 pp.
- Banks, justified P/B = (ROE − g)/(Re − g): ROE 15%, g 5%, Re 12% → **1.4286**.

Factors (B3c)
- Sector-relative robust z = (x − mediana)/(1.4826·MAD), winsorizado a ±3:
  [10, 12, 14, 16, 18] → **z(18) = 1.349**.
- Multiples are converted to yields first, so negative earnings score low instead of "cheap".
- A sector with n < 5 falls back to the whole universe and is flagged; coverage under 50% is
  excluded with a reason.

Magic formula (B3c)
- EY = EBIT/EV with EV = capitalización + deuda + interés minoritario + preferentes − efectivo.
- ROC = EBIT/(capital de trabajo neto sin efectivo ni deuda de corto plazo + PP&E neto).
- EY [.10, .08, .12] and ROC [.50, .30, .20] → order **1, 3, 2**.

Momentum 12-1 (B3b)
- P_{t−1m}/P_{t−12m} − 1 over month-end adjusted closes: 13 monthly prices → P₁₁/P₀ − 1, against a
  benchmark in the same currency.
