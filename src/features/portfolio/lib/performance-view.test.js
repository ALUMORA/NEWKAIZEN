import { describe, expect, it } from 'vitest'
import { twr, valueSeries } from '../../../lib/finance/performance-ledger.js'
import { computePerformance, isrView, lastKnown, nativePriceTable, pickWindow, pnlByPosition, splitAdjusted, twrIndex } from './performance-view.js'

const base = { fees: 0, currency: 'MXN', fxRate: null, amount: null, ratio: null, price: null, quantity: null, symbol: null, note: '' }
const tx = (/** @type {any} */ over) => ({ ...base, ...over })

describe('pickWindow', () => {
  it('elige el periodo más corto que cubre el primer movimiento, con margen', () => {
    expect(pickWindow([tx({ date: '2026-09-01' })], '2026-09-22')).toEqual({ range: '1mo', interval: '1d', first: '2026-09-01' })
    expect(pickWindow([tx({ date: '2026-06-01' })], '2026-09-22').range).toBe('6mo')
    expect(pickWindow([tx({ date: '2025-01-01' })], '2026-09-22')).toEqual({ range: '2y', interval: '1wk', first: '2025-01-01' })
    expect(pickWindow([tx({ date: '2010-01-01' })], '2026-09-22').range).toBe('max')
    expect(pickWindow([tx({ date: null })], '2026-09-22')).toEqual({ range: '1y', interval: '1d', first: null })
  })
})

describe('twrIndex', () => {
  it('termina en 1 + twr y respeta huecos y flujos', () => {
    const values = [100, 110, null, 160, 144]
    const flows = [0, 0, 20, 30, 0]
    const index = twrIndex(values, flows)
    expect(index[0]).toBe(1)
    expect(index[2]).toBeNull()
    expect(/** @type {number} */ (index[4]) - 1).toBeCloseTo(/** @type {number} */ (twr(values, flows)), 12)
  })

  it('el caso de la metodología: de 100 a 110, depósito de 50, de 160 a 144, da −1 %', () => {
    const index = twrIndex([100, 110, 160, 144], [0, 0, 50, 0])
    expect(/** @type {number} */ (index[3]) - 1).toBeCloseTo(-0.01, 12)
  })
})

describe('splitAdjusted', () => {
  it('cuenta lo anterior al split en títulos de hoy, así vale igual con precios ajustados', () => {
    const txs = [
      tx({ id: 'd', type: 'deposit', date: '2026-01-01', amount: 1000 }),
      tx({ id: 'b', type: 'buy', date: '2026-01-02', symbol: 'X', quantity: 10, price: 100 }),
      tx({ id: 's', type: 'split', date: '2026-02-01', symbol: 'X', ratio: 2 }),
    ]
    const adjusted = splitAdjusted(txs)
    expect(adjusted.map((t) => t.id)).toEqual(['d', 'b'])
    expect(adjusted[1]).toMatchObject({ quantity: 20, price: 50 })
    const prices = { X: { '2026-01-02': 50, '2026-03-02': 60 } }
    expect(valueSeries(adjusted, prices, {}, 'MXN').values).toEqual([1000, 1200])
    expect(valueSeries(txs, prices, {}, 'MXN').values[0]).toBe(500)
  })
})

describe('nativePriceTable y lastKnown', () => {
  it('toma los dólares del panel en USD y los pesos del panel en MXN', () => {
    const mxn = { dates: ['2026-01-02', '2026-01-09'], prices: { 'A.MX': [10, 11], B: [170, 180] } }
    const usd = { dates: ['2026-01-02', '2026-01-09'], prices: { B: [10, 10.5] } }
    const table = nativePriceTable(mxn, usd, new Set(['B']))
    expect(table).toEqual({ 'A.MX': { '2026-01-02': 10, '2026-01-09': 11 }, B: { '2026-01-02': 10, '2026-01-09': 10.5 } })
    expect(lastKnown(table.B, '2026-01-05')).toBe(10)
    expect(lastKnown(table.B, '2025-12-31')).toBeNull()
  })
})

