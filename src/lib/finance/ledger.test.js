import { readFileSync } from 'node:fs'
import {
  cashBalances,
  derivePositions,
  derivePositionsDetailed,
  externalFlows,
  ledgerSnapshots,
  positionPnl,
  realizedPnlBySymbol,
  realizedSales,
  validateTransaction,
} from './ledger.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/ledger.json', import.meta.url), 'utf8'))

/** @param {Record<string, unknown>} extra */
const tx = (extra) => ({
  id: 'x',
  type: 'buy',
  date: null,
  symbol: null,
  quantity: null,
  price: null,
  currency: 'MXN',
  fxRate: null,
  fees: 0,
  amount: null,
  ratio: null,
  note: '',
  ...extra,
})

const buy = (symbol, quantity, price, extra = {}) =>
  tx({ id: `b-${symbol}-${quantity}-${price}`, type: 'buy', symbol, quantity, price, ...extra })
const sell = (symbol, quantity, price, extra = {}) =>
  tx({ id: `s-${symbol}-${quantity}-${price}`, type: 'sell', symbol, quantity, price, ...extra })

describe('derivePositions: respuestas conocidas del spec', () => {
  const base = [
    buy('AAPL', 10, 100, { date: '2026-01-05', currency: 'USD' }),
    buy('AAPL', 10, 120, { date: '2026-02-05', currency: 'USD' }),
  ]

  it('dos compras promedian el costo: 20 a 110', () => {
    const [p] = derivePositions(base)
    expect(p.quantity).toBe(20)
    expect(p.avgCost).toBeCloseTo(110, 12)
    expect(p.costBasis).toBeCloseTo(2200, 9)
  })

  it('vender 5 a 130 deja 15 a 110 y realiza 100', () => {
    const txs = [...base, sell('AAPL', 5, 130, { date: '2026-03-05', currency: 'USD' })]
    const [p] = derivePositionsDetailed(txs)
    expect(p.quantity).toBe(15)
    expect(p.avgCost).toBeCloseTo(110, 12)
    expect(p.costBasis).toBeCloseTo(1650, 9)
    expect(p.realizedPnl).toBeCloseTo(100, 9)
  })

  it('el split 2 por 1 deja 30 a 55 sin mover el costo total', () => {
    const txs = [
      ...base,
      sell('AAPL', 5, 130, { date: '2026-03-05', currency: 'USD' }),
      tx({ id: 'sp', type: 'split', symbol: 'AAPL', ratio: 2, date: '2026-04-05', currency: 'USD' }),
    ]
    const [p] = derivePositionsDetailed(txs)
    expect(p.quantity).toBe(30)
    expect(p.avgCost).toBeCloseTo(55, 12)
    expect(p.costBasis).toBeCloseTo(1650, 9)
    expect(p.realizedPnl).toBeCloseTo(100, 9)
  })

  it('las comisiones suman al costo en la compra y restan al producto en la venta', () => {
    const [p] = derivePositionsDetailed([
      buy('WALMEX.MX', 100, 60, { fees: 200 }),
      sell('WALMEX.MX', 50, 70, { fees: 100 }),
    ])
    expect(p.costBasis).toBeCloseTo(3100, 9)
    expect(p.avgCost).toBeCloseTo(62, 12)
    // producto 3,500 menos 100 de comisión, contra 3,100 de costo promedio de 50 títulos
    expect(p.realizedPnl).toBeCloseTo(300, 9)
  })
})

