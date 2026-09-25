import { describe, expect, it } from 'vitest'
import { wholeShareRebalance } from '../../../lib/finance/index.js'
import { planTransactions, rebalanceCash } from './rebalance-view.js'

const base = { fees: 0, currency: 'MXN', fxRate: null, amount: null, ratio: null, price: null, quantity: null, symbol: null, note: '' }
const tx = (/** @type {any} */ over) => ({ ...base, ...over })

describe('rebalanceCash', () => {
  it('un libro de solo compras no deja efectivo negativo, y el plan no pide vender para cubrirlo', () => {
    const txs = [
      tx({ type: 'buy', date: '2025-01-02', symbol: 'A', quantity: 100, price: 50 }),
      tx({ type: 'buy', date: '2025-01-02', symbol: 'B', quantity: 100, price: 50 }),
    ]
    const cash = rebalanceCash(txs, '2026-09-25')
    expect(cash).toEqual({ MXN: 0, USD: 0 })
    const plan = wholeShareRebalance({ holdings: { A: 100, B: 100 }, prices: { A: 60, B: 60 }, targets: { A: 0.5, B: 0.5 }, cash: cash.MXN })
    expect(plan?.trades).toEqual([])
  })

  it('con depósito cuenta lo que sobra y no toca movimientos futuros', () => {
    const txs = [
      tx({ type: 'deposit', date: '2025-01-01', amount: 10000 }),
      tx({ type: 'buy', date: '2025-01-02', symbol: 'A', quantity: 100, price: 60 }),
      tx({ type: 'deposit', date: '2027-01-01', amount: 5000 }),
    ]
    expect(rebalanceCash(txs, '2026-09-25')).toEqual({ MXN: 4000, USD: 0 })
  })
})

describe('planTransactions', () => {
  const makeId = (() => {
    let n = 0
    return () => `tx-${(n += 1)}`
  })()

  it('registra en la moneda del lote aunque la cotización venga en otra', () => {
    const { transactions, blocked } = planTransactions({
      trades: [
        { symbol: 'AAPL', side: 'compra', quantity: 2, price: 3600 },
        { symbol: 'MSFT', side: 'venta', quantity: 1, price: 8000 },
        { symbol: 'NEW', side: 'compra', quantity: 3, price: 200 },
      ],
      positions: [
        { symbol: 'AAPL', currency: 'MXN' },
        { symbol: 'MSFT', currency: 'USD' },
      ],
      quotes: { AAPL: { price: 200, currency: 'USD' }, MSFT: { price: 400, currency: 'MXN' }, NEW: { price: 10, currency: 'USD' } },
      usdRate: 20,
      date: '2026-09-25',
      makeId,
    })
    expect(blocked).toEqual([])
    expect(transactions[0]).toMatchObject({ symbol: 'AAPL', type: 'buy', currency: 'MXN', price: 3600, fxRate: null })
    expect(transactions[1]).toMatchObject({ symbol: 'MSFT', type: 'sell', currency: 'USD', price: 400, fxRate: 20 })
    expect(transactions[2]).toMatchObject({ symbol: 'NEW', currency: 'USD', price: 10, fxRate: 20 })
  })

  it('sin tipo de cambio no escribe lo que va en dólares', () => {
    const { transactions, blocked } = planTransactions({
      trades: [{ symbol: 'MSFT', side: 'compra', quantity: 1, price: 8000 }],
      positions: [{ symbol: 'MSFT', currency: 'USD' }],
      quotes: { MSFT: { price: 8000, currency: 'MXN' } },
      usdRate: null,
      date: '2026-09-25',
      makeId,
    })
    expect(transactions).toEqual([])
    expect(blocked).toEqual(['MSFT'])
  })
})
