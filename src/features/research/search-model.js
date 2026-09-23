// Lógica pura del buscador de /investigar: etiquetas del tipo de instrumento, qué emisora abre
// Enter y cómo se describe cada resultado. Los recientes se comparten con la paleta (⌘K).
import { isTickerLike, matchSymbol } from '../../app/shell/palette-model.js'

export const SEARCH_LIMIT = 20
export const SEARCH_MAX_LENGTH = 64
export const SEARCH_DEBOUNCE_MS = 250

const TYPE_LABELS = {
  equity: 'Acción',
  etf: 'ETF',
  fibra: 'FIBRA',
  index: 'Índice',
  fx: 'Divisa',
  crypto: 'Cripto',
  commodity: 'Materia prima',
  fund: 'Fondo',
}

/** @param {string | null | undefined} type */
export function typeLabel(type) {
  return (type && TYPE_LABELS[/** @type {keyof typeof TYPE_LABELS} */ (type)]) || 'Otro'
}

/** Textos de ejemplo para quien llega sin saber qué escribir. Llenan el campo, no abren nada. */
export const SEARCH_EXAMPLES = Object.freeze(['walmart', 'cemex', 'fibra', 'apple', 'naftrac'])

/**
 * La emisora que abre Enter: el símbolo que coincide con lo tecleado ("WALMEX" → WALMEX.MX), si no
 * el primer resultado, y si no hay resultados, lo tecleado cuando parece clave. null si no hay nada
 * que abrir.
 * @param {string} text
 * @param {{ symbol: string }[] | undefined} results
 * @returns {string | null}
 */
export function pickSymbol(text, results) {
  const q = String(text ?? '').trim()
  if (!q) return null
  const hit = matchSymbol(q, results)
  if (hit) return hit
  if (results?.length) return results[0].symbol
  return isTickerLike(q) ? q.toUpperCase() : null
}

/**
 * "BMV · MXN", "NASDAQ · USD" o "s/d" si no hay ni bolsa ni moneda.
 * @param {{ exchange?: string | null, currency?: string | null }} result
 */
export function marketLabel(result) {
  const parts = [result.exchange, result.currency].filter(Boolean)
  return parts.length ? parts.join(' · ') : 's/d'
}

/**
 * Texto de la región viva: lo que un lector de pantalla oye mientras se escribe.
 * @param {{ q: string, searching: boolean, count: number | null, failed?: boolean }} state
 */
export function statusText({ q, searching, count, failed = false }) {
  if (!q) return ''
  if (searching) return 'Buscando…'
  if (failed) return 'No pudimos buscar en este momento.'
  if (count == null) return ''
  if (count === 0) return `Sin resultados para “${q}”.`
  return `${count} ${count === 1 ? 'resultado' : 'resultados'} para “${q}”.`
}
