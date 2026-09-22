// Tasa libre de riesgo y conversiones de tasas.
//
// La rf de un inversionista mexicano son los CETES a 28 días, no el bono M a 10 años que usaba
// el código viejo: el bono a 10 años trae prima por plazo y no es "libre de riesgo" para nadie
// que mida su desempeño semana a semana. Y es una SERIE con fecha, no un 8.6 % fijo.
//
// Los CETES se cotizan a descuento con base de 360 días. Convertir su tasa anual a un rendimiento
// por periodo es capitalizar el rendimiento del plazo: (1 + y·plazo/360)^(días/plazo) − 1.

import { daysBetween, isNum, numericArray, parseIsoDate } from './_util.js'
import { periodsPerYear } from './returns.js'

/** Días hábiles bancarios que se toleran sin dato nuevo antes de declarar la tasa vencida. */
export const MAX_STALE_DAYS = 45

/**
 * Rendimiento de CETES por un tramo de `days` días, capitalizando el rendimiento del plazo.
 * @param {number} annualYield tasa anual como fracción (.11 es 11 %)
 * @param {number} days días del periodo, positivo
 * @param {number} [tenorDays] plazo del instrumento, 28 por omisión
 * @returns {number | null} null si los argumentos no son números finitos, si los días no son
 *   positivos o si la tasa implica un factor no positivo
 */
export function cetesPerPeriod(annualYield, days, tenorDays = 28) {
  if (!isNum(annualYield) || !isNum(days) || !isNum(tenorDays)) return null
  if (days <= 0 || tenorDays <= 0) return null
  const perTenor = 1 + (annualYield * tenorDays) / 360
  if (perTenor <= 0) return null
  return perTenor ** (days / tenorDays) - 1
}

/**
 * Tasa efectiva anual de unos CETES: lo que rinde reinvertir el plazo durante 365 días.
 * Con 11 % a 28 días da .117455, no .11: la diferencia es el interés compuesto.
 * @param {number} annualYield tasa anual como fracción
 * @param {number} [tenorDays] plazo, 28 por omisión
 * @returns {number | null}
 */
export function cetesEffectiveAnnual(annualYield, tenorDays = 28) {
  return cetesPerPeriod(annualYield, 365, tenorDays)
}

/**
 * Tasa anual efectiva repartida en k periodos: (1+r)^(1/k) − 1.
 * @param {number} annualRate tasa efectiva anual como fracción
 * @param {number} k periodos por año
 * @returns {number | null} null si el factor es no positivo o k no es positivo
 */
export function annualToPerPeriod(annualRate, k) {
  if (!isNum(annualRate) || !isNum(k) || k <= 0) return null
  if (1 + annualRate <= 0) return null
  return (1 + annualRate) ** (1 / k) - 1
}

/**
 * Cambio de una tasa en puntos base. El API v2 manda los cambios de tasas en pb, y un punto base
 * es una centésima de punto porcentual: de 8.00 % a 8.25 % son 25 pb.
 * @param {number} from tasa inicial como fracción
 * @param {number} to tasa final como fracción
 * @returns {number | null}
 */
export function changeInBp(from, to) {
  if (!isNum(from) || !isNum(to)) return null
  return (to - from) * 10000
}

/**
 * @typedef {{ dates: string[], values: number[] }} YieldSeries
 */

/**
 * Serie de rf POR PERIODO, alineada a las fechas de una serie de precios.
 *
 * Para cada periodo se usa la tasa vigente al INICIO (la última publicación con fecha ≤ la fecha
 * de arranque), nunca la del cierre: al principio del periodo es la única que ya se conocía.
 * Se rellenan hacia adelante solo las tasas, hasta `maxStaleDays` días; más allá el periodo queda
 * en null en vez de inventar una tasa vieja.
 *
 * @param {YieldSeries} rfSeries tasas ANUALES como fracción, con su fecha de publicación
 * @param {string[]} targetDates fechas ISO de la serie de precios, ascendentes; los periodos son
 *   los huecos entre ellas, así que la salida trae un elemento menos
 * @param {string} interval intervalo nominal ('1d', '1wk', '1mo'), usado solo como respaldo
 *   cuando dos fechas consecutivas no dejan calcular los días reales
 * @param {{ maxStaleDays?: number, tenorDays?: number }} [options]
 * @returns {(number | null)[] | null} largo `targetDates.length − 1`, con null en los periodos sin
 *   tasa vigente; null completo si las entradas no sirven. Ojo: `sharpe` y `sortino` piden una
 *   serie sin huecos, así que el llamador decide qué hacer con los nulos (recortar o mostrar s/d)
 */
export function rfSeriesForDates(rfSeries, targetDates, interval, { maxStaleDays = MAX_STALE_DAYS, tenorDays = 28 } = {}) {
  if (!rfSeries || !Array.isArray(rfSeries.dates) || !Array.isArray(targetDates) || targetDates.length < 2) return null
  const yields = numericArray(rfSeries.values)
  if (yields === null || yields.length !== rfSeries.dates.length) return null

  /** @type {{ ms: number, value: number }[]} */
  const points = []
  for (let i = 0; i < rfSeries.dates.length; i++) {
    const ms = parseIsoDate(rfSeries.dates[i])
    if (ms === null) return null
    points.push({ ms, value: yields[i] })
  }
  points.sort((a, b) => a.ms - b.ms)

  const fallbackDays = (() => {
    const k = periodsPerYear(interval)
    return k === null ? null : 365 / k
  })()

  /** @type {(number | null)[]} */
  const out = []
  for (let i = 0; i + 1 < targetDates.length; i++) {
    const startMs = parseIsoDate(targetDates[i])
    if (startMs === null) return null
    let inForce = null
    for (let j = 0; j < points.length; j++) {
      if (points[j].ms <= startMs) inForce = points[j]
      else break
    }
    if (inForce === null || (startMs - inForce.ms) / 86400000 > maxStaleDays) {
      out.push(null)
      continue
    }
    const gap = daysBetween(targetDates[i], targetDates[i + 1])
    const days = gap !== null && gap > 0 ? gap : fallbackDays
    if (days === null) return null
    out.push(cetesPerPeriod(inForce.value, days, tenorDays))
  }
  return out
}
