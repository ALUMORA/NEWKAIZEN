// Utilidades puras del comparador.
const SYMBOL_RE = /^[A-Za-z0-9.\-^=$]{1,20}$/

/** "aapl, msft,,walmex.mx" → ["AAPL", "MSFT", "WALMEX.MX"], sin repetidos ni claves inválidas. */
export function parseSymbols(text) {
  const out = []
  for (const raw of String(text ?? '').split(/[,\s]+/)) {
    const s = raw.trim().toUpperCase()
    if (s && SYMBOL_RE.test(s) && !out.includes(s)) out.push(s)
  }
  return out
}
