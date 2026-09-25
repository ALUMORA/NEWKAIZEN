// Utilidades puras de la página de FIBRAs (/screener/fibras). Las métricas las calcula el API
// (kaizen_api/domain/screeners/fibras.py); aquí se etiquetan y se reparten sus avisos.
import { parseSymbols } from './symbols.js'

/** Máximo de FIBRAs extra que acepta /v2/screeners/fibras?extra=. */
export const MAX_EXTRA = 20

/** La señal describe el precio contra el valor en libros; no es una recomendación. */
export const SIGNAL_LABEL = Object.freeze({
  descuento: 'Descuento',
  en_linea: 'En línea',
  prima: 'Prima',
  sin_datos: 'Sin NAV',
})

export const TYPE_LABEL = Object.freeze({
  propiedades: 'Propiedades',
  hipotecaria: 'Hipotecaria',
  energia: 'Energía',
  otro: 'Otro tipo',
})

/** Base del rendimiento de flujo: nunca se le llama FFO si no lo es. */
export const BASIS_LABEL = Object.freeze({
  ocf: 'flujo de operación',
  fcf: 'flujo libre',
  ffo_approx: 'FFO aproximado',
})

/**
 * "wALMEX, fibrapl14.mx" → ["WALMEX", "FIBRAPL14.MX"], sin repetidos y a lo más MAX_EXTRA.
 * @param {string | null | undefined} text
 */
export function parseExtra(text) {
  return parseSymbols(text).slice(0, MAX_EXTRA)
}

/**
 * De dónde salió la tasa del diferencial, según meta.source ("yahoo,computed,fred").
 * @param {string | null | undefined} source
 * @returns {'banxico' | 'fred' | null}
 */
export function rateSource(source) {
  const tokens = String(source ?? '').toLowerCase().split(',').map((t) => t.trim())
  if (tokens.some((t) => t === 'banxico' || t.startsWith('banxico_'))) return 'banxico'
  if (tokens.some((t) => t === 'fred' || t.startsWith('fred_'))) return 'fred'
  return null
}

/**
 * Cómo nombrar la tasa contra la que se mide el diferencial. Solo son "CETES 28 días" si vienen de
 * Banxico y el servidor no las marcó como respaldo; si no, es una tasa sustituta y se dice.
 * @param {{ source?: string | null, fallback?: boolean } | null | undefined} meta
 * @param {number | null | undefined} rate
 */
export function describeRate(meta, rate) {
  const source = rateSource(meta?.source)
  const missing = rate == null || !Number.isFinite(rate)
  const substitute = !missing && (Boolean(meta?.fallback) || source !== 'banxico')
  const sourceLabel = source === 'banxico' ? 'Banxico' : source === 'fred' ? 'FRED, serie de la OCDE' : 'sin indicar'
  let label = 'CETES 28 días'
  let against = 'CETES a 28 días'
  if (missing) {
    label = 'Tasa de referencia'
    against = 'la tasa de referencia'
  } else if (substitute) {
    label = 'Tasa sustituta de corto plazo'
    against = 'la tasa sustituta de corto plazo, que no son CETES de 28 días'
  }
  return { label, against, missing, substitute, source, sourceLabel }
}

// Frases de las notas de la tasa que escriben kaizen_api/domain/rates.py (get_rf_series) y
// kaizen_api/domain/screeners/fibras.py (NO_RATE). Si el backend cambia la redacción, fibras.test.js
// lo detecta con las mismas cadenas.
const RATE_NOTE_RE = /sustitut|token de Banxico|BANXICO_TOKEN|^Respaldo:|revisión humana|Banxico no (respondió|tiene datos)|El SIE no confirmó|tasa de CETES 28/i

/**
 * Separa las notas generales en las que explican la tasa de referencia y el resto.
 * @param {readonly string[]} notes
 */
export function splitRateNotes(notes) {
  const rate = []
  const rest = []
  for (const note of notes) (RATE_NOTE_RE.test(note) ? rate : rest).push(note)
  return { rate, rest }
}

/**
 * Datos de la gráfica de diferencial: de mayor a menor, las que no tienen dato al final.
 * @param {readonly { symbol: string, spreadVsCetes: number | null }[]} rows
 */
export function spreadBars(rows) {
  return [...rows]
    .map((r) => ({ label: r.symbol, value: Number.isFinite(r.spreadVsCetes) ? r.spreadVsCetes : null }))
    .sort((a, b) => Number(a.value == null) - Number(b.value == null) || (b.value ?? 0) - (a.value ?? 0) || a.label.localeCompare(b.label))
}

/** Métricas de la tabla que pueden salir como s/d, con el nombre que lleva su columna. */
export const METRIC_LABEL = Object.freeze({
  price: 'precio',
  pNav: 'P/NAV',
  distributionYield: 'distribución pagada',
  spreadVsCetes: 'diferencial',
  ltv: 'LTV',
  debtToMarketCap: 'deuda entre capitalización',
  capRate: 'cap rate',
  cashFlowYield: 'rendimiento de flujo',
})

/**
 * Nombres de las métricas que faltan en un renglón, en el orden de la tabla.
 * @param {Record<string, unknown>} row
 * @returns {string[]}
 */
export function missingFields(row) {
  return Object.entries(METRIC_LABEL)
    .filter(([key]) => !Number.isFinite(row?.[key]))
    .map(([, label]) => label)
}

/**
 * Fecha de la tasa de referencia según las notas del API ("la tasa de referencia, del 2026-08-01"
 * o "dato del 2026-08-01" en la nota de la tasa sustituta). No es la fecha de los precios.
 * @param {readonly string[] | null | undefined} notes
 * @returns {string | null}
 */
export function rateDate(notes) {
  for (const note of notes ?? []) {
    const m = /tasa de referencia, del (\d{4}-\d{2}-\d{2})/.exec(note) ?? (/sustituta/.test(note) ? /dato del (\d{4}-\d{2}-\d{2})/.exec(note) : null)
    if (m) return m[1]
  }
  return null
}
