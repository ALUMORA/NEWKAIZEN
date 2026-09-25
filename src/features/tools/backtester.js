// Cálculo del backtest (/herramientas/backtest), sin React: comprar y mantener o mezcla constante
// sobre el panel semanal en pesos, contra un referente en la misma moneda y las mismas fechas.
// Todo sale de src/lib/finance; lo que dice docs/metodologia/backtest.md es lo que se calcula aquí.
import { annualTurnover, buyAndHold, constantMix, drawdowns, rfSeriesForDates, simpleReturns, summary, withBenchmark } from '../../lib/finance/index.js'
import { rfIsFallback, rfTenorDays } from './riskfree.js'

export const BT_PERIODS_PER_YEAR = 52
export const IPC_SYMBOL = 'NAFTRAC.MX'
export const SPX_SYMBOL = 'SPY'

export const BENCHMARKS = /** @type {const} */ ([
  { value: 'ipc', label: 'IPC', symbols: [IPC_SYMBOL] },
  { value: 'spx', label: 'S&P 500 en pesos', symbols: [SPX_SYMBOL] },
  { value: 'blend', label: 'Mezcla de los dos', symbols: [IPC_SYMBOL, SPX_SYMBOL] },
])

export const RANGES = /** @type {const} */ ([
  { value: '3y', label: '3 años' },
  { value: '5y', label: '5 años' },
  { value: '10y', label: '10 años' },
])

export const REBALANCE = /** @type {const} */ ([
  { value: 'weekly', label: 'Cada semana' },
  { value: 'monthly', label: 'Cada mes' },
  { value: 'quarterly', label: 'Cada trimestre' },
  { value: 'annual', label: 'Cada año' },
])

/** Nombre corto del referente, para encabezados de tabla. @param {string} id */
export function benchmarkShort(id) {
  if (id === 'spx') return 'S&P 500'
  if (id === 'blend') return 'Mezcla'
  return 'IPC'
}

/** Nombre del referente para la pantalla. @param {string} id @param {number} blendIpc */
export function benchmarkLabel(id, blendIpc) {
  if (id === 'spx') return 'S&P 500 en pesos'
  if (id === 'blend') return `Mezcla: ${Math.round(blendIpc * 100)} % IPC y ${Math.round((1 - blendIpc) * 100)} % S&P 500`
  return 'IPC'
}

/**
 * Pesos por valor de mercado de hoy (último precio del panel en pesos por cantidad).
 * @param {{ symbol: string, quantity: number }[]} positions
 * @param {Record<string, number[]>} prices
 * @returns {Record<string, number> | null}
 */
export function marketWeights(positions, prices) {
  const values = positions.map((p) => {
    const series = prices?.[p.symbol]
    const last = Array.isArray(series) ? series[series.length - 1] : null
    return last > 0 && p.quantity > 0 ? p.quantity * last : 0
  })
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  return Object.fromEntries(positions.flatMap((p, i) => (values[i] > 0 ? [[p.symbol, values[i] / total]] : [])))
}

/**
 * @param {{ dates: string[], prices: Record<string, number[]> }} panel
 * @param {Record<string, number>} weights
 * @param {'buyAndHold' | 'constantMix'} strategy
 * @param {'weekly' | 'monthly' | 'quarterly' | 'annual'} rebalance
 */
function runStrategy(panel, weights, strategy, rebalance) {
  const symbols = Object.keys(weights)
  if (strategy === 'buyAndHold') {
    return buyAndHold({ dates: panel.dates, values: Object.fromEntries(symbols.map((s) => [s, panel.prices[s]])) }, weights)
  }
  const values = Object.fromEntries(symbols.map((s) => [s, simpleReturns(panel.prices[s])]))
  return constantMix({ dates: panel.dates.slice(1), startDate: panel.dates[0], values }, weights, rebalance === 'weekly' ? 1 : rebalance)
}

/**
 * Trayectoria del referente: un índice solo se compra y se mantiene; la mezcla se rebalancea cada
 * mes, que es como se construyen los índices compuestos.
 * @param {{ dates: string[], prices: Record<string, number[]> }} panel
 * @param {'ipc' | 'spx' | 'blend'} id
 * @param {number} blendIpc fracción del IPC en la mezcla
 */
