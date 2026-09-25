// Cálculos de /portafolio/rendimiento. Aquí solo se arma lo que la página pinta; las fórmulas
// son las de src/lib/finance (valueSeries, twr, xirr, positionPnl, isrOnGains), las mismas que
// describe docs/metodologia/portafolio.md. Módulo puro: la fecha de hoy entra por parámetro.
import { isrOnGains, twr, valueSeries, xirr } from '../../../lib/finance/index.js'
// Lo que el barril todavía no reexporta (docs/requests/F1.md, pedido 6).
import { annualizeReturn, twrReturns, yearsBetween } from '../../../lib/finance/performance-ledger.js'
import { derivePositionsDetailed, externalFlows, orderTransactions, positionPnl, realizedSales } from '../../../lib/finance/ledger.js'
import { signChanges } from '../../../lib/finance/xirr.js'
import { costWeightedFx } from './cost-fx.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
/** @param {unknown} v @returns {v is string} */
const isIso = (v) => typeof v === 'string' && DATE_RE.test(v)

/** Periodos de /v2/panel y cuántos días cubren, del más corto al más largo. */
const RANGES = /** @type {const} */ ([
  ['1mo', 31],
  ['3mo', 92],
  ['6mo', 183],
  ['1y', 366],
  ['2y', 731],
  ['5y', 1827],
  ['10y', 3653],
])
const DAILY = new Set(['1mo', '3mo', '6mo', '1y'])

/**
 * Periodo e intervalo que cubren desde el primer movimiento con fecha, con una semana de margen
 * para tener un cierre antes de la primera compra. Hasta un año, cierres diarios; más, semanales.
 * Sin movimientos con fecha (saldos migrados), el último año.
 * @param {any[]} transactions
 * @param {string} today AAAA-MM-DD
 * @returns {{ range: string, interval: '1d' | '1wk', first: string | null }}
 */
export function pickWindow(transactions, today) {
  const dated = (transactions ?? []).map((t) => t?.date).filter(isIso).sort()
  const first = dated[0] ?? null
  if (!first || !isIso(today)) return { range: '1y', interval: '1d', first }
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000 + 7
  const hit = RANGES.find(([, d]) => d >= days)
  const range = hit ? hit[0] : 'max'
  return { range, interval: DAILY.has(range) ? '1d' : '1wk', first }
}

/**
 * El libro en títulos de hoy. Los cierres de /v2/panel vienen ajustados por splits, así que una
 * compra de antes de un split se tiene que contar con la cantidad ya multiplicada (y el precio
 * dividido) para valuarse bien; si no, todo lo anterior al split vale la mitad. El costo total no
 * cambia. Los splits salen del libro y su comisión, si traía, queda como comisión suelta.
 * @param {any[]} transactions
 * @returns {any[]}
 */
export function splitAdjusted(transactions) {
  const ordered = orderTransactions(transactions)
  /** @type {Map<string, number>} */
  const factor = new Map()
  /** @type {any[]} */
  const out = []
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const tx = ordered[i]
    const f = factor.get(tx.symbol) ?? 1
    if (tx.type === 'split') {
      if (isNum(tx.ratio) && tx.ratio > 0) factor.set(tx.symbol, f * tx.ratio)
      if (isNum(tx.fees) && tx.fees > 0) out.push({ ...tx, type: 'fee', symbol: null, amount: tx.fees, fees: 0, ratio: null })
      continue
    }
    if ((tx.type === 'buy' || tx.type === 'sell') && f !== 1 && isNum(tx.quantity)) {
      out.push({ ...tx, quantity: tx.quantity * f, price: isNum(tx.price) ? tx.price / f : tx.price })
    } else out.push(tx)
  }
  return out.reverse()
}

/**
 * {fecha: valor} a partir de fechas y valores alineados.
 * @param {string[] | undefined} dates
 * @param {(number | null)[] | undefined} values
 * @returns {Record<string, number>}
 */
export function zipTable(dates, values) {
  /** @type {Record<string, number>} */
  const out = {}
  ;(dates ?? []).forEach((d, i) => {
    const v = values?.[i]
    if (isIso(d) && isNum(v)) out[d] = v
  })
  return out
}

