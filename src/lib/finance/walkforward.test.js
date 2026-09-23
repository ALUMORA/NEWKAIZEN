import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { InvalidInputError } from './linalg.js'
import { walkForward } from './walkforward.js'

/** @type {{cases: {name: string, fn: string, input: any, expected: any, tol: number}[]}} */
const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/walkforward.json', import.meta.url), 'utf8'))

/**
 * Panel determinista sin depender de rng.js (que es de otro stream): un generador congruencial
 * lineal escrito aquí, igual al de los guiones de goldens.
 * @param {number} periods
 * @param {number} assets
 * @param {number} seed
 * @returns {{ returns: number[][], dates: string[] }}
 */
function panel(periods, assets, seed) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return (state + 0.5) / 4294967296
  }
  const normal = () => Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next())
  const returns = []
  const dates = []
  const start = Date.UTC(2020, 0, 3)
  for (let t = 0; t < periods; t += 1) {
    const market = normal() * 0.016
    const row = []
    for (let i = 0; i < assets; i += 1) row.push((0.5 + 0.3 * i) * market + normal() * (0.01 + 0.004 * i))
    returns.push(row)
    dates.push(new Date(start + t * 7 * 86400000).toISOString().slice(0, 10))
  }
  return { returns, dates }
}

describe('walkForward, la guarda contra ver el futuro', () => {
  it('la estrategia espía nunca recibe un renglón del tramo que se está midiendo', () => {
    const { returns, dates } = panel(60, 3, 12345)
    /** @type {{ rows: number[][], context: any }[]} */
    const seen = []
    const spy = (windowReturns, context) => {
      seen.push({ rows: windowReturns.map((r) => r.slice()), context: { ...context } })
      return [1 / 3, 1 / 3, 1 / 3]
    }

    const result = walkForward(returns, dates, {
      estimationWindow: 20,
      holdPeriods: 7,
      method: spy,
      rebalance: 'period',
    })
    expect(result).not.toBeNull()
    expect(seen.length).toBeGreaterThan(3)

    for (const { rows, context } of seen) {
      // 1. La ventana termina exactamente donde empieza el tramo fuera de muestra.
      expect(context.estimationEnd).toBeLessThanOrEqual(context.holdStart)
      expect(context.estimationEnd).toBe(context.holdStart)
      expect(context.estimationStart).toBeLessThan(context.estimationEnd)
      // 2. Los renglones que recibió son EXACTAMENTE los del pasado, uno por uno.
      expect(rows).toHaveLength(context.estimationEnd - context.estimationStart)
      for (let i = 0; i < rows.length; i += 1) {
        const source = returns[context.estimationStart + i]
        expect(rows[i]).toEqual(source)
      }
      // 3. Y ninguno de ellos es un renglón del futuro, ni por casualidad de valores.
      for (let t = context.holdStart; t < returns.length; t += 1) {
        for (const row of rows) expect(row).not.toBe(returns[t])
      }
    }
  })

  it('cambiar el futuro no cambia ni un peso de los cortes anteriores', () => {
    // La prueba más dura: dos paneles idénticos hasta el renglón 40 y distintos después. Todos los
    // rebalanceos cuya ventana termina en 40 o antes tienen que dar exactamente los mismos pesos.
    const original = panel(80, 4, 987)
    const alterado = {
      returns: original.returns.map((row, t) => (t < 40 ? row.slice() : row.map((v) => v * -3 + 0.05))),
      dates: original.dates,
    }
    const a = walkForward(original.returns, original.dates, { estimationWindow: 20, holdPeriods: 5 })
    const b = walkForward(alterado.returns, alterado.dates, { estimationWindow: 20, holdPeriods: 5 })
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    const ra = /** @type {any} */ (a).rebalances
    const rb = /** @type {any} */ (b).rebalances
    expect(ra.length).toBe(rb.length)
    let compared = 0
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i].estimationEnd > 40) continue
      compared += 1
      expect(ra[i].weights).toEqual(rb[i].weights)
    }
    expect(compared).toBeGreaterThan(2)
  })

  it('si la estrategia modifica los renglones que recibió, el resultado no cambia (recibe una copia)', () => {
    const { returns, dates } = panel(50, 3, 4242)
    const snapshot = returns.map((r) => r.slice())
    const honest = walkForward(returns, dates, {
      estimationWindow: 20,
      holdPeriods: 5,
      method: () => [0.2, 0.3, 0.5],
      rebalance: 'period',
    })
    const vandal = walkForward(returns, dates, {
      estimationWindow: 20,
      holdPeriods: 5,
      method: (windowReturns) => {
        for (const row of windowReturns) for (let i = 0; i < row.length; i += 1) row[i] = 99
        return [0.2, 0.3, 0.5]
      },
      rebalance: 'period',
    })
    expect(/** @type {any} */ (vandal).returns).toEqual(/** @type {any} */ (honest).returns)
    expect(returns).toEqual(snapshot)
  })
})

