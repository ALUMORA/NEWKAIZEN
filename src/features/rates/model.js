// Lógica pura del centro de tasas (V5TS): parámetros de la URL, ejes de la curva, renglones de la
// tabla de mercado de dinero y textos. Sin React, con pruebas en model.test.js.
import { fmtDate, fmtNumber, fmtPct } from '../../lib/format.js'

/** @typedef {import('./types.js').RatesCountry} RatesCountry */
/** @typedef {import('./types.js').RatesTab} RatesTab */

export const COUNTRIES = /** @type {const} */ (['mx', 'us'])
export const TABS = /** @type {const} */ (['curvas', 'dinero', 'expectativas'])
export const COMPARE = /** @type {const} */ (['1m', '1y'])

/**
 * `?pais=us&pestana=dinero` a `{ country, tab }`; lo desconocido cae en México y Curvas.
 * @param {URLSearchParams} params
 * @returns {{ country: RatesCountry, tab: RatesTab }}
 */
export function readParams(params) {
  const pais = params.get('pais')
  const pestana = params.get('pestana')
  return {
    country: /** @type {RatesCountry} */ (COUNTRIES.includes(/** @type {any} */ (pais)) ? pais : 'mx'),
    tab: /** @type {RatesTab} */ (TABS.includes(/** @type {any} */ (pestana)) ? pestana : 'curvas'),
  }
}

/**
 * Los parámetros nuevos de la URL; los valores por omisión no se escriben.
 * @param {URLSearchParams} params
 * @param {{ country?: RatesCountry, tab?: RatesTab }} next
 */
export function writeParams(params, next) {
  const out = new URLSearchParams(params)
  if (next.country) {
    if (next.country === 'mx') out.delete('pais')
    else out.set('pais', next.country)
  }
  if (next.tab) {
    if (next.tab === 'curvas') out.delete('pestana')
    else out.set('pestana', next.tab)
  }
  return out
}

/** Plazo en años al vencimiento: 28 días son 0.077 años, 3650 días son 10. */
export function tenorYears(days) {
  return days / 365
}

/**
 * Etiqueta corta del eje x: '28 d' hasta un año y '10 a' de ahí en adelante.
 * @param {number} years
 */
export function tenorTick(years) {
  const days = Math.round(years * 365)
  if (days < 360) return `${days} d`
  return `${fmtNumber(Math.round(years * 10) / 10, { decimals: years >= 1 && Number.isInteger(Math.round(years * 10) / 10) ? 0 : 1 })} a`
}

/**
 * ¿Los nodos con dato tienen fechas distintas? En México cada plazo cambia en su subasta.
 * @param {{ value: number | null, asOf: string | null }[]} nodes
 */
export function hasMixedDates(nodes) {
  return new Set(nodes.filter((n) => n.value != null && n.asOf).map((n) => n.asOf)).size > 1
}

/**
 * Puntos de una serie de la curva. Con `isolated`, cada nodo queda solo (un hueco `null` entre dos
 * nodos), para que la gráfica los dibuje como puntos sin línea: no son del mismo día.
 * @param {{ tenorDays: number, value: number | null }[]} nodes
 * @param {{ isolated?: boolean }} [options]
 * @returns {{ x: number, value: number | null }[]}
 */
export function curvePoints(nodes, { isolated = false } = {}) {
  const sorted = [...nodes].sort((a, b) => a.tenorDays - b.tenorDays)
  /** @type {{ x: number, value: number | null }[]} */
  const out = []
  sorted.forEach((n, i) => {
    if (isolated && i > 0) out.push({ x: (tenorYears(sorted[i - 1].tenorDays) + tenorYears(n.tenorDays)) / 2, value: null })
    out.push({ x: tenorYears(n.tenorDays), value: n.value ?? null })
  })
  return out
}

/** Etiqueta de un plazo en días para tablas: '28 días', '1 año', '10 años'. */
export function tenorLabel(days) {
  if (days < 360) return `${days} días`
  const years = Math.round(days / 365)
  return years === 1 ? '1 año' : `${years} años`
}

/** Etiqueta de un tramo de forward: 'De 28 a 91 días' o 'De hoy a 28 días'. */
export function forwardLabel(fromDays, toDays) {
  return fromDays === 0 ? `De hoy a ${toDays} días` : `De ${fromDays} a ${toDays} días`
}

const CONVENTION_TEXT = {
  'act/360 simple': 'Simple act/360',
  overnight: 'A un día',
  'cmt base bono': 'Rendimiento cmt, base bono',
}

/** Texto de la convención de una tasa, en español. */
export function conventionText(convention) {
  return /** @type {Record<string, string>} */ (CONVENTION_TEXT)[convention] ?? convention ?? 's/d'
}

const MX_RATE_CONVENTION = {
  target: 'overnight',
  tiieFondeo: 'overnight',
  tiie28: 'act/360 simple',
  cetes28: 'act/360 simple',
  cetes91: 'act/360 simple',
  cetes182: 'act/360 simple',
  cetes364: 'act/360 simple',
  bonoM10: 'cmt base bono',
}

/**
 * Une /v2/rates/mx y /v2/money-market por id, sin repetir valores: México primero (tasas de
 * /v2/rates/mx con sus cambios semanal y mensual, luego la TIIE larga) y después EE. UU.
 * @param {{ items?: any[] } | undefined} ratesMx
 * @param {import('./types.js').MoneyMarketResponse | undefined} money
 * @returns {{ MX: import('./types.js').RateTableRow[], US: import('./types.js').RateTableRow[] }}
 */
export function moneyMarketRows(ratesMx, money) {
  const changes = new Map((money?.mxChanges ?? []).map((c) => [c.id, c]))
  /** @type {import('./types.js').RateTableRow[]} */
  const mx = (ratesMx?.items ?? [])
    .filter((it) => it.unit === 'fraction' && it.id in MX_RATE_CONVENTION)
    .map((it) => ({
      id: it.id,
      label: it.label,
      country: 'MX',
      value: it.value ?? null,
      convention: /** @type {Record<string, string>} */ (MX_RATE_CONVENTION)[it.id],
      asOf: it.asOf ?? null,
      change1dBp: it.changeBp ?? null,
      change1wBp: changes.get(it.id)?.change1wBp ?? null,
      change1mBp: changes.get(it.id)?.change1mBp ?? null,
      seriesId: it.seriesId,
    }))
  const rows = money?.rows ?? []
  const pick = (country) =>
    rows
      .filter((r) => r.country === country)
      .map((r) => ({ id: r.id, label: r.label, country: r.country, value: r.value, convention: r.convention, asOf: r.asOf, change1dBp: r.change1dBp, change1wBp: r.change1wBp, change1mBp: r.change1mBp, seriesId: r.seriesId }))
  return { MX: [...mx, ...pick('MX')], US: pick('US') }
}

/**
 * Valor de un renglón de la encuesta: fracción como porcentaje y tipo de cambio en pesos.
 * @param {number | null} value
 * @param {'fraction' | 'mxnPerUsd'} unit
 */
export function surveyValue(value, unit) {
  if (value == null) return 's/d'
  return unit === 'fraction' ? fmtPct(value) : `${fmtNumber(value, { decimals: 2 })} pesos`
}

/** Texto de dos fechas: 'Bono M al 27 ago 2026, Tesoro al 30 sep 2026'. */
export function twoDates(leftLabel, left, rightLabel, right) {
  return `${leftLabel} al ${left ? fmtDate(left) : 's/d'}, ${rightLabel} al ${right ? fmtDate(right) : 's/d'}`
}
