// Lógica pura del buscador de claves del comparador y de la lista propia del screener: el
// SearchCombobox elige emisoras por nombre y cada una queda como ficha que se quita con un botón.
// Cuando no hay búsqueda (servidor viejo o caído) sigue sirviendo escribir las claves separadas por
// coma y presionar Enter, como antes. Sin React.
import { isTickerLike, matchSymbol } from '../../app/shell/palette-model.js'
import { parseSymbols } from './symbols.js'

/**
 * Suma claves a la lista sin repetir y sin pasar del tope.
 * @param {readonly string[]} current
 * @param {readonly string[]} incoming
 * @param {number} max
 * @returns {{ next: string[], repeated: string[], overflow: string[] }}
 */
export function addSymbols(current, incoming, max) {
  const next = [...current]
  /** @type {string[]} */
  const repeated = []
  /** @type {string[]} */
  const overflow = []
  for (const raw of incoming) {
    const s = String(raw ?? '').trim().toUpperCase()
    if (!s) continue
    if (next.includes(s)) repeated.push(s)
    else if (next.length >= max) overflow.push(s)
    else next.push(s)
  }
  return { next, repeated, overflow }
}

/**
 * Quita la ficha `index` y dice a cuál pasa el foco: a la que quedó en su lugar, a la anterior si
 * era la última, o al campo (-1) si ya no queda ninguna.
 * @param {readonly string[]} list
 * @param {number} index
 */
export function removeSymbolAt(list, index) {
  const next = list.filter((_, i) => i !== index)
  return { next, focus: next.length ? Math.min(index, next.length - 1) : -1 }
}

/**
 * Qué hacer con Enter en el campo.
 * - Vacío: nada (`handled: false`), así el Enter envía el formulario.
 * - Con una opción activa y sin comas: la elige el combobox.
 * - Con comas, o sin búsqueda disponible: lo escrito son claves.
 * - Con búsqueda: una clave tecleada se resuelve contra los resultados ("WALMEX" → "WALMEX.MX"); algo
 *   que parece clave se toma tal cual, y un nombre sin resultado se avisa en vez de volverse clave.
 * - Con búsqueda todavía en camino (`searching`), los resultados son de otro texto: se pide buscar
 *   primero (`lookup`) y volver a llamar con lo que llegue, para no tomar "WALMEX" sin su .MX.
 * @param {{ q: string, activeOption: { symbol?: unknown } | null, searching?: boolean, available: boolean,
 *   results: { symbol: string }[] }} input
 * @returns {{ handled: boolean, add: string[], message: string, lookup?: string }}
 */
export function resolveEnter({ q, activeOption, searching = false, available, results }) {
  const text = String(q ?? '').trim()
  if (!text) return { handled: false, add: [], message: '' }
  const list = text.includes(',')
  if (activeOption && !list) return { handled: false, add: [], message: '' }
  if (available && !list && searching) return { handled: true, add: [], message: '', lookup: text }
  if (available && !list) {
    const found = matchSymbol(text, results)
    if (found) return { handled: true, add: [found], message: '' }
    if (!isTickerLike(text)) {
      return { handled: true, add: [], message: `No encontramos “${text}”. Elige una emisora de la lista o escribe su clave exacta.` }
    }
  }
  const add = parseSymbols(text)
  if (!add.length) return { handled: true, add, message: 'Escribe claves válidas separadas por coma, por ejemplo WALMEX.MX, AAPL.' }
  return { handled: true, add, message: '' }
}