describe('derivePositionsDetailed: primera compra y tipo de cambio', () => {
  it('avgFx pondera por cantidad y firstBuyDate es la compra más vieja con fecha', () => {
    const [p] = derivePositionsDetailed([
      buy('AAPL', 10, 150, { date: '2026-02-10', currency: 'USD', fxRate: 17 }),
      buy('AAPL', 30, 160, { date: '2026-01-10', currency: 'USD', fxRate: 19 }),
    ])
    expect(p.firstBuyDate).toBe('2026-01-10')
    expect(p.avgFx).toBeCloseTo((10 * 17 + 30 * 19) / 40, 12)
  })

  it('si a una compra le falta el tipo de cambio, avgFx queda en null', () => {
    const [p] = derivePositionsDetailed([
      buy('AAPL', 10, 150, { currency: 'USD', fxRate: 17 }),
      buy('AAPL', 10, 160, { currency: 'USD' }),
    ])
    expect(p.avgFx).toBeNull()
  })

  it('al reabrir una posición el detalle arranca de cero', () => {
    const txs = [
      buy('CEMEXCPO.MX', 100, 12, { date: '2026-01-05' }),
      sell('CEMEXCPO.MX', 100, 15, { date: '2026-02-05' }),
      buy('CEMEXCPO.MX', 40, 14, { date: '2026-03-05' }),
    ]
    const [p] = derivePositionsDetailed(txs)
    expect(p).toMatchObject({ quantity: 40, avgCost: 14, realizedPnl: 0, firstBuyDate: '2026-03-05' })
    // lo realizado del lote anterior no se pierde, vive aparte
    expect(realizedPnlBySymbol(txs)['CEMEXCPO.MX']).toBeCloseTo(300, 9)
  })

  it('una compra sin precio deja el costo y lo realizado en null', () => {
    const txs = [buy('MSFT', 2, null), buy('MSFT', 1, 300), sell('MSFT', 1, 400)]
    const [p] = derivePositionsDetailed(txs)
    expect(p.avgCost).toBeNull()
    expect(p.costBasis).toBeNull()
    expect(p.realizedPnl).toBeNull()
  })
})

describe('cashBalances y flujos externos', () => {
  it('lleva el efectivo por moneda', () => {
    const cash = cashBalances([
      tx({ id: 'd1', type: 'deposit', amount: 10000, currency: 'MXN' }),
      tx({ id: 'd2', type: 'deposit', amount: 500, currency: 'USD' }),
      buy('AAPL', 2, 150, { currency: 'USD', fees: 5 }),
      tx({ id: 'dv', type: 'dividend', symbol: 'FUNO11.MX', amount: 250, currency: 'MXN' }),
      tx({ id: 'f', type: 'fee', amount: 120, currency: 'MXN' }),
      tx({ id: 'w', type: 'withdrawal', amount: 1000, currency: 'MXN' }),
    ])
    expect(cash.MXN).toBeCloseTo(10000 + 250 - 120 - 1000, 9)
    expect(cash.USD).toBeCloseTo(500 - 305, 9)
  })

  it('una compra sin depósito previo se cuenta como aportación externa', () => {
    const flows = externalFlows([buy('AAPL', 1, 100, { date: '2026-01-05' })])
    expect(flows).toEqual([{ date: '2026-01-05', currency: 'MXN', amount: 100, kind: 'funding', fxRate: null }])
  })

  it('con depósito previo no hay aportación implícita', () => {
    const flows = externalFlows([
      tx({ id: 'd', type: 'deposit', amount: 1000, currency: 'MXN', date: '2026-01-01' }),
      buy('AAPL', 1, 100, { date: '2026-01-05' }),
    ])
    expect(flows.map((f) => f.kind)).toEqual(['deposit'])
  })

  it('los cortes reparten los flujos entre periodos', () => {
    const snaps = ledgerSnapshots(
      [
        tx({ id: 'd', type: 'deposit', amount: 1000, currency: 'MXN', date: '2026-01-01' }),
        buy('AAPL', 1, 100, { date: '2026-01-05' }),
        tx({ id: 'd2', type: 'deposit', amount: 500, currency: 'MXN', date: '2026-02-10' }),
      ],
      ['2026-01-31', '2026-02-28'],
    )
    expect(snaps.map((s) => s.date)).toEqual(['2026-01-31', '2026-02-28'])
    expect(snaps[0].external.map((f) => f.amount)).toEqual([1000])
    expect(snaps[0].cash.MXN).toBeCloseTo(900, 9)
    expect(snaps[1].external.map((f) => f.amount)).toEqual([500])
    expect(snaps[1].positions[0].quantity).toBe(1)
  })
})

describe('realizedSales', () => {
  it('reporta cada venta con el costo promedio vigente', () => {
    const sales = realizedSales([
      buy('AAPL', 10, 100, { date: '2026-01-05' }),
      buy('AAPL', 10, 120, { date: '2026-02-05' }),
      sell('AAPL', 5, 130, { date: '2026-03-05' }),
    ])
    expect(sales).toHaveLength(1)
    expect(sales[0]).toMatchObject({ symbol: 'AAPL', quantity: 5, saleDate: '2026-03-05', costDate: '2026-01-05' })
    expect(sales[0].proceeds).toBeCloseTo(650, 9)
    expect(sales[0].cost).toBeCloseTo(550, 9)
    expect(sales[0].gain).toBeCloseTo(100, 9)
  })
})

