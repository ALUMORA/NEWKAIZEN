import { readFileSync } from 'node:fs'
import { wholeShareRebalance } from './rebalance.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/rebalance.json', import.meta.url), 'utf8'))

describe('wholeShareRebalance: respuesta conocida del spec', () => {
  it('10,000 al 50/50 con precios de 300 y 700 da 17 de A y 7 de B, sin efectivo sobrante', () => {
    const plan = wholeShareRebalance({
      holdings: {},
      prices: { A: 300, B: 700 },
      targets: { A: 0.5, B: 0.5 },
      cash: 10000,
    })
    expect(plan.after.holdings).toEqual({ A: 17, B: 7 })
    expect(plan.after.cash).toBeCloseTo(0, 9)
    expect(plan.trades).toEqual([
      { symbol: 'A', side: 'compra', quantity: 17, amount: 5100, price: 300 },
      { symbol: 'B', side: 'compra', quantity: 7, amount: 4900, price: 700 },
    ])
    expect(plan.deviation.before).toBeCloseTo(1, 12)
    expect(plan.deviation.after).toBeCloseTo(0.02, 12)
    expect(plan.after.weights.A).toBeCloseTo(0.51, 12)
    expect(plan.after.weights.B).toBeCloseTo(0.49, 12)
  })

  it('el paso codicioso sí mejora: el piso solo daría 16 de A', () => {
    const plan = wholeShareRebalance({
      prices: { A: 300, B: 700 },
      targets: { A: 0.5, B: 0.5 },
      cash: 10000,
    })
    // piso: 16 de A (4,800) y 7 de B (4,900), desviación .03; con la compra extra baja a .02
    expect(plan.after.holdings.A).toBe(17)
    expect(plan.deviation.after).toBeLessThan(0.03)
  })
})

describe('ventas, efectivo y objetivos', () => {
  it('vende lo que sobra cuando se permite vender', () => {
    const plan = wholeShareRebalance({
      holdings: { A: 40, B: 0 },
      prices: { A: 100, B: 100 },
      targets: { A: 0.5, B: 0.5 },
      cash: 0,
    })
    expect(plan.trades).toEqual([
      { symbol: 'A', side: 'venta', quantity: 20, amount: 2000, price: 100 },
      { symbol: 'B', side: 'compra', quantity: 20, amount: 2000, price: 100 },
    ])
    expect(plan.deviation.after).toBeCloseTo(0, 12)
  })

  it('con allowSell en falso solo invierte el efectivo', () => {
    const plan = wholeShareRebalance({
      holdings: { A: 40, B: 0 },
      prices: { A: 100, B: 100 },
      targets: { A: 0.5, B: 0.5 },
      cash: 1000,
      allowSell: false,
    })
    expect(plan.trades.every((t) => t.side === 'compra')).toBe(true)
    expect(plan.after.holdings.A).toBe(40)
    expect(plan.after.holdings.B).toBe(10)
  })

  it('un objetivo en cero saca la posición completa', () => {
    const plan = wholeShareRebalance({
      holdings: { A: 12, B: 3 },
      prices: { A: 250, B: 1000 },
      targets: { A: 1, B: 0 },
      cash: 0,
    })
    expect(plan.after.holdings.B).toBe(0)
    expect(plan.after.holdings.A).toBe(24)
    expect(plan.deviation.after).toBeCloseTo(0, 12)
  })

  it('objetivos que no suman 1 se reescalan y queda anotado', () => {
    const plan = wholeShareRebalance({
      prices: { A: 100, B: 100 },
      targets: { A: 30, B: 70 },
      cash: 10000,
    })
    expect(plan.targets.A).toBeCloseTo(0.3, 12)
    expect(plan.after.holdings).toEqual({ A: 30, B: 70 })
    expect(plan.notes.join(' ')).toContain('no sumaban 100 %')
  })

  it('un símbolo sin precio se salta y su objetivo se reparte', () => {
    const plan = wholeShareRebalance({
      prices: { A: 100 },
      targets: { A: 0.5, ZZZ: 0.5 },
      cash: 1000,
    })
    expect(plan.skipped).toEqual([{ symbol: 'ZZZ', reason: 'No hay precio para ese símbolo.' }])
    expect(plan.after.holdings).toEqual({ A: 10 })
    expect(plan.targets.A).toBeCloseTo(1, 12)
  })

  it('minTrade omite los movimientos chicos', () => {
    const sinPiso = wholeShareRebalance({
      holdings: { A: 100, B: 100 },
      prices: { A: 10, B: 10 },
      targets: { A: 0.52, B: 0.48 },
      cash: 0,
    })
    expect(sinPiso.trades.length).toBeGreaterThan(0)
    const conPiso = wholeShareRebalance({
      holdings: { A: 100, B: 100 },
      prices: { A: 10, B: 10 },
      targets: { A: 0.52, B: 0.48 },
      cash: 0,
      minTrade: 1000,
    })
    expect(conPiso.trades).toEqual([])
    expect(conPiso.notes.join(' ')).toContain('Se omitieron los movimientos de menos de 1000')
  })
})

