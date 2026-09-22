import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { annualTurnover, buyAndHold, constantMix, weightsSum, withBenchmark } from './backtest.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/backtest.json', import.meta.url), 'utf8'))

function expectClose(actual, expected, tol) {
  if (expected === null) return expect(actual).toBeNull()
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number')
    return expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol + Math.abs(expected) * tol)
  }
  if (Array.isArray(expected)) {
    expect(actual).toHaveLength(expected.length)
    expected.forEach((value, i) => expectClose(actual[i], value, tol))
    return undefined
  }
  if (typeof expected === 'object') {
    for (const key of Object.keys(expected)) expectClose(actual[key], expected[key], tol)
    return undefined
  }
  return expect(actual).toBe(expected)
}

const call = {
  buyAndHold: (i) => buyAndHold(i.pricePanel, i.initialWeights),
  constantMix: (i) => constantMix(i.returnPanel, i.weights, i.rebalanceEvery),
  withBenchmark: (i) => withBenchmark(i.values, i.benchValues, { k: i.k }),
}

/** El caso del spec: A sube 10 % y luego baja 10 %, B no se mueve, 50/50. */
const RETURNS = { dates: ['2026-01-12', '2026-01-19'], values: { A: [0.1, -0.1], B: [0, 0] } }
const PRICES = { dates: ['2026-01-05', '2026-01-12', '2026-01-19'], values: { A: [1, 1.1, 0.99], B: [1, 1, 1] } }
const MITADES = { A: 0.5, B: 0.5 }

describe('la respuesta conocida del spec', () => {
  it('la mezcla constante termina en .9975', () => {
    const run = constantMix(RETURNS, MITADES, 1)
    expect(run.values[run.values.length - 1]).toBeCloseTo(0.9975, 12)
  })

  it('comprar y no mover termina en .995', () => {
    const run = buyAndHold(PRICES, MITADES)
    expect(run.values[run.values.length - 1]).toBeCloseTo(0.995, 12)
  })

  it('rebalancear cuesta 25 puntos base contra dejar correr: no es ruido', () => {
    const mezcla = constantMix(RETURNS, MITADES, 1)
    const quieto = buyAndHold(PRICES, MITADES)
    const ultima = (run) => run.values[run.values.length - 1]
    expect(ultima(mezcla) - ultima(quieto)).toBeCloseTo(0.0025, 12)
  })

  it('la mezcla que nunca rebalancea da exactamente lo mismo que comprar y no mover', () => {
    const nunca = constantMix(RETURNS, MITADES, 'never')
    const quieto = buyAndHold(PRICES, MITADES)
    expect(nunca.values[2]).toBeCloseTo(quieto.values[2], 12)
    expect(nunca.turnover).toBe(0)
    expect(nunca.rebalances).toBe(0)
  })
})