describe('walkForward, resultados', () => {
  it('equal weight con pesos fijos cada periodo es el promedio del renglón, uno por uno', () => {
    const { returns, dates } = panel(40, 4, 777)
    const result = /** @type {any} */ (
      walkForward(returns, dates, {
        estimationWindow: 12,
        holdPeriods: 6,
        method: 'equalWeight',
        rebalance: 'period',
      })
    )
    const expected = []
    for (let t = 12; t < returns.length; t += 1) {
      expected.push(returns[t].reduce((a, b) => a + b, 0) / 4)
    }
    expect(result.returns).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i += 1) expect(result.returns[i]).toBeCloseTo(expected[i], 15)
    expect(result.dates).toEqual(dates.slice(12))
  })

  it('dejando correr los pesos, el primer periodo de cada tramo coincide con la versión fija', () => {
    const { returns, dates } = panel(40, 4, 778)
    const fijo = /** @type {any} */ (
      walkForward(returns, dates, { estimationWindow: 12, holdPeriods: 6, method: 'equalWeight', rebalance: 'period' })
    )
    const corrido = /** @type {any} */ (
      walkForward(returns, dates, { estimationWindow: 12, holdPeriods: 6, method: 'equalWeight', rebalance: 'hold' })
    )
    for (const r of corrido.rebalances) {
      const i = r.holdStart - 12
      expect(corrido.returns[i]).toBeCloseTo(fijo.returns[i], 15)
    }
  })

  it('el resumen cuadra con la serie fuera de muestra', () => {
    const { returns, dates } = panel(120, 4, 31415)
    const r = /** @type {any} */ (walkForward(returns, dates, { estimationWindow: 52, holdPeriods: 13 }))
    let wealth = 1
    for (const x of r.returns) wealth *= 1 + x
    expect(r.summary.cumulative).toBeCloseTo(wealth - 1, 12)
    expect(r.values[r.values.length - 1]).toBeCloseTo(wealth, 12)
    expect(r.summary.periods).toBe(r.returns.length)
    expect(r.summary.maxDrawdown).toBeLessThanOrEqual(0)
    expect(r.folds).toBe(r.rebalances.length)
  })

  it('la caída máxima cuenta una pérdida en el PRIMER periodo fuera de muestra', () => {
    // El pico de arranque es la riqueza inicial, 1, no el primer valor ya golpeado. Antes de
    // corregirlo esta estrategia, que pierde 30 % de entrada y luego sube poco, reportaba 0.
    const T = 20
    const returns = []
    for (let t = 0; t < T; t += 1) returns.push([0.001 * ((t % 3) - 1), 0.002 * ((t % 2) - 0.5)])
    returns[10] = [-0.3, -0.3]
    for (let t = 11; t < T; t += 1) returns[t] = [0.001, 0.001]
    const dates = Array.from({ length: T }, (_, t) => `2020-01-${String(t + 1).padStart(2, '0')}`)
    const r = /** @type {any} */ (
      walkForward(returns, dates, { estimationWindow: 10, holdPeriods: 5, method: 'equalWeight' })
    )
    expect(r.returns[0]).toBeCloseTo(-0.3, 12)
    expect(r.summary.maxDrawdown).toBeCloseTo(-0.3, 12)
  })

  it('la caída máxima coincide con la de la trayectoria que arranca en 1', () => {
    const { returns, dates } = panel(200, 4, 8080)
    const r = /** @type {any} */ (walkForward(returns, dates, { estimationWindow: 52, holdPeriods: 13 }))
    let peak = 1
    let worst = 0
    for (const v of r.values) {
      peak = Math.max(peak, v)
      worst = Math.min(worst, v / peak - 1)
    }
    expect(r.summary.maxDrawdown).toBeCloseTo(worst, 14)
  })

  it('cada rebalanceo entrega pesos que suman 1', () => {
    const { returns, dates } = panel(120, 5, 2718)
    for (const method of /** @type {const} */ (['minVariance', 'maxSharpe', 'riskParity', 'equalWeight'])) {
      const r = /** @type {any} */ (walkForward(returns, dates, { estimationWindow: 52, holdPeriods: 13, method }))
      expect(r).not.toBeNull()
      for (const rebalance of r.rebalances) {
        expect(rebalance.weights.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0)).toBeCloseTo(
          1,
          9,
        )
        for (const w of rebalance.weights) expect(w).toBeGreaterThanOrEqual(-1e-12)
      }
    }
  })

  it('maxSharpe con rf por encima de todo lo factible cae a mínima varianza y lo dice', () => {
    // rf de 1 % SEMANAL: ninguna media de ventana le gana, así que no hay tangente que enseñar.
    const { returns, dates } = panel(120, 4, 2024)
    const r = /** @type {any} */ (
      walkForward(returns, dates, { estimationWindow: 52, holdPeriods: 13, method: 'maxSharpe', rf: 0.01 })
    )
    const mv = /** @type {any} */ (walkForward(returns, dates, { estimationWindow: 52, holdPeriods: 13 }))
    expect(r.rebalances.length).toBeGreaterThan(0)
    for (let i = 0; i < r.rebalances.length; i += 1) {
      expect(r.rebalances[i].note).toBe('No hubo portafolio tangente, se usó mínima varianza.')
      expect(r.rebalances[i].weights).toEqual(mv.rebalances[i].weights)
    }
  })

  it('respeta la caja en cada corte', () => {
    const { returns, dates } = panel(120, 5, 161803)
    const r = /** @type {any} */ (
      walkForward(returns, dates, { estimationWindow: 52, holdPeriods: 13, method: 'minVariance', u: 0.35 })
    )
    for (const rebalance of r.rebalances) {
      for (const w of rebalance.weights) expect(w).toBeLessThanOrEqual(0.35 + 1e-9)
    }
  })

  it('la ventana creciente arranca siempre en 0 y la móvil no', () => {
    const { returns, dates } = panel(80, 3, 555)
    const creciente = /** @type {any} */ (
      walkForward(returns, dates, { estimationWindow: 20, holdPeriods: 10, window: 'expanding' })
    )
    const movil = /** @type {any} */ (walkForward(returns, dates, { estimationWindow: 20, holdPeriods: 10 }))
    for (const r of creciente.rebalances) expect(r.estimationStart).toBe(0)
    expect(movil.rebalances[movil.rebalances.length - 1].estimationStart).toBeGreaterThan(0)
  })
})