describe('computePerformance', () => {
  const txs = [
    tx({ id: '1', type: 'deposit', date: '2026-09-01', amount: 20000 }),
    tx({ id: '2', type: 'buy', date: '2026-09-02', symbol: 'W', quantity: 100, price: 60 }),
    tx({ id: '3', type: 'buy', date: '2026-09-10', symbol: 'W', quantity: 100, price: 70 }),
    tx({ id: '4', type: 'deposit', date: '2026-09-15', amount: 1000 }),
  ]
  const dates = ['2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18']
  const prices = { W: { '2026-08-28': 58, '2026-09-04': 62, '2026-09-11': 71, '2026-09-18': 72 } }
  const bench = { '2026-08-28': 50, '2026-09-04': 51, '2026-09-11': 50.5, '2026-09-18': 52 }

  it('arranca en el primer corte con valor y cuadra con twr y la serie de valor', () => {
    const res = computePerformance({ transactions: txs, prices, fx: {}, dates, benchmark: bench })
    if (!res.ok) throw new Error('sin resultado')
    expect(res.windowDates).toEqual(['2026-09-04', '2026-09-11', '2026-09-18'])
    // 100 títulos a 62 más 14,000 de efectivo; luego 200 a 71 más 7,000; luego 200 a 72 más 8,000.
    expect(res.values).toEqual([20200, 21200, 22400])
    expect(res.flows).toEqual([20000, 0, 1000])
    expect(res.twr).toBeCloseTo(twr(res.values, res.flows), 12)
    expect(res.twr).toBeCloseTo((21200 / 20200) * (21400 / 21200) - 1, 12)
    expect(/** @type {number} */ (res.index.at(-1)) - 1).toBeCloseTo(res.twr, 12)
    expect(res.gain).toBeCloseTo(22400 - 20200 - 1000, 9)
    expect(res.benchReturn).toBeCloseTo(52 / 51 - 1, 12)
    expect(res.benchIndex[0]).toBe(1)
    expect(res.twrAnnual).toBeNull()
    expect(res.xirr).toBeGreaterThan(0)
    expect(res.xirrAmbiguous).toBe(false)
  })

  it('sin precios dice por qué y no inventa', () => {
    const res = computePerformance({ transactions: txs, prices: {}, fx: {}, dates })
    expect(res.ok).toBe(false)
    expect(res.missing[0].reason).toBe('Falta el precio de W.')
  })
})

describe('pnlByPosition', () => {
  it('el ejemplo de la metodología: 150 a 180 dólares con el tipo de cambio de 17 a 19', () => {
    const txs = [tx({ type: 'buy', date: '2026-01-02', symbol: 'AAPL', quantity: 10, price: 150, currency: 'USD', fxRate: 17 })]
    const res = pnlByPosition(txs, { AAPL: { '2026-09-18': 180 } }, { '2026-09-18': 19 }, '2026-09-18')
    expect(res.rows[0]).toMatchObject({ priceEffect: 5100, fxEffect: 3600, total: 8700, value: 34200, fx0: 17, fx1: 19 })
    expect(res.total).toBe(8700)
    expect(res.incomplete).toBe(0)
  })

  it('sin tipo de cambio de compra sale s/d y lo cuenta', () => {
    const txs = [
      tx({ type: 'buy', date: null, symbol: 'AAPL', quantity: 10, price: 150, currency: 'USD' }),
      tx({ type: 'buy', date: '2026-01-02', symbol: 'W', quantity: 10, price: 60 }),
    ]
    const res = pnlByPosition(txs, { AAPL: { '2026-09-18': 180 }, W: { '2026-09-18': 66 } }, { '2026-09-18': 19 }, '2026-09-18')
    expect(res.rows.find((r) => r.symbol === 'AAPL')?.total).toBeNull()
    expect(res.rows.find((r) => r.symbol === 'W')).toMatchObject({ priceEffect: 60, fxEffect: 0, total: 60 })
    expect(res.incomplete).toBe(1)
    expect(res.total).toBe(60)
  })
})

describe('isrView', () => {
  it('el caso de la metodología: vender 5 a 130 con costo promedio de 110 da 100 de ganancia', () => {
    const txs = [
      tx({ type: 'buy', date: '2026-01-02', symbol: 'W', quantity: 10, price: 100 }),
      tx({ type: 'buy', date: '2026-02-02', symbol: 'W', quantity: 10, price: 120 }),
      tx({ type: 'sell', date: '2026-03-02', symbol: 'W', quantity: 5, price: 130 }),
      tx({ type: 'sell', date: '2026-03-03', symbol: 'AAPL', quantity: 1, price: 200, currency: 'USD' }),
      tx({ type: 'dividend', date: '2026-04-01', symbol: 'W', amount: 50 }),
    ]
    const res = isrView(txs)
    expect(res.estimate?.years).toEqual([{ year: '2026', gain: 100, taxableGain: 100, tax: 10, lossUsed: 0, lossCarry: 0 }])
    expect(res.usdSales).toBe(0)
    expect(res.dividendsMxn).toBe(50)
  })
})