describe('validateTransaction', () => {
  const held = [buy('AAPL', 10, 100, { date: '2026-01-05' })]

  it('acepta una compra bien formada', () => {
    expect(validateTransaction(buy('AAPL', 1, 100, { date: '2026-01-05' }))).toEqual({ ok: true, errors: [] })
  })

  it('no deja vender más de lo que hay', () => {
    const result = validateTransaction(sell('AAPL', 25, 120, { date: '2026-02-01' }), held)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('No puedes vender 25 de AAPL')
  })

  it('a esa fecha todavía no había nada', () => {
    const result = validateTransaction(sell('AAPL', 1, 120, { date: '2025-12-31' }), held)
    expect(result.ok).toBe(false)
  })

  it('rechaza NaN, cantidades no positivas y fechas mal escritas', () => {
    expect(validateTransaction(buy('AAPL', Number.NaN, 100)).errors).toContain(
      'La cantidad tiene que ser un número mayor que cero.',
    )
    expect(validateTransaction(buy('AAPL', -1, 100)).ok).toBe(false)
    expect(validateTransaction(buy('AAPL', 1, Number.NaN)).ok).toBe(false)
    expect(validateTransaction(buy('AAPL', 1, 100, { date: '05/01/2026' })).errors).toContain(
      'La fecha tiene que ir como AAAA-MM-DD.',
    )
    expect(validateTransaction(buy('AAPL', 1, 100, { fees: -5 })).ok).toBe(false)
    expect(validateTransaction(buy('AAPL', 1, 100, { currency: 'EUR' })).ok).toBe(false)
    expect(validateTransaction(tx({ type: 'split', symbol: 'AAPL', ratio: 0 }), held).ok).toBe(false)
    expect(validateTransaction(tx({ type: 'deposit', amount: 0 })).ok).toBe(false)
    expect(validateTransaction(tx({ type: 'chismorreo' })).errors[0]).toContain('Tipo de movimiento desconocido')
    expect(validateTransaction(null)).toEqual({ ok: false, errors: ['El movimiento viene vacío.'] })
  })

  it('los mensajes van en español y sin guiones largos', () => {
    const all = [
      ...validateTransaction(null).errors,
      ...validateTransaction(buy('', Number.NaN, Number.NaN, { currency: 'EUR', date: 'ayer', fees: -1 })).errors,
      ...validateTransaction(sell('AAPL', 25, 120, { date: '2026-02-01' }), held).errors,
    ]
    expect(all.length).toBeGreaterThan(5)
    for (const message of all) expect(message).not.toMatch(/[—–]/)
  })
})

describe('positionPnl: efecto precio contra efecto tipo de cambio', () => {
  it('10 títulos de 150 a 180 dólares con el peso de 17 a 19: 8,700 = 5,100 + 3,600', () => {
    const out = positionPnl({ quantity: 10, price0: 150, price1: 180, fx0: 17, fx1: 19 })
    expect(out.total).toBeCloseTo(8700, 9)
    expect(out.priceEffect).toBeCloseTo(5100, 9)
    expect(out.fxEffect).toBeCloseTo(3600, 9)
    expect(out.cross).toBe(0)
    expect(out.priceEffect + out.fxEffect + out.cross).toBeCloseTo(out.total, 9)
  })

  it('sin movimiento de tipo de cambio todo el efecto es precio', () => {
    const out = positionPnl({ quantity: 10, price0: 150, price1: 180, fx0: 1, fx1: 1 })
    expect(out.fxEffect).toBe(0)
    expect(out.priceEffect).toBeCloseTo(300, 9)
  })

  it('devuelve null si falta algún dato o si llega NaN', () => {
    expect(positionPnl({ quantity: 10, price0: 150, price1: 180, fx0: 17, fx1: null })).toBeNull()
    expect(positionPnl({ quantity: Number.NaN, price0: 1, price1: 1, fx0: 1, fx1: 1 })).toBeNull()
  })
})