/**
 * Precios en la moneda de cada emisora: los de pesos salen del panel con ccy=MXN y los de dólares
 * del panel con ccy=USD, que para ellos es su moneda original.
 * @param {{ dates: string[], prices: Record<string, (number | null)[]> } | undefined} panelMxn
 * @param {{ dates: string[], prices: Record<string, (number | null)[]> } | undefined} panelUsd
 * @param {Set<string>} usdSymbols
 * @returns {Record<string, Record<string, number>>}
 */
export function nativePriceTable(panelMxn, panelUsd, usdSymbols) {
  /** @type {Record<string, Record<string, number>>} */
  const out = {}
  for (const [symbol, values] of Object.entries(panelMxn?.prices ?? {})) {
    if (!usdSymbols.has(symbol)) out[symbol] = zipTable(panelMxn?.dates, values)
  }
  for (const [symbol, values] of Object.entries(panelUsd?.prices ?? {})) {
    if (usdSymbols.has(symbol)) out[symbol] = zipTable(panelUsd?.dates, values)
  }
  return out
}

/**
 * Valor vigente en una fecha: el de esa fecha o el último anterior.
 * @param {Record<string, number> | undefined} table
 * @param {string} date
 * @returns {number | null}
 */
export function lastKnown(table, date) {
  if (!table) return null
  if (isNum(table[date])) return table[date]
  let best = null
  let bestKey = ''
  for (const [key, value] of Object.entries(table)) {
    if (key <= date && key > bestKey && isNum(value)) {
      best = value
      bestKey = key
    }
  }
  return best
}

/**
 * Índice de crecimiento del TWR fecha por fecha (1 al inicio), con el mismo encadenado que
 * twrReturns: el último punto es 1 + twr(values, flows). Las fechas sin valuar salen null.
 * @param {(number | null)[]} values
 * @param {number[]} flows
 * @returns {(number | null)[]}
 */
export function twrIndex(values, flows) {
  /** @type {(number | null)[]} */
  const out = []
  let level = 1
  let pending = 0
  let previous = isNum(values[0]) ? values[0] : null
  out.push(previous === null ? null : 1)
  for (let i = 1; i < values.length; i += 1) {
    pending += isNum(flows[i]) ? flows[i] : 0
    const current = isNum(values[i]) ? values[i] : null
    if (previous === null || current === null || !(previous > 0)) {
      if (current !== null) {
        previous = current
        pending = 0
      }
      out.push(current === null ? null : level)
      continue
    }
    level *= (current - pending) / previous
    pending = 0
    previous = current
    out.push(level)
  }
  return out
}

/**
 * Índice del primer corte en o después de una fecha; sin fecha (saldo migrado), el primero.
 * @param {string[]} dates ordenadas
 * @param {unknown} date
 */
function cutIndex(dates, date) {
  if (!isIso(date)) return 0
  const i = dates.findIndex((d) => d >= date)
  return i
}

/**
 * Ajuste de flujos para medir el TWR con cierres ajustados. Cada compra o venta se toma al cierre
 * del corte en que cae: la diferencia entre el precio del movimiento y ese cierre entra como flujo,
 * no como rendimiento. Sin esto, cada compra de una emisora que paga dividendos se anotaba como
 * pérdida el mismo día, porque su cierre ajustado queda debajo del precio que de verdad se pagó, y
 * esa "pérdida" se cargaba contra lo que ya había; con compras frecuentes el TWR caía decenas de
 * puntos. La comisión sí queda como rendimiento: es un costo real.
 * @param {any[]} transactions
 * @param {Record<string, Record<string, number>>} prices en la moneda de cada emisora
 * @param {Record<string, number>} fx
 * @param {string[]} dates cortes de la serie, ordenados
 * @returns {number[]} ajuste por corte, del mismo largo que `dates`
 */
export function tradeGapFlows(transactions, prices, fx, dates) {
  const out = dates.map(() => 0)
  for (const tx of transactions ?? []) {
    if (tx?.type !== 'buy' && tx?.type !== 'sell') continue
    if (!isNum(tx.quantity) || !(tx.quantity > 0) || !isNum(tx.price)) continue
    const i = cutIndex(dates, tx.date)
    if (i < 0) continue
    const cut = dates[i]
    const close = lastKnown(prices[tx.symbol], cut)
    if (!isNum(close)) continue
    const usd = tx.currency === 'USD'
    const fxCut = usd ? lastKnown(fx, cut) : 1
    const fxTrade = usd ? (isNum(tx.fxRate) && tx.fxRate > 0 ? tx.fxRate : isIso(tx.date) ? lastKnown(fx, tx.date) : fxCut) : 1
    if (!isNum(fxCut) || !isNum(fxTrade)) continue
    const gap = tx.quantity * (close * fxCut - tx.price * fxTrade)
    out[i] += tx.type === 'buy' ? gap : -gap
  }
  return out
}

