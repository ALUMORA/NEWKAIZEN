// Corte del libro en una fecha: lo que tiene fecha posterior todavía no cuenta en ninguna página de
// Mi portafolio, ni en posiciones ni en efectivo ni en rendimiento. Un movimiento sin fecha (saldo
// migrado) sí cuenta, igual que en orderTransactions de src/lib/finance/ledger.js.

/**
 * @param {any[] | null | undefined} transactions
 * @param {string} date AAAA-MM-DD, inclusive
 * @returns {{ current: any[], future: number }}
 */
export function cutAt(transactions, date) {
  const all = Array.isArray(transactions) ? transactions : []
  const current = all.filter((t) => !(typeof t?.date === 'string' && t.date > date))
  return { current, future: all.length - current.length }
}