describe('texto y forma de la salida', () => {
  const plan = wholeShareRebalance({ prices: { A: 300, B: 700 }, targets: { A: 0.5, B: 0.5 }, cash: 10000 })

  it('los lados van en español como pasos mecánicos', () => {
    for (const trade of plan.trades) expect(['compra', 'venta']).toContain(trade.side)
    expect(plan.notes[0]).toContain('no una recomendación de inversión')
  })

  it('las cantidades son enteras', () => {
    for (const trade of plan.trades) expect(Number.isInteger(trade.quantity)).toBe(true)
    for (const quantity of Object.values(plan.after.holdings)) expect(Number.isInteger(quantity)).toBe(true)
  })

  it('ningún aviso lleva guiones largos', () => {
    for (const note of plan.notes) expect(note).not.toMatch(/[—–]/)
  })

  it('el valor total no cambia con el plan', () => {
    const invertido = Object.entries(plan.after.holdings).reduce(
      (acc, [symbol, quantity]) => acc + quantity * (symbol === 'A' ? 300 : 700),
      0,
    )
    expect(invertido + plan.after.cash).toBeCloseTo(plan.after.value, 9)
  })
})

describe('casos de borde', () => {
  it('devuelve null cuando no hay con qué', () => {
    expect(wholeShareRebalance({ prices: {}, targets: {}, cash: 0 })).toBeNull()
    expect(wholeShareRebalance({ prices: { A: 100 }, targets: { A: 1 }, cash: Number.NaN })).toBeNull()
    expect(wholeShareRebalance()).toBeNull()
  })

  it('devuelve null si una posición que se tiene no trae precio', () => {
    expect(wholeShareRebalance({ holdings: { A: 10 }, prices: {}, targets: { A: 1 }, cash: 100 })).toBeNull()
    expect(wholeShareRebalance({ holdings: { A: 10 }, prices: { A: 0 }, targets: { A: 1 }, cash: 100 })).toBeNull()
    expect(
      wholeShareRebalance({ holdings: { A: 10 }, prices: { A: Number.NaN }, targets: { A: 1 }, cash: 100 }),
    ).toBeNull()
  })

  it('sin objetivos vende todo y deja el efectivo', () => {
    const plan = wholeShareRebalance({ holdings: { A: 10 }, prices: { A: 100 }, targets: {}, cash: 0 })
    expect(plan.after.holdings).toEqual({ A: 0 })
    expect(plan.after.cash).toBeCloseTo(1000, 9)
  })

  it('cuando ya está en el objetivo no propone nada', () => {
    const plan = wholeShareRebalance({
      holdings: { A: 50, B: 50 },
      prices: { A: 100, B: 100 },
      targets: { A: 0.5, B: 0.5 },
      cash: 0,
    })
    expect(plan.trades).toEqual([])
    expect(plan.deviation.after).toBeCloseTo(plan.deviation.before, 12)
  })

  it('un precio más caro que todo el portafolio deja esa posición en cero', () => {
    const plan = wholeShareRebalance({
      prices: { A: 9000, B: 40 },
      targets: { A: 0.5, B: 0.5 },
      cash: 5000,
    })
    expect(plan.after.holdings.A).toBe(0)
    expect(plan.after.holdings.B).toBe(62)
  })

  it('un objetivo NaN se toma como cero', () => {
    const plan = wholeShareRebalance({
      prices: { A: 100, B: 100 },
      targets: { A: Number.NaN, B: 1 },
      cash: 1000,
    })
    expect(plan.after.holdings).toEqual({ A: 0, B: 10 })
  })
})

describe('golden contra la referencia en Python (piso y codicioso, más búsqueda exhaustiva)', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const plan = wholeShareRebalance(testCase.input)
    expect(plan).not.toBeNull()
    expect(plan.after.holdings).toEqual(testCase.expected.holdings)
    expect(Math.abs(plan.after.cash - testCase.expected.cash)).toBeLessThan(testCase.tol)
    expect(Math.abs(plan.after.value - testCase.expected.value)).toBeLessThan(testCase.tol)
    expect(Math.abs(plan.deviation.before - testCase.expected.deviation.before)).toBeLessThan(testCase.tol)
    expect(Math.abs(plan.deviation.after - testCase.expected.deviation.after)).toBeLessThan(testCase.tol)
    for (const [symbol, weight] of Object.entries(testCase.expected.weights)) {
      expect(Math.abs(plan.after.weights[symbol] - weight)).toBeLessThan(testCase.tol)
    }
    if (testCase.expected.optimal) {
      const optimal = testCase.expected.optimal.deviation
      // el método codicioso nunca queda por debajo del óptimo entero
      expect(plan.deviation.after).toBeGreaterThanOrEqual(optimal - testCase.tol)
      if (testCase.expected.matchesOptimal) {
        expect(Math.abs(plan.deviation.after - optimal)).toBeLessThan(testCase.tol)
      }
    }
  })

  it('el golden deja medido el único caso donde el codicioso no llega al óptimo', () => {
    const caso = golden.cases.find((c) => c.name === 'greedy-vs-optimo')
    expect(caso.expected.matchesOptimal).toBe(false)
    expect(caso.expected.deviation.after).toBeCloseTo(0.179104, 6)
    expect(caso.expected.optimal.deviation).toBeCloseTo(0.125373, 6)
    const fallan = golden.cases.filter((c) => c.expected.matchesOptimal === false)
    expect(fallan.map((c) => c.name)).toEqual(['greedy-vs-optimo'])
  })
})