function runBenchmark(panel, id, blendIpc) {
  if (id === 'blend') return runStrategy(panel, { [IPC_SYMBOL]: blendIpc, [SPX_SYMBOL]: 1 - blendIpc }, 'constantMix', 'monthly')
  const symbol = id === 'spx' ? SPX_SYMBOL : IPC_SYMBOL
  return runStrategy(panel, { [symbol]: 1 }, 'buyAndHold', 'monthly')
}

/** @param {number[]} values @param {string[]} dates */
function drawdownInfo(values, dates) {
  const dd = drawdowns(values)
  if (!dd) return null
  const at = (/** @type {number | null} */ i) => (i === null || i === undefined ? null : dates[i] ?? null)
  return {
    maxDrawdown: dd.maxDrawdown,
    peak: at(dd.peakIndex),
    trough: at(dd.troughIndex),
    recovery: at(dd.recoveryIndex),
    points: dd.series.map((v, i) => ({ date: dates[i], value: v })),
  }
}

/**
 * Corre el backtest completo.
 * @param {{ dates: string[], prices: Record<string, number[]> } | null | undefined} panel
 * @param {{ weights: Record<string, number>, strategy: 'buyAndHold' | 'constantMix',
 *   rebalance: 'weekly' | 'monthly' | 'quarterly' | 'annual', benchmark: 'ipc' | 'spx' | 'blend',
 *   blendIpc: number, rfSeries?: { dates: string[], values: number[], tenorDays?: number, fallback?: boolean, meta?: any } | null }} options
 */
export function runBacktest(panel, { weights, strategy, rebalance, benchmark, blendIpc, rfSeries = null }) {
  if (!panel || !Array.isArray(panel.dates) || panel.dates.length < 3) return null
  const has = (/** @type {string} */ s) => Array.isArray(panel.prices?.[s]) && panel.prices[s].length === panel.dates.length
  const missing = Object.keys(weights).filter((s) => !has(s))
  const kept = Object.fromEntries(Object.entries(weights).filter(([s, w]) => has(s) && w > 0))
  const total = Object.values(kept).reduce((a, b) => a + b, 0)
  if (!(total > 0)) return { missing, error: 'Ninguna de las emisoras tiene historia en este periodo.' }
  const normalized = Object.fromEntries(Object.entries(kept).map(([s, w]) => [s, w / total]))
  const benchSymbols = BENCHMARKS.find((b) => b.value === benchmark)?.symbols ?? []
  if (!benchSymbols.every(has)) return { missing, error: 'No hay historia del referente en este periodo.' }

  const port = runStrategy(panel, normalized, strategy, rebalance)
  const bench = runBenchmark(panel, benchmark, blendIpc)
  if (!port || !bench) return { missing, error: 'No pudimos correr el backtest con estos precios.' }

  const k = BT_PERIODS_PER_YEAR
  const rfPer = rfSeries ? rfSeriesForDates(rfSeries, panel.dates, '1wk', { tenorDays: rfTenorDays(rfSeries) }) : null
  const rfComplete = Array.isArray(rfPer) && rfPer.every((v) => v !== null)
  const rf = rfComplete ? /** @type {number[]} */ (rfPer) : 0
  const dates = panel.dates
  return {
    missing,
    error: null,
    weights: normalized,
    rfComplete,
    rfFallback: rfIsFallback(rfSeries),
    start: dates[0],
    end: dates[dates.length - 1],
    periods: port.returns.length,
    portfolio: summary(port.returns, { k, rf }),
    benchmark: summary(bench.returns, { k, rf }),
    comparison: withBenchmark(port.values, bench.values, { k }),
    turnover: strategy === 'constantMix' ? { total: port.turnover, annual: annualTurnover(port.turnover, port.returns.length, k), rebalances: port.rebalances } : null,
    growth: {
      portfolio: port.values.map((v, i) => ({ date: dates[i], value: v })),
      benchmark: bench.values.map((v, i) => ({ date: dates[i], value: v })),
    },
    drawdown: { portfolio: drawdownInfo(port.values, dates), benchmark: drawdownInfo(bench.values, dates) },
  }
}
