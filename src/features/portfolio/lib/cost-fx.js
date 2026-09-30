// Tipo de cambio de compra de cada posición en dólares, ponderado por lo que costó cada compra y
// no por cuántos títulos trajo, así que costo en dólares × este tipo de cambio es exactamente lo
// que se pagó en pesos (10 a 100 dólares con 17 y 10 a 200 con 20 costaron 57,000 pesos).
// Antes este archivo recorría el libro por su cuenta porque `avgFx` ponderaba por cantidad; desde
// que el libro pondera por costo, es una envoltura delgada sobre `derivePositionsDetailed` que
// conserva la firma para quien ya la usa.
import { derivePositionsDetailed } from '../../../lib/finance/ledger.js'

/**
 * @param {any[] | null | undefined} transactions
 * @returns {Map<string, number | null>} pesos por dólar por símbolo abierto en dólares; null si a
 *   alguna compra vigente le falta el tipo de cambio o el precio
 */
export function costWeightedFx(transactions) {
  /** @type {Map<string, number | null>} */
  const out = new Map()
  for (const position of derivePositionsDetailed(transactions)) {
    if (position.currency === 'USD') out.set(position.symbol, position.avgFx)
  }
  return out
}