describe('casos de borde', () => {
  it('sin movimientos, con undefined o con basura no truena', () => {
    expect(derivePositions([])).toEqual([])
    expect(derivePositionsDetailed(undefined)).toEqual([])
    expect(derivePositions([null, undefined, {}])).toEqual([])
    expect(cashBalances([])).toEqual({ MXN: 0, USD: 0 })
    expect(externalFlows(undefined)).toEqual([])
    expect(ledgerSnapshots([], [])).toEqual([])
  })

  it('un solo movimiento', () => {
    expect(derivePositions([buy('AAPL', 1, 10)])).toEqual([
      { symbol: 'AAPL', quantity: 1, avgCost: 10, currency: 'MXN', costBasis: 10 },
    ])
  })

  it('cantidades y precios en cero no abren posición ni mueven efectivo', () => {
    expect(derivePositions([buy('AAPL', 0, 100)])).toEqual([])
    const [p] = derivePositionsDetailed([buy('AAPL', 5, 0)])
    expect(p).toMatchObject({ quantity: 5, avgCost: 0, costBasis: 0 })
  })

  it('un NaN en la cantidad no abre posición', () => {
    expect(derivePositions([buy('AAPL', Number.NaN, 100)])).toEqual([])
  })

  it('vender de más se recorta a lo que hay', () => {
    expect(derivePositions([buy('AAPL', 3, 10), sell('AAPL', 99, 12)])).toEqual([])
  })

  it('un split sin posición no hace nada', () => {
    expect(derivePositions([tx({ type: 'split', symbol: 'AAPL', ratio: 2 })])).toEqual([])
  })
})

describe('golden contra la referencia en Python (Fraction exacto)', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const digits = Math.max(6, Math.round(-Math.log10(testCase.tol)) - 2)
    const positions = derivePositionsDetailed(testCase.input.transactions, { asOf: testCase.input.asOf })
    expect(positions.map((p) => p.symbol)).toEqual(testCase.expected.positions.map((p) => p.symbol))
    positions.forEach((position, i) => {
      const want = testCase.expected.positions[i]
      expect(position.currency).toBe(want.currency)
      expect(position.firstBuyDate).toBe(want.firstBuyDate)
      expect(position.quantity).toBeCloseTo(want.quantity, digits)
      for (const key of ['avgCost', 'costBasis', 'realizedPnl', 'avgFx']) {
        if (want[key] === null) expect(position[key]).toBeNull()
        else expect(position[key]).toBeCloseTo(want[key], digits)
      }
    })

    const cash = cashBalances(testCase.input.transactions, { asOf: testCase.input.asOf })
    expect(cash.MXN).toBeCloseTo(testCase.expected.cash.MXN, digits)
    expect(cash.USD).toBeCloseTo(testCase.expected.cash.USD, digits)

    const sales = realizedSales(testCase.input.transactions, { asOf: testCase.input.asOf })
    expect(sales).toHaveLength(testCase.expected.sales.length)
    sales.forEach((sale, i) => {
      const want = testCase.expected.sales[i]
      expect(sale.symbol).toBe(want.symbol)
      expect(sale.saleDate).toBe(want.saleDate)
      expect(sale.costDate).toBe(want.costDate)
      expect(sale.quantity).toBeCloseTo(want.quantity, digits)
      for (const key of ['proceeds', 'cost', 'gain']) {
        if (want[key] === null) expect(sale[key]).toBeNull()
        else expect(sale[key]).toBeCloseTo(want[key], digits)
      }
    })

    // Los flujos externos y el efectivo ya financiado no se comparaban, y por eso pasó sin ruido
    // que el faltante de cada compra se midiera contra un efectivo que ya venía negativo.
    const flows = externalFlows(testCase.input.transactions, { asOf: testCase.input.asOf })
    expect(flows.map((f) => f.kind)).toEqual(testCase.expected.externalFlows.map((f) => f.kind))
    flows.forEach((flow, i) => {
      const want = testCase.expected.externalFlows[i]
      expect(flow.date).toBe(want.date)
      expect(flow.currency).toBe(want.currency)
      expect(flow.amount).toBeCloseTo(want.amount, digits)
    })

    const [snapshot] = ledgerSnapshots(testCase.input.transactions, [testCase.input.asOf ?? '9999-12-31'])
    expect(snapshot.fundedCash.MXN).toBeCloseTo(testCase.expected.fundedCash.MXN, digits)
    expect(snapshot.fundedCash.USD).toBeCloseTo(testCase.expected.fundedCash.USD, digits)
  })

  it('el golden trae los casos esperados', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(11)
    expect(golden.cases.map((c) => c.name)).toContain('costo-promedio-venta-y-split')
    expect(golden.cases.map((c) => c.name)).toContain('cartera-migrada-varias-compras-sin-deposito')
  })
})

