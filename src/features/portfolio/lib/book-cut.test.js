import { describe, expect, it } from 'vitest'
import { cutAt } from './book-cut.js'

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
