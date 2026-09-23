// Selección de emisoras del optimizador y del backtest: claves válidas, sin repetidos y con tope.
// La lista vive en la URL (?symbols=A,B) para que recargar o compartir conserve la selección.
const SYMBOL_RE = /^[A-Za-z0-9.\-^=$]{1,20}$/

/** "aapl, msft,,walmex.mx" → ["AAPL", "MSFT", "WALMEX.MX"]. @param {string | null | undefined} text */
export function parseSymbols(text) {
  /** @type {string[]} */
  const out = []
  for (const raw of String(text ?? '').split(/[,\s]+/)) {
    const s = raw.trim().toUpperCase()
    if (s && SYMBOL_RE.test(s) && !out.includes(s)) out.push(s)
  }
  return out
}

/** @param {string} text */
export function isValidSymbol(text) {
  return SYMBOL_RE.test(String(text ?? '').trim())
}

/**
 * Agrega una clave si es válida, no está repetida y cabe.
 * @param {string[]} list
 * @param {string} symbol
 * @param {number} max
 * @returns {{ list: string[], error: string | null }}
 */
export function addSymbol(list, symbol, max) {
  const s = String(symbol ?? '').trim().toUpperCase()
  if (!isValidSymbol(s)) return { list, error: 'Escribe una clave válida, por ejemplo WALMEX.MX o AAPL.' }
  if (list.includes(s)) return { list, error: `${s} ya está en la lista.` }
  if (list.length >= max) return { list, error: `Caben hasta ${max} emisoras.` }
  return { list: [...list, s], error: null }
}

/**
 * Pesos parejos en porcentaje, con dos decimales y el residuo en el primero para que sumen 100.
 * @param {string[]} symbols
 * @returns {Record<string, number>}
 */
export function equalPercents(symbols) {
  if (symbols.length === 0) return {}
  const each = Math.floor((100 / symbols.length) * 100) / 100
  const rest = Math.round((100 - each * symbols.length) * 100) / 100
  return Object.fromEntries(symbols.map((s, i) => [s, i === 0 ? Math.round((each + rest) * 100) / 100 : each]))
}