describe('buyAndHold', () => {
  it('la trayectoria empieza en 1 y los pesos finales se fueron de lado solos', () => {
    const run = buyAndHold(PRICES, MITADES)
    expect(run.values[0]).toBeCloseTo(1, 12)
    expect(run.returns).toHaveLength(2)
    expect(run.weights.A).toBeCloseTo(0.495 / 0.995, 12)
    expect(run.weights.A + run.weights.B).toBeCloseTo(1, 12)
    expect(run.turnover).toBe(0)
  })

  it('normaliza pesos que no suman 1', () => {
    const conPesosCrudos = buyAndHold(PRICES, { A: 5, B: 5 })
    const conMitades = buyAndHold(PRICES, MITADES)
    expect(conPesosCrudos.values).toEqual(conMitades.values)
  })

  it('conserva las fechas del panel, con valueDates en los valores y dates en los rendimientos', () => {
    const run = buyAndHold(PRICES, MITADES)
    expect(run.valueDates).toEqual(PRICES.dates)
    expect(run.dates).toEqual(['2026-01-12', '2026-01-19'])
    const sinFechas = buyAndHold({ values: PRICES.values }, MITADES)
    expect(sinFechas.dates).toBeNull()
    expect(sinFechas.valueDates).toBeNull()
  })

  it('un calendario que no cuadra con las series devuelve null en vez de aparentar fechas', () => {
    expect(buyAndHold({ dates: ['2026-01-05'], values: PRICES.values }, MITADES)).toBeNull()
    expect(buyAndHold({ dates: ['no', 'es', 'fecha'], values: PRICES.values }, MITADES)).toBeNull()
    expect(buyAndHold({ dates: ['2026-01-19', '2026-01-12', '2026-01-05'], values: PRICES.values }, MITADES)).toBeNull()
    expect(buyAndHold({ dates: ['2026-01-05', '2026-01-05', '2026-01-19'], values: PRICES.values }, MITADES)).toBeNull()
    expect(buyAndHold({ dates: ['2026-01-05', '2026-02-30', '2026-01-19'], values: PRICES.values }, MITADES)).toBeNull()
  })

  it('un precio inicial no positivo o un símbolo sin peso devuelven null', () => {
    expect(buyAndHold({ values: { A: [0, 1.1], B: [1, 1] } }, MITADES)).toBeNull()
    expect(buyAndHold(PRICES, { A: 1 })).toBeNull()
    expect(buyAndHold(PRICES, { A: 0, B: 0 })).toBeNull()
    expect(buyAndHold(PRICES, { A: 0.5, B: NaN })).toBeNull()
  })

  it('series de largo distinto, vacías o con NaN devuelven null', () => {
    expect(buyAndHold({ values: { A: [1, 2, 3], B: [1, 2] } }, MITADES)).toBeNull()
    expect(buyAndHold({ values: { A: [1], B: [1] } }, MITADES)).toBeNull()
    expect(buyAndHold({ values: {} }, {})).toBeNull()
    expect(buyAndHold({ values: { A: [1, NaN], B: [1, 1] } }, MITADES)).toBeNull()
    expect(buyAndHold(null, MITADES)).toBeNull()
  })
})

describe('constantMix', () => {
  it('cuenta los rebalanceos y la rotación', () => {
    const run = constantMix(RETURNS, MITADES, 1)
    expect(run.rebalances).toBe(1)
    expect(run.turnover).toBeGreaterThan(0)
    expect(run.turnover).toBeCloseTo(Math.abs(0.5 - 0.55 / 1.05), 12)
  })

  it('no rebalancea al final, porque ya no queda periodo que aprovechar', () => {
    const tres = { values: { A: [0.1, -0.1, 0.05], B: [0, 0, 0] } }
    expect(constantMix(tres, MITADES, 1).rebalances).toBe(2)
  })

  it('cada N periodos rebalancea menos veces', () => {
    const seis = { values: { A: [0.1, -0.05, 0.03, -0.02, 0.04, -0.01], B: [0, 0, 0, 0, 0, 0] } }
    expect(constantMix(seis, MITADES, 1).rebalances).toBe(5)
    expect(constantMix(seis, MITADES, 2).rebalances).toBe(2)
    expect(constantMix(seis, MITADES, 'never').rebalances).toBe(0)
  })

  it('por calendario rebalancea cuando cambia el mes', () => {
    const panel = {
      dates: ['2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09', '2026-03-02'],
      values: { A: [0.01, 0.02, -0.01, 0.03, -0.02, 0.01], B: [0, 0, 0, 0, 0, 0] },
    }
    expect(constantMix(panel, MITADES, 'monthly').rebalances).toBe(2)
    expect(constantMix(panel, MITADES, 'quarterly').rebalances).toBe(0)
    expect(constantMix(panel, MITADES, 'annual').rebalances).toBe(0)
  })

  it('el calendario necesita fechas del mismo largo que los rendimientos', () => {
    expect(constantMix({ values: { A: [0.01, 0.02], B: [0, 0] } }, MITADES, 'monthly')).toBeNull()
    expect(constantMix({ dates: ['2026-01-12'], values: { A: [0.01, 0.02], B: [0, 0] } }, MITADES, 'monthly')).toBeNull()
  })

  it('una frecuencia que no se entiende devuelve null en vez de suponer', () => {
    expect(constantMix(RETURNS, MITADES, 'cada-que-me-acuerde')).toBeNull()
    expect(constantMix(RETURNS, MITADES, 0)).toBeNull()
    expect(constantMix(RETURNS, MITADES, -3)).toBeNull()
  })

  it('con un solo periodo funciona y no rebalancea', () => {
    const uno = constantMix({ values: { A: [0.1], B: [0] } }, MITADES, 1)
    expect(uno.values).toHaveLength(2)
    expect(uno.values[1]).toBeCloseTo(1.05, 12)
    expect(uno.rebalances).toBe(0)
  })

  it('panel vacío, con NaN o con pesos incompletos devuelve null', () => {
    expect(constantMix({ values: {} }, {}, 1)).toBeNull()
    expect(constantMix({ values: { A: [NaN], B: [0] } }, MITADES, 1)).toBeNull()
    expect(constantMix(RETURNS, { A: 1 }, 1)).toBeNull()
    expect(constantMix(null, MITADES, 1)).toBeNull()
  })

  it('una pérdida total no deja seguir dividiendo entre cero', () => {
    expect(constantMix({ values: { A: [-1], B: [-1] } }, MITADES, 1)).toBeNull()
  })
})

