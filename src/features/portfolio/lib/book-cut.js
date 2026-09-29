// Corte del libro en una fecha: lo que tiene fecha posterior todavía no cuenta en ninguna página de
// Mi portafolio, ni en posiciones ni en efectivo ni en rendimiento. Un movimiento sin fecha (saldo
// migrado) sí cuenta, igual que en orderTransactions de src/lib/finance/ledger.js. Cada página que
// corta el libro lo dice con futureNotice, para que nada desaparezca sin explicación.
import { fmtNumber } from '../../../lib/format.js'

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

/**
 * Aviso de los movimientos con fecha futura que el corte deja fuera, con su concordancia.
 * @param {number} count lo que devuelve cutAt en `future`
 * @param {string} where a dónde entran, por ejemplo 'al resumen' o 'al plan'
 * @returns {string | null}
 */
export function futureNotice(count, where) {
  if (!(count > 0)) return null
  const n = fmtNumber(count, { decimals: 0 })
  return count === 1
    ? `${n} movimiento con fecha futura todavía no cuenta: entra ${where} el día de su fecha.`
    : `${n} movimientos con fecha futura todavía no cuentan: entran ${where} el día de su fecha.`
}