describe('compras sin depósito: la aportación implícita no se recalcula sobre sí misma', () => {
  // Es la forma exacta de una cartera migrada de la v1: cada posición legada entra como compra
  // sin fecha y sin depósito. Con más de una compra, medir el faltante contra cash (que ya viene
  // negativo) refinancia dinero ya financiado y el error se acumula en cascada.
  const migrada = [
    buy('AAPL', 80, 100, { currency: 'MXN' }),
    buy('WALMEX.MX', 5, 100, { currency: 'MXN' }),
    buy('FUNO11.MX', 5, 100, { currency: 'MXN' }),
  ]

  it('cada compra aporta solo lo que le falta', () => {
    expect(externalFlows(migrada).map((f) => f.amount)).toEqual([8000, 500, 500])
    expect(externalFlows(migrada).every((f) => f.kind === 'funding')).toBe(true)
  })

  it('el efectivo ya financiado queda en cero, no en dinero fantasma', () => {
    const [snapshot] = ledgerSnapshots(migrada, ['2026-12-31'])
    expect(snapshot.fundedCash.MXN).toBeCloseTo(0, 9)
    expect(cashBalances(migrada).MXN).toBeCloseTo(-9000, 9)
  })

  it('con un depósito parcial, solo se aporta la diferencia', () => {
    const mixto = [
      { ...buy('AAPL', 0, 0), id: 'd1', type: 'deposit', symbol: null, quantity: null, price: null, amount: 3000, date: '2026-01-01' },
      buy('AAPL', 80, 100, { date: '2026-01-02' }),
      buy('AAPL', 5, 100, { date: '2026-01-03' }),
    ]
    expect(externalFlows(mixto).map((f) => [f.kind, f.amount])).toEqual([
      ['deposit', 3000],
      ['funding', 5000],
      ['funding', 500],
    ])
  })
})

describe('no se mezclan monedas dentro de un mismo símbolo', () => {
  const compraUsd = buy('AAPL', 10, 150, { currency: 'USD' })

  it('la venta se abona a la moneda del movimiento, no a la del lote', () => {
    const ventaMxn = sell('AAPL', 10, 180, { currency: 'MXN' })
    // 1,800 pesos son 1,800 pesos, no 1,800 dólares
    expect(cashBalances([compraUsd, ventaMxn])).toEqual({ MXN: 1800, USD: -1500 })
  })

  it('validateTransaction rechaza la venta en otra moneda', () => {
    const result = validateTransaction(sell('AAPL', 10, 180, { currency: 'MXN' }), [compraUsd])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('Ya tienes AAPL en USD')
  })

  it('validateTransaction rechaza la compra en otra moneda', () => {
    const result = validateTransaction(buy('AAPL', 10, 3600, { currency: 'MXN' }), [compraUsd])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('Ya tienes AAPL en USD')
  })

  it('si de todos modos llega mezclado, el costo queda en s/d y no en un número inventado', () => {
    const [p] = derivePositions([compraUsd, buy('AAPL', 10, 3600, { currency: 'MXN' })])
    expect(p.quantity).toBe(20)
    expect(p.avgCost).toBeNull()
    expect(p.costBasis).toBeNull()
  })

  it('la misma moneda sigue pasando sin errores', () => {
    expect(validateTransaction(sell('AAPL', 5, 180, { currency: 'USD' }), [compraUsd])).toEqual({
      ok: true,
      errors: [],
    })
  })
})

describe('los flujos externos llevan el tipo de cambio que se capturó', () => {
  it('el fxRate del movimiento manda sobre la tabla por fecha', () => {
    const deposito = {
      id: 'd1',
      type: 'deposit',
      date: '2026-01-01',
      symbol: null,
      quantity: null,
      price: null,
      currency: 'USD',
      fxRate: 18,
      fees: 0,
      amount: 1000,
      ratio: null,
      note: '',
    }
    expect(externalFlows([deposito])[0].fxRate).toBe(18)
    // sin fxRate el flujo lo dice en vez de dejar que alguien suponga cuál usó
    expect(externalFlows([buy('AAPL', 1, 100, { date: '2026-01-05' })])[0].fxRate).toBeNull()
  })
})
