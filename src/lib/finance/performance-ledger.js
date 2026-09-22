// Desempeño del portafolio a partir del libro de movimientos: serie de valor (posiciones más
// efectivo) con sus flujos externos, y rendimiento ponderado en el tiempo (TWR) encadenado.
// Módulo puro: sin React, sin fetch y sin Date.now(); las fechas y los precios entran por
// parámetro.
//
// El TWR mide cómo se comportó la estrategia sin premiar ni castigar cuándo entró el dinero. El
// que sí depende de eso es el XIRR, que vive en xirr.js.

import { ledgerSnapshots } from './ledger.js'

/** @typedef {import('../storage.js').Transaction} Transaction */
/** @typedef {'MXN' | 'USD'} Currency */
/** @typedef {Record<string, Record<string, number>>} PriceTable precios por símbolo y por fecha */
/** @typedef {Record<string, number>} FxTable pesos por dólar, por fecha */

/**
 * @typedef {{
 *   dates: string[],
 *   values: (number | null)[],
 *   holdings: (number | null)[],
 *   cash: (number | null)[],
 *   flows: number[],
 *   currency: Currency,
 *   missing: { date: string, reason: string }[],
 * }} ValueSeries
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** @param {unknown} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
/** @param {unknown} v */
const isIsoDate = (v) => typeof v === 'string' && DATE_RE.test(v)

/**
 * Busca el valor vigente en una fecha dentro de un mapa {fecha: valor}: el de esa fecha o, si no
 * está, el más reciente anterior. Es arrastre hacia adelante solo para valuar posiciones; los
 * rendimientos nunca se calculan sobre precios rellenados, porque las fechas sin dato quedan
 * fuera de la serie.
 * @param {Record<string, number> | undefined} table
 * @param {string[]} sortedKeys
 * @param {string} date
 * @returns {number | null}
 */
function lastKnown(table, sortedKeys, date) {
  if (!table) return null
  const direct = table[date]
  if (isNum(direct)) return direct
  let best = null
  for (const key of sortedKeys) {
    if (key > date) break
    if (isNum(table[key])) best = table[key]
  }
  return best
}

/**
 * Factor para pasar un monto de una moneda a otra con el tipo de cambio pesos por dólar.
 * @param {Currency} from
 * @param {Currency} to
 * @param {number | null} usdmxn
 * @returns {number | null}
 */
function conversion(from, to, usdmxn) {
  if (from === to) return 1
  if (usdmxn === null || !(usdmxn > 0)) return null
  return from === 'USD' ? usdmxn : 1 / usdmxn
}

/**
 * Serie de valor del portafolio (posiciones más efectivo) en la moneda base, con los flujos
 * externos de cada periodo.
 *
 * Los flujos externos son los depósitos (positivos), los retiros (negativos) y el faltante de
 * efectivo de las compras que nadie financió con un depósito previo, que se toma como aportación.
 * `flows[i]` es lo que entró o salió entre `dates[i−1]` y `dates[i]`, inclusive; `flows[0]` junta
 * todo lo anterior o igual a la primera fecha, incluidos los saldos migrados sin fecha.
 *
 * Mínimo: una fecha. Sin fechas devuelve la serie vacía. Una fecha en la que falte el precio de
 * alguna posición o el tipo de cambio que hace falta sale con `values[i] = null` y con su motivo
 * en `missing`; nunca se inventa un precio.
 *
 * @param {Transaction[] | undefined | null} transactions
 * @param {PriceTable} pricesBySymbolDate precios por símbolo y fecha, en la moneda del símbolo
 * @param {FxTable} [fxByDate] pesos por dólar por fecha; solo hace falta si hay dos monedas
 * @param {Currency} [baseCurrency]
 * @param {{ dates?: string[] }} [options] fechas de la serie; por omisión, todas las de los precios
 * @returns {ValueSeries}
 */
