// Tipo de cambio y separación del resultado en efecto precio y efecto tipo de cambio.
//
// Reglas de la casa:
// - `usdmxn` siempre son PESOS POR DÓLAR (el FIX de Banxico, serie SF43718). Nunca al revés.
// - No hay respaldo fijo. Si no llega el tipo de cambio, estas funciones responden null y la
//   interfaz muestra "s/d". El 17.5 escondido del código viejo hacía que un portafolio en
//   dólares se viera bien o mal por una constante que nadie había revisado en meses.
// - Ninguna función de esta librería adivina la moneda de una serie: quien llama ya convirtió.
//
// Un inversionista mexicano con acciones de Estados Unidos gana o pierde por dos cosas a la vez:
// porque la acción se movió y porque el peso se movió. `pnlDecomposition` las separa. La
// convención es efecto precio a tipo de cambio INICIAL y efecto tipo de cambio a precio FINAL,
// así el término cruzado queda dentro del efecto cambiario y `cross` es 0 por construcción; los
// dos suman exactamente el resultado total.

import { EPS, daysBetween, isNum, numericArray, parseIsoDate } from './_util.js'

/** Monedas que maneja la app hoy. */
export const CURRENCIES = ['MXN', 'USD']

/** Días que se tolera un tipo de cambio sin actualizar antes de declararlo vencido. */
export const MAX_FX_STALE_DAYS = 7

/**
 * Convierte un monto entre pesos y dólares.
 * @param {number} amount monto en la moneda `from`
 * @param {string} from moneda de origen, 'MXN' o 'USD'
 * @param {string} to moneda destino, 'MXN' o 'USD'
 * @param {number} usdmxn pesos por dólar, positivo
 * @returns {number | null} null si alguna moneda no se reconoce o si el tipo de cambio falta o
 *   no es positivo. Con `from` igual a `to` devuelve el monto sin pedir tipo de cambio
 */
export function toCurrency(amount, from, to, usdmxn) {
  if (!isNum(amount)) return null
  if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to)) return null
  if (from === to) return amount
  if (!isNum(usdmxn) || usdmxn <= 0) return null
  return from === 'USD' ? amount * usdmxn : amount / usdmxn
}

/**
 * @typedef {{ total: number, priceEffect: number, fxEffect: number, cross: number }} PnlSplit
 */

/**
 * Separa el resultado de una posición en efecto precio y efecto tipo de cambio, en la moneda de
 * reporte. `priceEffect = q(P₁ − P₀)·X₀` y `fxEffect = q·P₁·(X₁ − X₀)`, y suman el total
 * `q·P₁·X₁ − q·P₀·X₀`.
 *
 * Para una posición que ya está en la moneda de reporte, pasar `fx0` y `fx1` en 1: el efecto
 * cambiario sale 0, que es lo correcto.
 *
 * @param {{ quantity: number, price0: number, price1: number, fx0: number, fx1: number }} position
 *   `price0` y `price1` en la moneda del instrumento, `fx0` y `fx1` en moneda de reporte por
 *   unidad de la moneda del instrumento (pesos por dólar para algo cotizado en dólares)
 * @returns {PnlSplit | null} null si algún dato falta o no es finito. `cross` es siempre 0 y está
 *   ahí para dejar claro que el término cruzado ya está dentro del efecto cambiario
 */
export function pnlDecomposition({ quantity, price0, price1, fx0, fx1 }) {
  if (!isNum(quantity) || !isNum(price0) || !isNum(price1) || !isNum(fx0) || !isNum(fx1)) return null
  const priceEffect = quantity * (price1 - price0) * fx0
  const fxEffect = quantity * price1 * (fx1 - fx0)
  return { total: priceEffect + fxEffect, priceEffect, fxEffect, cross: 0 }
}

/**
 * @typedef {{ dates: string[], values: number[] }} FxSeries
 */

/**
 * Tipo de cambio vigente en una fecha: la última publicación con fecha ≤ la pedida.
 * Banxico no publica FIX en fines de semana ni en días festivos, así que se arrastra el último,
 * pero solo hasta `maxStaleDays` días; más allá devuelve null en vez de usar uno viejo.
 * @param {FxSeries} fxSeries serie de pesos por dólar con su fecha
 * @param {string} date fecha ISO `YYYY-MM-DD`
 * @param {{ maxStaleDays?: number }} [options]
 * @returns {{ value: number, asOf: string, staleDays: number } | null}
 */
export function fxAt(fxSeries, date, { maxStaleDays = MAX_FX_STALE_DAYS } = {}) {
  if (!fxSeries || !Array.isArray(fxSeries.dates)) return null
  const values = numericArray(fxSeries.values)
  if (values === null || values.length !== fxSeries.dates.length) return null
  const targetMs = parseIsoDate(date)
  if (targetMs === null) return null
  let best = null
  for (let i = 0; i < fxSeries.dates.length; i++) {
    const ms = parseIsoDate(fxSeries.dates[i])
    if (ms === null || ms > targetMs) continue
    if (best === null || ms > best.ms) best = { ms, value: values[i], asOf: fxSeries.dates[i] }
  }
  if (best === null) return null
  const staleDays = daysBetween(best.asOf, date)
  if (staleDays === null || staleDays > maxStaleDays) return null
  return { value: best.value, asOf: best.asOf, staleDays }
}

/**
 * Convierte una serie de valores completa, con un tipo de cambio por fecha.
 * @param {number[]} values montos en la moneda `from`
 * @param {number[]} usdmxn pesos por dólar, uno por cada valor, mismo largo
 * @param {string} from moneda de origen
 * @param {string} to moneda destino
 * @returns {number[] | null} null si los largos no coinciden, si alguna moneda no se reconoce o
 *   si algún tipo de cambio falta o no es positivo
 */
export function convertSeries(values, usdmxn, from, to) {
  const v = numericArray(values, 1)
  if (v === null) return null
  if (from === to) return v
  const fx = numericArray(usdmxn, 1)
  if (fx === null || fx.length !== v.length) return null
  /** @type {number[]} */
  const out = new Array(v.length)
  for (let i = 0; i < v.length; i++) {
    const converted = toCurrency(v[i], from, to, fx[i])
    if (converted === null) return null
    out[i] = converted
  }
  return out
}

/**
 * Rendimiento de un periodo visto desde la moneda de reporte, a partir del rendimiento local y
 * del movimiento del tipo de cambio: (1 + r_local)(1 + r_fx) − 1.
 * @param {number} localReturn rendimiento en la moneda del instrumento
 * @param {number} fx0 tipo de cambio inicial, positivo
 * @param {number} fx1 tipo de cambio final, positivo
 * @returns {number | null}
 */
export function returnInBaseCurrency(localReturn, fx0, fx1) {
  if (!isNum(localReturn) || !isNum(fx0) || !isNum(fx1)) return null
  if (fx0 <= EPS || fx1 <= 0) return null
  return (1 + localReturn) * (fx1 / fx0) - 1
}
