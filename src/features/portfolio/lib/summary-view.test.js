import { describe, expect, it } from 'vitest'
import { previousFix, summarize } from './summary-view.js'

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

  it('con dos compras en dólares a precios y tipos de cambio distintos, el costo en pesos es lo pagado', () => {
    const txs = [
      tx({ type: 'buy', date: '2026-01-02', symbol: 'AAPL', quantity: 10, price: 100, currency: 'USD', fxRate: 17 }),
      tx({ type: 'buy', date: '2026-02-02', symbol: 'AAPL', quantity: 10, price: 200, currency: 'USD', fxRate: 20 }),
    ]
    const res = summarize({ transactions: txs, quotes: [quote('AAPL', 150, 0, 'USD')], usdmxn: 20, today: '2026-09-22' })
    // Hoy 20 × 150 × 20 = 60,000 contra 57,000 pagados. Con avgFx por cantidad salía 4,500.
    expect(res.rows[0]).toMatchObject({ costMxn: 57000, pnlMxn: 3000 })
  })

  it('una transacción con fecha futura no cuenta en posiciones ni en efectivo, y se cuenta aparte', () => {
    const txs = [
      ...TXS,
      tx({ type: 'buy', date: '2026-09-30', symbol: 'W', quantity: 50, price: 80 }),
      tx({ type: 'buy', date: '2026-10-01', symbol: 'AAPL', quantity: 5, price: 190, currency: 'USD', fxRate: 25 }),
    ]
    const res = summarize({ transactions: txs, quotes: [quote('W', 66, 1), quote('AAPL', 180, 3, 'USD')], usdmxn: 19, today: '2026-09-22' })
    // Lo de hoy es igual que sin los dos movimientos del futuro: 200 W y 10 AAPL con su costo.
    expect(res.rows.find((r) => r.symbol === 'W')).toMatchObject({ quantity: 200, value: 13200, costMxn: 13000 })
    expect(res.rows.find((r) => r.symbol === 'AAPL')).toMatchObject({ quantity: 10, costMxn: 25500 })
    expect(res.cashMxn).toBe(7000)
    expect(res.futureCount).toBe(2)
  })

  it('con efectivo en dólares y sin tipo de cambio conserva el efectivo en pesos y lo marca', () => {
    const txs = [...TXS, tx({ type: 'deposit', date: '2026-09-12', amount: 100, currency: 'USD' })]
    const res = summarize({ transactions: txs, quotes: [quote('W', 66, 1)], usdmxn: null, today: '2026-09-22' })
    expect(res.cashMxn).toBe(7000)
    expect(res.cashUsd).toBe(100)
    expect(res.cashUsdUnconverted).toBe(true)
    const conv = summarize({ transactions: txs, quotes: [quote('W', 66, 1)], usdmxn: 19, today: '2026-09-22' })
    expect(conv.cashMxn).toBe(7000 + 1900)
    expect(conv.cashUsdUnconverted).toBe(false)
  })

  it('la variación del día en dólares usa el tipo de cambio de ayer para el cierre de ayer', () => {
    const aapl = { ...quote('AAPL', 180, 3, 'USD'), previousClose: 177 }
    const res = summarize({ transactions: TXS, quotes: [quote('W', 66, 1), aapl], usdmxn: 19, usdmxnPrev: 18.5, today: '2026-09-22' })
    // 10 × (180 × 19 − 177 × 18.5) = 1,455: el peso también se movió, no solo la acción.
    expect(res.rows.find((r) => r.symbol === 'AAPL')?.changeMxn).toBeCloseTo(1455, 9)
    expect(res.dayChange).toBeCloseTo(200 + 1455, 9)
    // Base: lo que valía ayer en pesos, 200 × 65 + 10 × 177 × 18.5.
    expect(res.dayChangePct).toBeCloseTo(1655 / (13000 + 32745), 12)
    expect(res.dayFxFallback).toBe(false)
    // Sin previousClose, P0 = P1 − change.
    const noPrev = summarize({ transactions: TXS, quotes: [quote('AAPL', 180, 3, 'USD')], usdmxn: 19, usdmxnPrev: 18.5, today: '2026-09-22' })
    expect(noPrev.rows.find((r) => r.symbol === 'AAPL')?.changeMxn).toBeCloseTo(1455, 9)
  })

  it('sin el tipo de cambio de ayer se queda con el de hoy y lo marca', () => {
    const res = summarize({ transactions: TXS, quotes: [quote('W', 66, 1), quote('AAPL', 180, 3, 'USD')], usdmxn: 19, usdmxnPrev: null, today: '2026-09-22' })
    expect(res.rows.find((r) => r.symbol === 'AAPL')?.changeMxn).toBe(10 * 3 * 19)
    expect(res.dayFxFallback).toBe(true)
    // Sin posiciones en dólares no hay nada que marcar.
    const mx = summarize({ transactions: TXS.slice(0, 3), quotes: [quote('W', 66, 1)], usdmxn: null, today: '2026-09-22' })
    expect(mx.dayFxFallback).toBe(false)
  })

  it('el FIX anterior es el último con fecha antes del día del tipo de cambio de hoy, en hora de México', () => {
    const hist = { dates: ['2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22'], values: [18.35, 18.39, 18.4125, 18.45] }
    expect(previousFix(hist, '2026-09-22T14:40:00Z')).toBe(18.4125)
    // 02:00 UTC del 22 todavía es el 21 en la Ciudad de México.
    expect(previousFix(hist, '2026-09-22T02:00:00Z')).toBe(18.39)
    expect(previousFix(hist, '2026-09-22')).toBe(18.4125)
    expect(previousFix({ dates: ['2026-09-22'], values: [18.45] }, '2026-09-22T14:40:00Z')).toBeNull()
    expect(previousFix(undefined, '2026-09-22T14:40:00Z')).toBeNull()
    expect(previousFix(hist, null)).toBeNull()
    expect(previousFix({ dates: ['2026-09-18', '2026-09-21'], values: [18.39, null] }, '2026-09-22')).toBe(18.39)
  })
})

describe('summarize con el historial del FIX', () => {
  it('el tipo de cambio de ayer es el último FIX antes del día de la cotización, no del día del tipo de cambio', () => {
    // A las 09:00 del 22 el FIX del 22 todavía no sale: /v2/fx dice 21 y la cotización ya es del 22.
    // X0 es el FIX del 21, no el del 18; si X1 también es el del 21, el peso no se movió hoy.
    const hist = { dates: ['2026-09-18', '2026-09-21'], values: [18.3, 18.5] }
    const aapl = { ...quote('AAPL', 180, 3, 'USD'), previousClose: 177, asOf: '2026-09-22T15:00:00Z' }
    const res = summarize({ transactions: TXS, quotes: [aapl], usdmxn: 18.6, fxHistory: hist, today: '2026-09-22' })
    // 10 × (180 × 18.6 − 177 × 18.5) = 735
    expect(res.dayChange).toBeCloseTo(735, 6)
    expect(res.dayFxFallback).toBe(false)
  })

  it('sin fecha en la cotización toma el día de hoy', () => {
    const hist = { dates: ['2026-09-18', '2026-09-21', '2026-09-22'], values: [18.3, 18.5, 18.6] }
    const aapl = { ...quote('AAPL', 180, 3, 'USD'), previousClose: 177 }
    const res = summarize({ transactions: TXS, quotes: [aapl], usdmxn: 18.6, fxHistory: hist, today: '2026-09-22' })
    expect(res.dayChange).toBeCloseTo(10 * (180 * 18.6 - 177 * 18.5), 6)
  })
})