export function valueSeries(
  transactions,
  pricesBySymbolDate,
  fxByDate = {},
  baseCurrency = 'MXN',
  options = {},
) {
  const prices = pricesBySymbolDate && typeof pricesBySymbolDate === 'object' ? pricesBySymbolDate : {}
  const fx = fxByDate && typeof fxByDate === 'object' ? fxByDate : {}
  const base = baseCurrency === 'USD' ? 'USD' : 'MXN'

  /** @type {string[]} */
  let dates
  if (Array.isArray(options.dates)) {
    dates = [...new Set(options.dates.filter(isIsoDate))].sort()
  } else {
    const set = new Set()
    for (const table of Object.values(prices)) for (const key of Object.keys(table ?? {})) set.add(key)
    if (set.size === 0) for (const key of Object.keys(fx)) set.add(key)
    dates = [...set].filter(isIsoDate).sort()
  }

  /** @type {ValueSeries} */
  const series = { dates, values: [], holdings: [], cash: [], flows: [], currency: base, missing: [] }
  if (dates.length === 0) return series

  /** @type {Record<string, string[]>} */
  const priceKeys = {}
  for (const [symbol, table] of Object.entries(prices)) {
    priceKeys[symbol] = Object.keys(table ?? {}).filter(isIsoDate).sort()
  }
  const fxKeys = Object.keys(fx).filter(isIsoDate).sort()

  const snapshots = ledgerSnapshots(transactions, dates)

  for (const snapshot of snapshots) {
    const date = snapshot.date
    const rate = lastKnown(fx, fxKeys, date)

    let holdings = 0
    /** @type {string | null} */
    let failure = null
    for (const position of snapshot.positions) {
      const price = lastKnown(prices[position.symbol], priceKeys[position.symbol] ?? [], date)
      if (price === null) {
        failure = failure ?? `Falta el precio de ${position.symbol}.`
        continue
      }
      const factor = conversion(position.currency, base, rate)
      if (factor === null) {
        failure = failure ?? `Falta el tipo de cambio para valuar ${position.symbol}.`
        continue
      }
      holdings += position.quantity * price * factor
    }

    let cash = 0
    for (const currency of /** @type {Currency[]} */ (['MXN', 'USD'])) {
      const amount = snapshot.fundedCash[currency]
      if (!amount) continue
      const factor = conversion(currency, base, rate)
      if (factor === null) {
        failure = failure ?? `Falta el tipo de cambio para convertir el efectivo en ${currency}.`
        continue
      }
      cash += amount * factor
    }

    let flow = 0
    for (const item of snapshot.external) {
      const flowRate = isIsoDate(item.date) ? lastKnown(fx, fxKeys, /** @type {string} */ (item.date)) : rate
      const factor = conversion(item.currency, base, flowRate ?? rate)
      if (factor === null) {
        failure = failure ?? `Falta el tipo de cambio para convertir un movimiento en ${item.currency}.`
        continue
      }
      flow += item.amount * factor
    }

    if (failure !== null) series.missing.push({ date, reason: failure })
    series.holdings.push(failure === null ? holdings : null)
    series.cash.push(failure === null ? cash : null)
    series.values.push(failure === null ? holdings + cash : null)
    series.flows.push(flow)
  }

  return series
}

/**
 * Rendimientos por subperiodo del TWR encadenado. El flujo de `flows[i]` se considera al inicio
 * del periodo i, así que r_i = values[i] / (values[i−1] + flows[i]) − 1.
 *
 * Los periodos cuyos extremos no se pudieron valuar (null) se saltan y su flujo se acumula al
 * siguiente periodo válido, para no perder el dinero que entró en medio. Un periodo cuya base
 * queda en cero o negativa también se salta: ahí el rendimiento porcentual no está definido.
 *
 * Mínimo: 2 valores. Devuelve null si no alcanza o si no quedó ningún subperiodo utilizable.
 * @param {(number | null)[]} values
 * @param {number[]} [flows] mismo largo que `values`; `flows[0]` no se usa
 * @returns {number[] | null}
 */
export function twrReturns(values, flows = []) {
  if (!Array.isArray(values) || values.length < 2) return null
  /** @type {number[]} */
  const out = []
  let pending = 0
  let previous = isNum(values[0]) ? /** @type {number} */ (values[0]) : null
  for (let i = 1; i < values.length; i += 1) {
    const flow = isNum(flows[i]) ? /** @type {number} */ (flows[i]) : 0
    pending += flow
    const current = isNum(values[i]) ? /** @type {number} */ (values[i]) : null
    if (previous === null || current === null) {
      if (current !== null) previous = current
      continue
    }
    const start = previous + pending
    if (!(start > 0)) {
      previous = current
      continue
    }
    out.push(current / start - 1)
    pending = 0
    previous = current
  }
  return out.length > 0 ? out : null
}

/**
 * Rendimiento ponderado en el tiempo (TWR) de toda la serie, encadenando los subperiodos.
 * Mínimo: 2 valores utilizables. Devuelve null si no alcanza.
 * @param {(number | null)[]} values
 * @param {number[]} [flows]
 * @returns {number | null}
 */
export function twr(values, flows = []) {
  const returns = twrReturns(values, flows)
  if (returns === null) return null
  let growth = 1
  for (const r of returns) growth *= 1 + r
  return growth - 1
}

/**
 * Pasa un rendimiento acumulado a tasa anual equivalente.
 * Mínimo: `years > 0` y un rendimiento mayor que −100 %. Devuelve null si no.
 * @param {number | null} total rendimiento acumulado como fracción
 * @param {number} years años del periodo
 * @returns {number | null}
 */
export function annualizeReturn(total, years) {
  if (!isNum(total) || !isNum(years) || years <= 0) return null
  const growth = 1 + /** @type {number} */ (total)
  if (growth <= 0) return null
  return growth ** (1 / years) - 1
}

/**
 * Años entre dos fechas con la misma convención Actual/365 del XIRR, para que el TWR anualizado y
 * el XIRR sean comparables. Devuelve null si alguna fecha no es AAAA-MM-DD.
 * @param {string} from
 * @param {string} to
 * @returns {number | null}
 */
export function yearsBetween(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return null
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return (b - a) / 86_400_000 / 365
}
