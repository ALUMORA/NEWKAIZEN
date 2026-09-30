// Validación de la clave que se agrega a la lista de seguimiento escribiéndola (Enter o "Agregar"),
// sobre todo cuando la búsqueda no está disponible. Misma forma de clave que las herramientas.
const SYMBOL_RE = /^[A-Z0-9.\-^=$]{1,20}$/

/**
 * @param {readonly string[]} symbols las que ya están en la lista
 * @param {string} raw lo que se escribió
 * @returns {{ symbol: string | null, error: string | null }}
 */
export function checkNewSymbol(symbols, raw) {
  const symbol = String(raw ?? '').trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) return { symbol: null, error: 'Escribe una clave válida, por ejemplo WALMEX.MX o AAPL.' }
  if (symbols.some((s) => s.toUpperCase() === symbol)) return { symbol: null, error: `${symbol} ya está en tu lista.` }
  return { symbol, error: null }
}
