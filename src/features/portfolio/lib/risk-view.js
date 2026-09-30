// Cálculos de /portafolio/riesgo: medidas sobre precios semanales en pesos de /v2/panel con los
// pesos de hoy, betas contra las referencias de docs/metodologia/riesgo.md y concentración por
// sector con el `sectorKey` de /v2/quotes. Módulo puro, sin React.
import { correlation, covariance, drawdowns, effectiveN, exposureBy, hhi, historicalCVaR, historicalVaR, simpleReturns, variance } from '../../../lib/finance/index.js'

/** IPC como rendimiento total: el ETF que replica el índice y sí reparte dividendos. */
export const BENCH_IPC = 'NAFTRAC.MX'
/** S&P 500 en pesos: SPY con cierre ajustado, convertido por el panel con ccy=MXN. */
export const BENCH_SPX = 'SPY'

/** Grupo de los fondos y ETF, que no traen sector: un ETF del IPC no es un sector. */
export const FUNDS_KEY = '__fondos__'
const FUND_TYPES = new Set(['fund', 'etf'])

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Símbolos del panel: las posiciones y las dos referencias, sin repetir (NAFTRAC.MX puede ser las
 * dos cosas).
 * @param {{ symbol: string }[]} positions
 * @returns {string[]}
 */
export function panelSymbols(positions) {
  return [...new Set([...positions.map((p) => p.symbol), BENCH_IPC, BENCH_SPX])]
}

/** @param {number[]} y @param {number[]} x */
function beta(y, x) {
  const v = variance(x)
  const c = covariance(y, x)
  return v && c != null ? c / v : null
}

/**
 * Riesgo del portafolio con los pesos de hoy. Solo cuentan las posiciones que tienen panel.
 * @param {{ symbol: string, quantity: number, currency?: string }[]} positions
 * @param {{ dates: string[], prices: Record<string, number[]> } | null | undefined} panel
 */
export function computeRisk(positions, panel) {
  if (!panel || panel.dates.length < 3) return null
  const held = positions.filter((p) => panel.prices[p.symbol]?.length)
  const last = (/** @type {string} */ s) => panel.prices[s][panel.prices[s].length - 1]
  const values = held.map((p) => p.quantity * last(p.symbol))
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  const weights = values.map((v) => v / total)
  const returns = held.map((p) => /** @type {number[]} */ (simpleReturns(panel.prices[p.symbol])))
  const n = returns[0]?.length ?? 0
  const port = Array.from({ length: n }, (_, t) => returns.reduce((acc, r, i) => acc + weights[i] * r[t], 0))
  let level = 1
  const path = [1, ...port.map((r) => (level *= 1 + r))]
  const ipc = panel.prices[BENCH_IPC] ? /** @type {number[]} */ (simpleReturns(panel.prices[BENCH_IPC])) : null
  const spx = panel.prices[BENCH_SPX] ? /** @type {number[]} */ (simpleReturns(panel.prices[BENCH_SPX])) : null
  const symbols = held.map((p) => p.symbol)
  return {
    maxDrawdown: drawdowns(path)?.maxDrawdown ?? null,
    var95: historicalVaR(port, 0.95),
    cvar95: historicalCVaR(port, 0.95),
    betaIpc: ipc ? beta(port, ipc) : null,
    betaSpx: spx ? beta(port, spx) : null,
    effectiveN: effectiveN(weights),
    usdShare: held.reduce((acc, p, i) => acc + (p.currency === 'USD' ? weights[i] : 0), 0),
    /** Valor en pesos de cada posición al último cierre: la base de los pesos, también por sector. */
    values: held.map((p, i) => ({ symbol: p.symbol, value: values[i] })),
    symbols,
    corr: symbols.map((_, i) => symbols.map((__, j) => (i === j ? 1 : correlation(returns[i], returns[j])))),
    weeks: n,
  }
}

/**
 * @typedef {{
 *   key: string | null, label: string, kind: 'sector' | 'funds' | 'unknown',
 *   value: number, weight: number | null, symbols: string[],
 * }} SectorGroup
 */

/**
 * Concentración por sector. Agrupa por `sectorKey` (el crudo de Yahoo, que la traducción junta) y
 * muestra el `sector` en español que manda el API. Los fondos y ETF sin sector van juntos como
 * "Fondos y ETF"; lo demás sin sector queda en s/d. El HHI (Σ w²) y la N efectiva (1 / HHI) se
 * miden solo sobre lo que tiene sector, con los pesos reescalados, y `coverage` dice qué parte
 * del valor es: un fondo del IPC no es un sector y lo desconocido no se inventa.
 * @param {{ symbol: string, value: number }[]} values en pesos, los de computeRisk
 * @param {any[] | null | undefined} quotes QuotesResponse.quotes
 * @returns {{ groups: SectorGroup[], hhi: number | null, effectiveN: number | null, coverage: number } | null}
 */
export function sectorExposure(values, quotes) {
  if (!Array.isArray(quotes) || !Array.isArray(values) || values.length === 0) return null
  /** @type {Map<string, any>} */
  const bySymbol = new Map(quotes.map((q) => [q?.symbol, q]))
  /** @type {Map<string, string>} */
  const labels = new Map()
  const items = values.map(({ symbol, value }) => {
    const q = bySymbol.get(symbol)
    const key = typeof q?.sectorKey === 'string' && q.sectorKey ? q.sectorKey : null
    if (key) {
      if (!labels.has(key)) labels.set(key, typeof q.sector === 'string' && q.sector ? q.sector : key)
      return { symbol, value, group: key }
    }
    if (FUND_TYPES.has(q?.type)) return { symbol, value, group: FUNDS_KEY }
    return { symbol, value, group: null }
  })
  const exposure = exposureBy(items, 'group')
  if (!exposure) return null
  /** @type {SectorGroup[]} */
  const groups = exposure.map((g) => ({
    key: g.key,
    label: g.key === null ? 's/d' : g.key === FUNDS_KEY ? 'Fondos y ETF' : /** @type {string} */ (labels.get(g.key)),
    kind: g.key === null ? 'unknown' : g.key === FUNDS_KEY ? 'funds' : 'sector',
    value: g.value,
    weight: g.weight,
    symbols: items.filter((i) => i.group === g.key).map((i) => i.symbol),
  }))
  const sectors = groups.filter((g) => g.kind === 'sector' && isNum(g.weight))
  const coverage = sectors.reduce((a, g) => a + /** @type {number} */ (g.weight), 0)
  const scaled = sectors.map((g) => /** @type {number} */ (g.weight) / coverage)
  return { groups, hhi: coverage > 0 ? hhi(scaled) : null, effectiveN: coverage > 0 ? effectiveN(scaled) : null, coverage }
}
