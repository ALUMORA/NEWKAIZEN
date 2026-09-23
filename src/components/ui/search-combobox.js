// Lógica pura del SearchCombobox (C1): opciones a partir de /v2/search, id estable por emisora,
// movimiento con flechas y el texto de estado que se anuncia. Sin React ni fetch.

/** Espera entre la última tecla y la búsqueda en /v2/search. */
export const SEARCH_DEBOUNCE_MS = 200

/**
 * Resultado de /v2/search (kaizen_api/schemas.py).
 * @typedef {{ symbol: string, name?: string, exchange?: string | null, type?: string,
 *   currency?: string | null, aliases?: string[] }} SearchResult
 */

/**
 * Opción del combobox. `id` es único en toda la lista; lo demás lo usa quien la pinta o la elige.
 * @typedef {{ id: string, label: string, detail?: string, symbol?: string, result?: SearchResult,
 *   [key: string]: unknown }} ComboboxOption
 * @typedef {{ id: string, label: string, options: ComboboxOption[] }} ComboboxGroup
 */

/**
 * Id de opción para una emisora: "WALMEX.MX" → "sym-WALMEX_MX". Es el mismo que usa la paleta,
 * así que una emisora conserva su id aunque cambie de grupo.
 * @param {string} symbol
 */
export function symbolOptionId(symbol) {
  return `sym-${String(symbol ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/**
 * Opciones de emisora a partir de los resultados, sin repetidos y sin las de `exclude` (por
 * ejemplo, las que ya están en el comparador).
 * @param {SearchResult[] | null | undefined} results
 * @param {{ exclude?: readonly string[] }} [options]
 * @returns {ComboboxOption[]}
 */
export function resultOptions(results, { exclude = [] } = {}) {
  const skip = new Set(exclude.map((s) => String(s).toUpperCase()))
  const seen = new Set()
  /** @type {ComboboxOption[]} */
  const out = []
  for (const r of results ?? []) {
    if (!r || typeof r.symbol !== 'string' || !r.symbol.trim()) continue
    const key = r.symbol.toUpperCase()
    if (skip.has(key) || seen.has(key)) continue
    seen.add(key)
    const detail = [r.name, r.exchange].filter(Boolean).join(' · ')
    out.push({ id: symbolOptionId(r.symbol), label: r.symbol, detail: detail || undefined, symbol: r.symbol, result: r })
  }
  return out
}

/**
 * Grupos por omisión: uno solo, "Emisoras", o ninguno si no hay resultados.
 * @param {SearchResult[] | null | undefined} results
 * @param {{ exclude?: readonly string[] }} [options]
 * @returns {ComboboxGroup[]}
 */
export function defaultGroups(results, options) {
  const opts = resultOptions(results, options)
  return opts.length ? [{ id: 'emisoras', label: 'Emisoras', options: opts }] : []
}

/**
 * Siguiente opción activa. Las flechas dan la vuelta; sin opción activa (-1), abajo va a la
 * primera y arriba a la última.
 * @param {number} index activa actual, -1 si ninguna
 * @param {'ArrowDown' | 'ArrowUp' | 'Home' | 'End'} key
 * @param {number} total opciones
 * @returns {number} -1 si no hay opciones
 */
export function moveActive(index, key, total) {
  if (!total) return -1
  if (key === 'Home') return 0
  if (key === 'End') return total - 1
  if (index < 0) return key === 'ArrowDown' ? 0 : total - 1
  const step = key === 'ArrowDown' ? 1 : -1
  return (index + step + total) % total
}

/**
 * Texto de estado (región aria-live): qué pasa con la búsqueda, sin esconder un error ni que el
 * servidor no la ofrece.
 * @param {{ q: string, searching: boolean, error: boolean, available: boolean, total: number }} input
 * @returns {string}
 */
export function comboboxStatus({ q, searching, error, available, total }) {
  const text = String(q ?? '').trim()
  if (searching) return 'Buscando emisoras…'
  if (text && error && total === 0) return 'No se pudo buscar ahora. Intenta de nuevo en un momento.'
  if (text && !available && total === 0) return 'La búsqueda de emisoras no está disponible por ahora.'
  if (total === 0) return 'Sin resultados'
  return `${total} ${total === 1 ? 'resultado' : 'resultados'}`
}