describe('walkForward, casos de borde y validación', () => {
  it('devuelve null si no alcanza ni para un periodo fuera de muestra', () => {
    const { returns, dates } = panel(20, 3, 1)
    expect(walkForward(returns, dates, { estimationWindow: 20, holdPeriods: 5 })).toBeNull()
    expect(walkForward(returns, dates, { estimationWindow: 25, holdPeriods: 5 })).toBeNull()
  })

  it('con exactamente un periodo de sobra entrega un solo rendimiento', () => {
    const { returns, dates } = panel(21, 3, 2)
    const r = /** @type {any} */ (
      walkForward(returns, dates, { estimationWindow: 20, holdPeriods: 5, method: 'equalWeight' })
    )
    expect(r.returns).toHaveLength(1)
    expect(r.summary.volPerPeriod).toBeNull()
    expect(r.summary.annualizedVol).toBeNull()
  })

  it('con un panel en ceros el resultado es cero y no NaN', () => {
    const returns = Array.from({ length: 30 }, () => [0, 0, 0])
    const dates = Array.from({ length: 30 }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`)
    const r = /** @type {any} */ (walkForward(returns, dates, { estimationWindow: 10, holdPeriods: 5 }))
    for (const x of r.returns) expect(x).toBe(0)
    expect(r.summary.cumulative).toBe(0)
    // Sin varianza todos los portafolios empatan, así que lo neutral es repartir parejo, no
    // amontonar el 100 % en el primer activo de la lista.
    for (const b of r.rebalances) {
      for (const w of b.weights) expect(w).toBeCloseTo(1 / 3, 12)
    }
  })

  it('rechaza matriz vacía, NaN, fechas que no casan y ventanas absurdas', () => {
    const { returns, dates } = panel(30, 3, 3)
    expect(() => walkForward([], [], {})).toThrow(InvalidInputError)
    expect(() => walkForward(returns, dates.slice(1), {})).toThrow(InvalidInputError)
    expect(() => walkForward(returns, dates.map(() => 1), {})).toThrow(InvalidInputError)
    const conNaN = returns.map((r) => r.slice())
    conNaN[5][1] = Number.NaN
    expect(() => walkForward(conNaN, dates, {})).toThrow(InvalidInputError)
    expect(() => walkForward(returns, dates, { estimationWindow: 1 })).toThrow(InvalidInputError)
    expect(() => walkForward(returns, dates, { estimationWindow: 10, holdPeriods: 0 })).toThrow(InvalidInputError)
    expect(() => walkForward(returns, dates, { estimationWindow: 10, k: 0 })).toThrow(InvalidInputError)
  })

  it('rechaza un método desconocido y una estrategia que devuelve basura', () => {
    const { returns, dates } = panel(30, 3, 4)
    expect(() =>
      walkForward(returns, dates, { estimationWindow: 10, method: /** @type {any} */ ('loQueSea') }),
    ).toThrow(InvalidInputError)
    expect(() => walkForward(returns, dates, { estimationWindow: 10, method: () => [1, 2] })).toThrow(InvalidInputError)
    expect(() => walkForward(returns, dates, { estimationWindow: 10, method: () => [1, Number.NaN, 0] })).toThrow(
      InvalidInputError,
    )
  })
})

describe('goldens contra la reimplementación en numpy y scipy', () => {
  for (const testCase of golden.cases) {
    it(`${testCase.name}`, () => {
      const { input, expected, tol } = testCase
      const result = walkForward(input.returns, input.dates, input.options)
      expect(result).not.toBeNull()
      const r = /** @type {any} */ (result)

      expect(r.folds).toBe(expected.folds)
      expect(r.dates).toEqual(expected.dates)
      expect(r.returns).toHaveLength(expected.returns.length)
      for (let i = 0; i < expected.returns.length; i += 1) {
        expect(Math.abs(r.returns[i] - expected.returns[i])).toBeLessThanOrEqual(tol)
      }

      expect(r.rebalances).toHaveLength(expected.rebalances.length)
      for (let i = 0; i < expected.rebalances.length; i += 1) {
        const mine = r.rebalances[i]
        const theirs = expected.rebalances[i]
        expect(mine.holdStart).toBe(theirs.holdStart)
        expect(mine.holdEnd).toBe(theirs.holdEnd)
        expect(mine.estimationStart).toBe(theirs.estimationStart)
        expect(mine.estimationEnd).toBe(theirs.estimationEnd)
        expect(mine.date).toBe(theirs.date)
        for (let j = 0; j < theirs.weights.length; j += 1) {
          expect(Math.abs(mine.weights[j] - theirs.weights[j])).toBeLessThanOrEqual(Math.max(tol, 1e-6))
        }
      }

      const s = expected.summary
      expect(r.summary.periods).toBe(s.periods)
      expect(Math.abs(r.summary.meanPerPeriod - s.meanPerPeriod)).toBeLessThanOrEqual(tol)
      expect(Math.abs(r.summary.volPerPeriod - s.volPerPeriod)).toBeLessThanOrEqual(tol)
      expect(Math.abs(r.summary.cumulative - s.cumulative)).toBeLessThanOrEqual(tol)
      expect(Math.abs(r.summary.annualizedReturn - s.annualizedReturn)).toBeLessThanOrEqual(tol)
      expect(Math.abs(r.summary.annualizedVol - s.annualizedVol)).toBeLessThanOrEqual(tol)
      expect(Math.abs(r.summary.maxDrawdown - s.maxDrawdown)).toBeLessThanOrEqual(tol)
    })
  }
})
