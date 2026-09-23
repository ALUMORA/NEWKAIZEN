import { readFileSync } from 'node:fs'
import { annualizeReturn, twr, twrReturns, valueSeries, yearsBetween } from './performance-ledger.js'

const golden = JSON.parse(
  readFileSync(new URL('../../../tests/golden/performance-ledger.json', import.meta.url), 'utf8'),
)

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

describe('twr: respuesta conocida del spec', () => {
  it('100 a 110, entran 50 y de 160 baja a 144: menos 1 %', () => {
    expect(twr([100, 110, 160, 144], [0, 0, 50, 0])).toBeCloseTo(-0.01, 12)
  })

  it('los subperiodos son .10, 0 y menos .10', () => {
    const returns = twrReturns([100, 110, 160, 144], [0, 0, 50, 0])
    expect(returns).toHaveLength(3)
    expect(returns[0]).toBeCloseTo(0.1, 12)
    expect(returns[1]).toBeCloseTo(0, 12)
    expect(returns[2]).toBeCloseTo(-0.1, 12)
  })

  it('sin flujos el TWR es el cambio de valor', () => {
    expect(twr([100, 120])).toBeCloseTo(0.2, 12)
    expect(twr([100, 120], [0, 0])).toBeCloseTo(0.2, 12)
  })

  it('el flujo del primer corte no cuenta, porque no hay periodo antes', () => {
    expect(twr([100, 110], [999, 0])).toBeCloseTo(0.1, 12)
  })

  it('un retiro a media serie no castiga el rendimiento', () => {
    // .10, luego 60 / (110 menos 50) = 0, luego 66 / 60 menos 1 = .10: encadenado 1.1 x 1.1
    expect(twr([100, 110, 60, 66], [0, 0, -50, 0])).toBeCloseTo(0.21, 12)
  })
})

describe('twr: huecos y bases imposibles', () => {
  it('se salta los cortes sin valuar y arrastra su flujo al siguiente periodo', () => {
    // el flujo de 50 no se pierde: entró dentro del periodo que va de 100 a 160, así que se
    // descuenta del cierre y el rendimiento del periodo es (160 menos 50) / 100 menos 1 = .10
    expect(twrReturns([100, null, 160, 144], [0, 0, 50, 0])).toHaveLength(2)
    expect(twr([100, null, 160, 144], [0, 0, 50, 0])).toBeCloseTo(1.1 * (144 / 160) - 1, 12)
  })

  it('al re-establecer la base después de un hueco, el flujo no se cuenta dos veces', () => {
    // la valuación de 100 ya trae adentro el depósito de 50, así que el único periodo medible es
    // 150 / 100 menos 1. Antes devolvía [0] porque el flujo seguía pendiente y se volvía a sumar.
    expect(twrReturns([null, 100, 150], [0, 50, 0])).toEqual([0.5])
    // lo mismo cuando el salto fue por una base en cero
    expect(twrReturns([0, 100, 150], [0, 50, 0])).toEqual([0.5])
  })

  it('un depósito no castiga el rendimiento del día en que cae', () => {
    // la posición pasó de 100 a 110 y ese mismo día entraron 50: el rendimiento es .10, no .0667
    expect(twrReturns([100, 160], [0, 50])).toEqual([expect.closeTo(0.1, 12)])
  })

  it('una base en cero o negativa se salta', () => {
    expect(twrReturns([100, 0, 50], [0, 0, 0])).toEqual([-1])
    expect(twr([0, 100], [0, 0])).toBeNull()
  })

  it('devuelve null, no 0, cuando no alcanza', () => {
    expect(twr([])).toBeNull()
    expect(twr([100])).toBeNull()
    expect(twr(undefined)).toBeNull()
    expect(twrReturns([100, null])).toBeNull()
    expect(twrReturns([Number.NaN, Number.NaN])).toBeNull()
  })
})

describe('annualizeReturn y yearsBetween', () => {
  it('duplicar en 3 años da .259921', () => {
    expect(annualizeReturn(1, 3)).toBeCloseTo(0.259921, 6)
  })

  it('null cuando no hay años o el rendimiento mata el capital', () => {
    expect(annualizeReturn(0.1, 0)).toBeNull()
    expect(annualizeReturn(0.1, -1)).toBeNull()
    expect(annualizeReturn(-1, 2)).toBeNull()
    expect(annualizeReturn(null, 2)).toBeNull()
    expect(annualizeReturn(Number.NaN, 2)).toBeNull()
  })

  it('cuenta los años con la misma convención Actual/365 del XIRR', () => {
    expect(yearsBetween('2025-01-01', '2026-01-01')).toBeCloseTo(1, 12)
    expect(yearsBetween('2024-01-01', '2025-01-01')).toBeCloseTo(366 / 365, 12)
    expect(yearsBetween('hoy', '2026-01-01')).toBeNull()
  })
})

