import { describe, expect, it } from 'vitest'
import { derivePositionsDetailed } from '../../../lib/finance/ledger.js'
import { costWeightedFx } from './cost-fx.js'

const base = { fees: 0, currency: 'USD', fxRate: null, amount: null, ratio: null, price: null, quantity: null, symbol: 'AAPL', note: '' }
const tx = (/** @type {any} */ over) => ({ ...base, ...over })

describe('costWeightedFx', () => {
  it('pondera por costo: costo en dólares por este tipo de cambio es lo que se pagó en pesos', () => {
    const txs = [
      tx({ type: 'buy', date: '2026-01-02', quantity: 10, price: 100, fxRate: 17 }),
      tx({ type: 'buy', date: '2026-02-02', quantity: 10, price: 200, fxRate: 20 }),
    ]
    const [p] = derivePositionsDetailed(txs)
    const fx = /** @type {number} */ (costWeightedFx(txs).get('AAPL'))
    expect(p.costBasis * fx).toBeCloseTo(17000 + 40000, 9)
    // Lo que da avgFx, ponderado por cantidad: 1,500 pesos menos.
    expect(p.costBasis * /** @type {number} */ (p.avgFx)).toBeCloseTo(55500, 9)
  })

  it('una venta saca costo a promedio en las dos monedas, un split no cambia nada y al reabrir empieza de cero', () => {
    const txs = [
      tx({ type: 'buy', date: '2026-01-02', quantity: 10, price: 100, fxRate: 17, fees: 10 }),
      tx({ type: 'buy', date: '2026-02-02', quantity: 10, price: 200, fxRate: 20 }),
      tx({ type: 'sell', date: '2026-03-02', quantity: 5, price: 210 }),
      tx({ type: 'split', date: '2026-04-02', ratio: 2 }),
    ]
    expect(costWeightedFx(txs).get('AAPL')).toBeCloseTo((1010 * 17 + 2000 * 20) / 3010, 12)
    const reopened = [...txs, tx({ type: 'sell', date: '2026-05-02', quantity: 30, price: 1 }), tx({ type: 'buy', date: '2026-06-02', quantity: 1, price: 5, fxRate: 18 })]
    expect(costWeightedFx(reopened).get('AAPL')).toBe(18)
  })

  it('sin tipo de cambio en alguna compra vigente sale null; en pesos no aplica', () => {
    expect(costWeightedFx([tx({ type: 'buy', quantity: 1, price: 5, fxRate: 18 }), tx({ type: 'buy', quantity: 1, price: 5 })]).get('AAPL')).toBeNull()
    expect(costWeightedFx([tx({ type: 'buy', quantity: 1, price: 5, currency: 'MXN', symbol: 'W' })]).has('W')).toBe(false)
  })
})