describe('withBenchmark', () => {
  const port = [100, 110, 121]
  const bench = [100, 105, 110.25]

  it('saca rendimientos, activo y totales', () => {
    const cmp = withBenchmark(port, bench, { k: 52 })
    expect(cmp.portReturns).toHaveLength(2)
    expect(cmp.totalPort).toBeCloseTo(0.21, 12)
    expect(cmp.totalBench).toBeCloseTo(0.1025, 12)
    expect(cmp.excess).toBeCloseTo(0.1075, 12)
    expect(cmp.active[0]).toBeCloseTo(0.05, 12)
    expect(cmp.n).toBe(2)
  })

  it('contra sí mismo el activo es cero y no hay information ratio', () => {
    const cmp = withBenchmark(port, port, { k: 52 })
    expect(cmp.excess).toBeCloseTo(0, 12)
    expect(cmp.trackingError).toBeCloseTo(0, 12)
    expect(cmp.informationRatio).toBeNull()
  })

  it('largos distintos, un valor en cero o k no positivo devuelven null', () => {
    expect(withBenchmark(port, bench.slice(1), { k: 52 })).toBeNull()
    expect(withBenchmark([0, 110], bench.slice(1), { k: 52 })).toBeNull()
    expect(withBenchmark(port, bench, { k: 0 })).toBeNull()
    expect(withBenchmark([100], [100], { k: 52 })).toBeNull()
    expect(withBenchmark([100, NaN], [100, 105], { k: 52 })).toBeNull()
  })
})

describe('annualTurnover y weightsSum', () => {
  it('reparte la rotación entre los años que duró la corrida', () => {
    expect(annualTurnover(2, 104, 52)).toBeCloseTo(1, 12)
    expect(annualTurnover(0, 104, 52)).toBe(0)
  })

  it('suma los pesos para validar antes de correr', () => {
    expect(weightsSum({ A: 0.5, B: 0.5 })).toBeCloseTo(1, 12)
    expect(weightsSum({ A: 0.5, B: NaN })).toBeNull()
    expect(weightsSum(null)).toBeNull()
    expect(annualTurnover(1, 0, 52)).toBeNull()
  })
})

