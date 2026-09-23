import { describe, expect, it } from 'vitest'
import { realizedSales } from '../../../lib/finance/ledger.js'
import { findOversells } from './oversells.js'

const buy = (id, date, symbol, quantity) => ({ id, type: 'buy', date, symbol, quantity, price: 10, currency: 'MXN', fees: 0 })
const sell = (id, date, symbol, quantity) => ({ id, type: 'sell', date, symbol, quantity, price: 12, currency: 'MXN', fees: 0 })

describe('findOversells', () => {
  it('sin ventas de más no reporta nada', () => {
    expect(findOversells([buy('a', '2026-01-02', 'X', 10), sell('b', '2026-02-01', 'X', 10)])).toEqual([])
  })

  it('una venta de más sale con lo que pedía y lo que había, igual que el recorte del libro', () => {
    const txs = [buy('a', '2026-01-02', 'X', 10), sell('b', '2026-02-01', 'X', 15)]
    expect(findOversells(txs)).toEqual([{ id: 'b', symbol: 'X', date: '2026-02-01', asked: 15, held: 10 }])
    const sales = realizedSales(txs)
    expect(sales[0]).toMatchObject({ quantity: 10, trimmed: true })
  })

  it('una venta sin títulos, que el libro ignora, también se reporta', () => {
    const txs = [sell('b', '2026-02-01', 'Y', 3)]
    expect(findOversells(txs)).toEqual([{ id: 'b', symbol: 'Y', date: '2026-02-01', asked: 3, held: 0 }])
    expect(realizedSales(txs)).toEqual([])
  })

  it('respeta el orden por fecha y los splits', () => {
    const txs = [
      sell('c', '2026-03-01', 'X', 20),
      buy('a', '2026-01-02', 'X', 10),
      { id: 's', type: 'split', date: '2026-02-01', symbol: 'X', ratio: 2, currency: 'MXN', fees: 0 },
    ]
    expect(findOversells(txs)).toEqual([])
    expect(findOversells([...txs, sell('d', '2026-03-02', 'X', 1)])).toEqual([{ id: 'd', symbol: 'X', date: '2026-03-02', asked: 1, held: 0 }])
  })
})
