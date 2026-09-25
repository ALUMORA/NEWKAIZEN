import { describe, expect, it } from 'vitest'
import { summarize } from './summary-view.js'

const base = { fees: 0, currency: 'MXN', fxRate: null, amount: null, ratio: null, price: null, quantity: null, symbol: null, note: '' }
const tx = (/** @type {any} */ over) => ({ ...base, ...over })
const quote = (symbol, price, change, currency = 'MXN') => ({ symbol, name: symbol, price, change, changePct: change / (price - change), currency })

const TXS = [
  tx({ type: 'deposit', date: '2026-09-01', amount: 20000 }),
  tx({ type: 'buy', date: '2026-09-02', symbol: 'W', quantity: 100, price: 60 }),
  tx({ type: 'buy', date: '2026-09-10', symbol: 'W', quantity: 100, price: 70 }),
  tx({ type: 'buy', date: '2026-09-11', symbol: 'AAPL', quantity: 10, price: 150, currency: 'USD', fxRate: 17 }),
]

describe('summarize', () => {
  it('valúa en pesos, pesa contra el total con efectivo y separa el resultado', () => {
    const res = summarize({ transactions: TXS, quotes: [quote('W', 66, 1), quote('AAPL', 180, 3, 'USD')], usdmxn: 19, today: '2026-09-22' })
    const w = res.rows.find((r) => r.symbol === 'W')
    const a = res.rows.find((r) => r.symbol === 'AAPL')
    expect(w).toMatchObject({ value: 13200, pnl: 200, pnlMxn: 200 })
    expect(w?.pnlPct).toBeCloseTo(66 / 65 - 1, 12)
    // 10 a 150 dólares con 17, hoy 180 con 19: 34,200 pesos y 8,700 de resultado.
    expect(a).toMatchObject({ value: 34200, pnl: 300, pnlMxn: 8700, costMxn: 25500 })
    // Efectivo: 20,000 − 13,000; la compra en dólares se toma como aportación, no deja saldo.
    expect(res.cashMxn).toBe(7000)
    expect(res.total).toBe(13200 + 34200 + 7000)
    expect(w?.weight).toBeCloseTo(13200 / 54400, 12)
    expect(res.unrealized).toBe(8900)
    expect(res.unrealizedPct).toBeCloseTo(8900 / (13000 + 25500), 12)
    expect(res.dayChange).toBe(200 * 1 + 10 * 3 * 19)
    expect(res.dayChangePct).toBeCloseTo(770 / (54400 - 7000 - 770), 12)
    expect(res.unquoted).toEqual([])
  })

  it('sin cotización ni tipo de cambio no inventa: sale null y se lista', () => {
    const res = summarize({ transactions: TXS, quotes: [quote('W', 66, 1)], usdmxn: null, today: '2026-09-22' })
    expect(res.rows.find((r) => r.symbol === 'AAPL')).toMatchObject({ value: null, pnlMxn: null, weight: null })
    expect(res.unquoted).toEqual(['AAPL'])
    expect(res.unrealized).toBe(200)
    expect(res.unrealizedExcluded).toBe(1)
  })

  it('una emisora comprada en pesos que cotiza en dólares (SIC) da su resultado en pesos y se avisa', () => {
    const res = summarize({ transactions: TXS, quotes: [quote('W', 3.5, 0.1, 'USD'), quote('AAPL', 180, 3, 'USD')], usdmxn: 19, today: '2026-09-22' })
    // 200 títulos a 3.5 dólares con 19: 13,300 pesos contra 13,000 pagados en pesos.
    expect(res.rows.find((r) => r.symbol === 'W')).toMatchObject({ value: 13300, pnl: 300, pnlCurrency: 'MXN', pnlMxn: 300, costMxn: 13000, mismatch: true })
    expect(res.rows.find((r) => r.symbol === 'W')?.pnlPct).toBeCloseTo(300 / 13000, 12)
    expect(res.unrealized).toBe(300 + 8700)
    expect(res.unrealizedExcluded).toBe(0)
    expect(res.mismatched).toEqual(['W'])
  })
})