describe('el calendario del resultado', () => {
  // El defecto que esto cubre: las dos funciones devolvían la misma forma pero `dates` se
  // correspondía con arreglos distintos, así que graficar con el zip natural dibujaba la mezcla
  // constante un periodo antes y perdía el último valor.
  it('en comprar y no mover, dates va con returns y valueDates con values', () => {
    const run = buyAndHold(PRICES, MITADES)
    expect(run.dates).toHaveLength(run.returns.length)
    expect(run.valueDates).toHaveLength(run.values.length)
    expect(run.values).toHaveLength(run.returns.length + 1)
  })

  it('en la mezcla constante, dates va con returns y valueDates con values', () => {
    const run = constantMix({ ...RETURNS, startDate: '2026-01-05' }, MITADES, 1)
    expect(run.dates).toHaveLength(run.returns.length)
    expect(run.valueDates).toHaveLength(run.values.length)
    expect(run.values).toHaveLength(run.returns.length + 1)
    expect(run.valueDates).toEqual(PRICES.dates)
  })

  it('las dos curvas se grafican con el mismo zip y caen en la misma fecha', () => {
    const zip = (fechas, serie) => fechas.map((d, i) => [d, serie[i]])
    const mezcla = constantMix({ ...RETURNS, startDate: '2026-01-05' }, MITADES, 'never')
    const quieto = buyAndHold(PRICES, MITADES)
    const curvaMezcla = zip(mezcla.valueDates, mezcla.values)
    const curvaQuieto = zip(quieto.valueDates, quieto.values)
    expect(curvaMezcla).toHaveLength(curvaQuieto.length)
    expect(curvaMezcla[curvaMezcla.length - 1][0]).toBe('2026-01-19')
    expect(curvaMezcla[curvaMezcla.length - 1][1]).toBeCloseTo(0.995, 12)
    expect(curvaQuieto[curvaQuieto.length - 1][1]).toBeCloseTo(0.995, 12)
  })

  it('sin fecha de arranque no se inventa valueDates', () => {
    const run = constantMix(RETURNS, MITADES, 1)
    expect(run.dates).toEqual(RETURNS.dates)
    expect(run.valueDates).toBeNull()
  })

  it('una fecha de arranque que no es anterior a la primera llegada devuelve null', () => {
    expect(constantMix({ ...RETURNS, startDate: '2026-01-12' }, MITADES, 1)).toBeNull()
    expect(constantMix({ ...RETURNS, startDate: '2026-02-01' }, MITADES, 1)).toBeNull()
    expect(constantMix({ ...RETURNS, startDate: 'no-es-fecha' }, MITADES, 1)).toBeNull()
    expect(constantMix({ values: RETURNS.values, startDate: '2026-01-05' }, MITADES, 1)).toBeNull()
  })

  it('un calendario de llegadas que no cuadra devuelve null aunque no haya rebalanceo por calendario', () => {
    expect(constantMix({ dates: ['2026-01-12'], values: RETURNS.values }, MITADES, 1)).toBeNull()
    expect(constantMix({ dates: ['2026-01-19', '2026-01-12'], values: RETURNS.values }, MITADES, 1)).toBeNull()
    expect(constantMix({ dates: ['2026-01-12', 'no-es-fecha'], values: RETURNS.values }, MITADES, 1)).toBeNull()
  })
})

describe('withBenchmark con la firma del spec', () => {
  const port = [100, 110, 121]
  const bench = [100, 105, 110.25]

  it('se puede llamar con dos argumentos, como dice el spec, sin tronar', () => {
    const cmp = withBenchmark(port, bench)
    expect(cmp).not.toBeNull()
    expect(cmp.k).toBe(1)
    expect(cmp.n).toBe(2)
    expect(cmp.totalPort).toBeCloseTo(0.21, 12)
  })

  it('sin k el tracking error queda por periodo, no anual', () => {
    const porPeriodo = withBenchmark(port, bench)
    const anual = withBenchmark(port, bench, { k: 52 })
    expect(anual.trackingError).toBeCloseTo(porPeriodo.trackingError * Math.sqrt(52), 12)
    expect(anual.k).toBe(52)
  })

  it('unas opciones en null valen lo mismo que no pasarlas', () => {
    expect(withBenchmark(port, bench, null)).toEqual(withBenchmark(port, bench))
  })

  it('un k que no sirve sigue devolviendo null', () => {
    expect(withBenchmark(port, bench, { k: 0 })).toBeNull()
    expect(withBenchmark(port, bench, { k: NaN })).toBeNull()
    expect(withBenchmark(port, bench, { k: '52' })).toBeNull()
  })
})

describe('golden de numpy', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})