/**
 * Desempeño del portafolio en pesos entre el primer corte con valor y el último valuado.
 *
 * Los cierres de /v2/panel vienen ajustados por dividendos (rendimiento total). Por eso:
 * - El TWR se mide sobre el libro SIN los dividendos cobrados, que ya van dentro del precio como si
 *   se hubieran reinvertido, y con cada compra y venta tomada al cierre (tradeGapFlows).
 * - El valor, la ganancia y el XIRR son de dinero real: llevan el efectivo de los dividendos y, si
 *   el libro arranca dentro de la ventana, parten de lo que de verdad aportaste, no del primer
 *   cierre ajustado.
 * @param {{
 *   transactions: any[],
 *   prices: Record<string, Record<string, number>>,
 *   fx: Record<string, number>,
 *   dates: string[],
 *   benchmark?: Record<string, number> | null,
 * }} input
 */
export function computePerformance({ transactions, prices, fx, dates, benchmark = null }) {
  const series = valueSeries(transactions, prices, fx, 'MXN', { dates })
  const start = series.values.findIndex((v) => isNum(v) && v > 0)
  let end = -1
  for (let i = series.values.length - 1; i >= 0; i -= 1) {
    if (isNum(series.values[i])) {
      end = i
      break
    }
  }
  const base = { missing: series.missing, dates: series.dates }
  if (start < 0 || end <= start) return { ...base, ok: /** @type {const} */ (false) }

  const windowDates = series.dates.slice(start, end + 1)
  const values = series.values.slice(start, end + 1)
  const flows = series.flows.slice(start, end + 1)
  const endValue = /** @type {number} */ (values[values.length - 1])
  const first = windowDates[0]
  const last = windowDates[windowDates.length - 1]

  // Libro que arranca en ceros dentro de la ventana: todo movimiento con fecha y el corte anterior
  // en cero. Entonces el punto de partida es lo que de verdad entró, no el primer cierre ajustado.
  const fromZero = start > 0 && series.values[start - 1] === 0 && (transactions ?? []).every((t) => isIso(t?.date))
  const startValue = fromZero ? 0 : /** @type {number} */ (values[0])
  const netFlows = fromZero ? flows.reduce((a, b) => a + b, 0) : flows.slice(1).reduce((a, b) => a + b, 0)

  // TWR: sin dividendos cobrados y con los movimientos al cierre.
  const priced = (transactions ?? []).filter((t) => t?.type !== 'dividend')
  const twrSeries = valueSeries(priced, prices, fx, 'MXN', { dates })
  const gaps = tradeGapFlows(priced, prices, fx, series.dates)
  const twrValues = twrSeries.values.slice(start, end + 1)
  const twrFlows = twrSeries.flows.slice(start, end + 1).map((f, i) => f + gaps[start + i])
  const total = twr(twrValues, twrFlows)
  const years = yearsBetween(first, last) ?? 0
  const index = twrIndex(twrValues, twrFlows)

  // XIRR con dinero real: cada flujo externo con su fecha y, al final, el valor del último cierre.
  // Si el libro no arranca en ceros, el valor del primer corte cuenta como aportación ese día.
  const cashflows = fromZero ? [] : [{ date: first, amount: -startValue }]
  let unconverted = 0
  for (const flow of externalFlows(transactions)) {
    if (!isIso(flow.date) || flow.date > last) continue
    if (!fromZero && flow.date <= first) continue
    const rate = flow.currency === 'USD' ? (isNum(flow.fxRate) && flow.fxRate > 0 ? flow.fxRate : lastKnown(fx, flow.date)) : 1
    if (!isNum(rate)) {
      unconverted += 1
      continue
    }
    cashflows.push({ date: flow.date, amount: -flow.amount * rate })
  }
  cashflows.push({ date: last, amount: endValue })
  const irr = xirr(cashflows)

  /** @type {(number | null)[]} */
  let benchIndex = []
  let benchReturn = null
  const b0 = benchmark ? lastKnown(benchmark, first) : null
  if (benchmark && isNum(b0) && b0 > 0) {
    benchIndex = windowDates.map((d) => (isNum(benchmark[d]) ? benchmark[d] / b0 : null))
    const b1 = lastKnown(benchmark, last)
    benchReturn = isNum(b1) ? b1 / b0 - 1 : null
  }

  return {
    ...base,
    ok: /** @type {const} */ (true),
    windowDates,
    values,
    flows,
    index,
    benchIndex,
    benchReturn,
    startValue,
    endValue,
    netFlows,
    gain: endValue - startValue - netFlows,
    twr: total,
    periods: twrReturns(twrValues, twrFlows)?.length ?? 0,
    years,
    twrAnnual: years >= 1 ? annualizeReturn(total, years) : null,
    xirr: irr,
    xirrAmbiguous: signChanges(cashflows) > 1,
    unconverted,
    fromZero,
  }
}