describe('valueSeries', () => {
  const movimientos = [
    tx({ id: 'b1', type: 'buy', symbol: 'X', quantity: 1, price: 100, date: '2026-01-01' }),
    tx({ id: 'd1', type: 'deposit', amount: 50, currency: 'MXN', date: '2026-01-03' }),
  ]
  const precios = { X: { '2026-01-01': 100, '2026-01-02': 110, '2026-01-03': 110, '2026-01-04': 94 } }

  it('arma la serie que da el menos 1 % del spec', () => {
    const serie = valueSeries(movimientos, precios)
    expect(serie.dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])
    expect(serie.values).toEqual([100, 110, 160, 144])
    expect(serie.flows).toEqual([100, 0, 50, 0])
    expect(serie.cash).toEqual([0, 0, 50, 50])
    expect(twr(serie.values, serie.flows)).toBeCloseTo(-0.01, 12)
    expect(serie.missing).toEqual([])
  })

  it('la compra sin depósito previo entra como aportación en el primer corte', () => {
    expect(valueSeries(movimientos, precios).flows[0]).toBeCloseTo(100, 9)
  })

  it('arrastra el último precio conocido para valuar, sin inventarlo', () => {
    const serie = valueSeries(movimientos, precios, {}, 'MXN', {
      dates: ['2026-01-02', '2026-01-10'],
    })
    expect(serie.values[1]).toBeCloseTo(94 + 50, 9)
  })

  it('sin precio anterior el valor queda en null y queda dicho por qué', () => {
    const serie = valueSeries(movimientos, { X: { '2026-01-03': 110 } }, {}, 'MXN', {
      dates: ['2026-01-01', '2026-01-03'],
    })
    expect(serie.values[0]).toBeNull()
    expect(serie.values[1]).toBeCloseTo(160, 9)
    expect(serie.missing).toEqual([{ date: '2026-01-01', reason: 'Falta el precio de X.' }])
  })

  it('antes del primer movimiento el portafolio vale cero, no null', () => {
    const serie = valueSeries(movimientos, precios, {}, 'MXN', { dates: ['2025-12-31'] })
    expect(serie.values).toEqual([0])
    expect(serie.missing).toEqual([])
  })

  it('convierte dólares a pesos con el tipo de cambio de cada fecha', () => {
    const serie = valueSeries(
      [tx({ id: 'b', type: 'buy', symbol: 'AAPL', quantity: 10, price: 150, currency: 'USD', date: '2026-01-01' })],
      { AAPL: { '2026-01-01': 150, '2026-01-02': 180 } },
      { '2026-01-01': 17, '2026-01-02': 19 },
      'MXN',
    )
    expect(serie.values[0]).toBeCloseTo(10 * 150 * 17, 9)
    expect(serie.values[1]).toBeCloseTo(10 * 180 * 19, 9)
    // la diferencia es justo la descomposición conocida: 8,700 = 5,100 + 3,600
    expect(serie.values[1] - serie.values[0]).toBeCloseTo(8700, 9)
    expect(serie.flows[0]).toBeCloseTo(10 * 150 * 17, 9)
  })

  it('sin tipo de cambio no inventa uno: el corte queda en null', () => {
    const serie = valueSeries(
      [tx({ id: 'b', type: 'buy', symbol: 'AAPL', quantity: 1, price: 150, currency: 'USD', date: '2026-01-01' })],
      { AAPL: { '2026-01-01': 150 } },
      {},
      'MXN',
    )
    expect(serie.values[0]).toBeNull()
    expect(serie.missing[0].reason).toContain('tipo de cambio')
  })

  it('serie vacía cuando no hay fechas', () => {
    const serie = valueSeries([], {}, {}, 'MXN')
    expect(serie).toMatchObject({ dates: [], values: [], flows: [], currency: 'MXN' })
  })

  it('aguanta argumentos basura', () => {
    expect(valueSeries(undefined, undefined, undefined, 'MXN').dates).toEqual([])
    expect(valueSeries(null, { X: null }, null, 'USD').dates).toEqual([])
  })
})

describe('golden contra la referencia en Python (valor de la unidad)', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const total = twr(testCase.input.values, testCase.input.flows)
    expect(total).not.toBeNull()
    expect(Math.abs(total - testCase.expected.twr)).toBeLessThan(testCase.tol)
    const returns = twrReturns(testCase.input.values, testCase.input.flows)
    expect(returns).toHaveLength(testCase.expected.returns.length)
    returns.forEach((r, i) => expect(Math.abs(r - testCase.expected.returns[i])).toBeLessThan(testCase.tol))
  })

  it('el golden trae el caso del spec', () => {
    expect(golden.cases.map((c) => c.name)).toContain('deposito-a-media-serie')
    expect(golden.cases.length).toBeGreaterThanOrEqual(9)
  })
})
