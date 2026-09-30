import { describe, expect, it } from 'vitest'
import { cutAt, futureNotice } from './book-cut.js'

describe('cutAt', () => {
  it('deja fuera lo que tiene fecha posterior al corte y cuenta cuántos son', () => {
    const txs = [{ date: '2026-09-01' }, { date: '2026-09-22' }, { date: '2026-09-23' }, { date: null }, {}]
    const { current, future } = cutAt(txs, '2026-09-22')
    // Sin fecha (saldo migrado) cuenta, como en orderTransactions del libro.
    expect(current).toEqual([{ date: '2026-09-01' }, { date: '2026-09-22' }, { date: null }, {}])
    expect(future).toBe(1)
  })

  it('sin libro no falla', () => {
    expect(cutAt(undefined, '2026-09-22')).toEqual({ current: [], future: 0 })
  })
})

describe('futureNotice', () => {
  it('dice cuántos movimientos con fecha futura faltan y dónde entran, con concordancia', () => {
    expect(futureNotice(1, 'al resumen')).toBe('1 movimiento con fecha futura todavía no cuenta: entra al resumen el día de su fecha.')
    expect(futureNotice(3, 'al plan')).toBe('3 movimientos con fecha futura todavía no cuentan: entran al plan el día de su fecha.')
  })

  it('sin movimientos futuros no hay aviso', () => {
    expect(futureNotice(0, 'al resumen')).toBeNull()
  })
})