/**
 * Resultado no realizado de cada posición abierta, partido en efecto precio y efecto tipo de
 * cambio con positionPnl. Las posiciones en pesos van con tipo de cambio 1 (todo es precio); las
 * de dólares necesitan el tipo de cambio de la compra y, si no lo traen, salen s/d.
 * @param {any[]} transactions
 * @param {Record<string, Record<string, number>>} prices en la moneda de cada emisora
 * @param {Record<string, number>} fx pesos por dólar por fecha
 * @param {string} date fecha de valuación
 */
export function pnlByPosition(transactions, prices, fx, date) {
  const fxNow = lastKnown(fx, date)
  const buyFx = costWeightedFx(transactions)
  const rows = derivePositionsDetailed(transactions).map((p) => {
    const usd = p.currency === 'USD'
    const price1 = lastKnown(prices[p.symbol], date)
    const fx1 = usd ? fxNow : 1
    const fx0 = usd ? (buyFx.get(p.symbol) ?? null) : 1
    const split = positionPnl({ quantity: p.quantity, price0: p.avgCost, price1, fx0, fx1 })
    return {
      symbol: p.symbol,
      currency: p.currency,
      quantity: p.quantity,
      avgCost: p.avgCost,
      price: price1,
      fx0: usd ? fx0 : null,
      fx1: usd ? fx1 : null,
      priceEffect: split?.priceEffect ?? null,
      fxEffect: split?.fxEffect ?? null,
      total: split?.total ?? null,
      value: isNum(price1) && isNum(fx1) ? p.quantity * price1 * fx1 : null,
    }
  })
  const complete = rows.filter((r) => isNum(r.total))
  const sum = (/** @type {'priceEffect' | 'fxEffect' | 'total'} */ k) => complete.reduce((a, r) => a + /** @type {number} */ (r[k]), 0)
  return {
    rows,
    priceEffect: complete.length ? sum('priceEffect') : null,
    fxEffect: complete.length ? sum('fxEffect') : null,
    total: complete.length ? sum('total') : null,
    incomplete: rows.length - complete.length,
  }
}

/**
 * ISR estimado por las ventas en pesos (LISR art. 129) con isrOnGains, sin INPC: el API todavía
 * no publica la serie mensual, así que el costo va sin actualizar y la ganancia sale por arriba.
 * Las ventas en dólares se quedan fuera porque, si fueron con una casa de bolsa del extranjero, su
 * tratamiento es otro.
 * @param {any[]} transactions
 */
export function isrView(transactions) {
  const sales = realizedSales(transactions)
  const mxn = sales.filter((s) => s.currency === 'MXN')
  const estimate = isrOnGains({
    sales: mxn.map((s) => ({ symbol: s.symbol, proceeds: s.proceeds, cost: s.cost, costDate: s.costDate, saleDate: s.saleDate })),
  })
  const dividends = (transactions ?? [])
    .filter((t) => t?.type === 'dividend' && t.currency !== 'USD' && isNum(t.amount))
    .reduce((a, t) => a + t.amount, 0)
  return {
    estimate,
    sales: sales.length,
    usdSales: sales.length - mxn.length,
    trimmed: sales.filter((s) => s.trimmed).length,
    dividendsMxn: dividends,
  }
}
