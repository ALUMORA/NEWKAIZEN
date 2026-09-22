import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  annualizedVol,
  cagr,
  cagrFromReturns,
  calmar,
  drawdowns,
  historicalCVaR,
  historicalVaR,
  parametricCVaR,
  parametricVaR,
  percentile,
  sharpe,
  sortino,
  summary,
} from './performance.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/performance.json', import.meta.url), 'utf8'))

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
  cagr: (i) => cagr(i.startValue, i.endValue, i.years),
  cagrFromReturns: (i) => cagrFromReturns(i.returns, i.k),
  annualizedVol: (i) => annualizedVol(i.returns, i.k),
  sharpe: (i) => sharpe(i.returns, i.rfPerPeriod, i.k),
  sortino: (i) => sortino(i.returns, i.rfPerPeriod, i.k),
  drawdowns: (i) => drawdowns(i.values),
  historicalVaR: (i) => historicalVaR(i.returns, i.alpha),
  historicalCVaR: (i) => historicalCVaR(i.returns, i.alpha),
  parametricVaR: (i) => parametricVaR(i.mu, i.sigma, i.alpha),
  parametricCVaR: (i) => parametricCVaR(i.mu, i.sigma, i.alpha),
}

/** Los 20 rendimientos del spec: de −.05 a +.14 de centésima en centésima. */
const VEINTE = Array.from({ length: 20 }, (_, i) => Math.round((-0.05 + 0.01 * i) * 1e10) / 1e10)

describe('cagr', () => {
  it('la respuesta conocida del spec: 100 a 200 en 3 años son .259921', () => {
    expect(cagr(100, 200, 3)).toBeCloseTo(0.259921, 6)
  })

  it('el promedio aritmético miente y el geométrico no: +50 % y −50 % dejan −.133975', () => {
    const r = [0.5, -0.5]
    expect(r.reduce((a, b) => a + b, 0) / r.length).toBe(0)
    expect(cagrFromReturns(r, 1)).toBeCloseTo(-0.133975, 6)
  })

  it('anualiza con k explícito', () => {
    expect(cagrFromReturns([0.01, 0.01], 52)).toBeCloseTo(1.01 ** 52 - 1, 10)
  })

  it('valores no positivos o cero años devuelven null', () => {
    expect(cagr(0, 200, 3)).toBeNull()
    expect(cagr(100, -20, 3)).toBeNull()
    expect(cagr(100, 200, 0)).toBeNull()
    expect(cagr(NaN, 200, 3)).toBeNull()
    expect(cagrFromReturns([], 52)).toBeNull()
    expect(cagrFromReturns([-1, 0.5], 52)).toBeNull()
    expect(cagrFromReturns([0.1], 0)).toBeNull()
  })
})

describe('sharpe y sortino', () => {
  const E = [0.01, 0.02, -0.01, 0.03, 0]

  it('la respuesta conocida del spec: .632456 por periodo y 4.560702 anualizada', () => {
    expect(sharpe(E, 0, 1)).toBeCloseTo(0.632456, 6)
    expect(sharpe(E, 0, 52)).toBeCloseTo(4.560702, 6)
  })

  it('la tasa libre de riesgo puede venir como serie alineada', () => {
    const rf = [0.001, 0.001, 0.001, 0.001, 0.001]
    expect(sharpe(E, rf, 52)).toBeCloseTo(sharpe(E.map((v) => v - 0.001), 0, 52), 12)
  })

  it('una serie de rf de otro largo no se alinea a la fuerza', () => {
    expect(sharpe(E, [0.001, 0.001], 52)).toBeNull()
    expect(sharpe(E, null, 52)).toBeNull()
  })

  it('la respuesta conocida del spec para Sortino: .6 por periodo y 4.32666 anualizada', () => {
    const r = [0.02, -0.01, 0.03, -0.02, 0.01]
    expect(sortino(r, 0, 1)).toBeCloseTo(0.6, 12)
    expect(sortino(r, 0, 52)).toBeCloseTo(4.32666, 5)
  })

  it('la desviación a la baja divide entre TODAS las n, no solo entre las negativas', () => {
    const r = [0.02, -0.01, 0.03, -0.02, 0.01]
    const soloNegativas = Math.sqrt((0.01 ** 2 + 0.02 ** 2) / 2)
    const todas = Math.sqrt((0.01 ** 2 + 0.02 ** 2) / 5)
    expect(todas).toBeLessThan(soloNegativas)
    expect(sortino(r, 0, 1)).toBeCloseTo(0.006 / todas, 12)
    // Dividir solo entre las negativas daría 0.3795 en vez de 0.6: es otra métrica, no la de Sortino.
    expect(sortino(r, 0, 1)).not.toBeCloseTo(0.006 / soloNegativas, 6)
  })

  it('sin ninguna observación a la baja, Sortino no existe', () => {
    expect(sortino([0.01, 0.02, 0.03], 0, 52)).toBeNull()
  })

  it('con excesos constantes Sharpe no existe, porque la desviación es cero', () => {
    expect(sharpe([0.01, 0.01, 0.01], 0.002, 52)).toBeNull()
  })

  it('piden al menos dos periodos y rechazan NaN', () => {
    expect(sharpe([0.01], 0, 52)).toBeNull()
    expect(sharpe([0.01, NaN], 0, 52)).toBeNull()
    expect(sortino([0.01], 0, 52)).toBeNull()
    expect(sortino([0.01, NaN], 0, 52)).toBeNull()
    expect(annualizedVol([0.01], 52)).toBeNull()
  })
})

describe('drawdowns y calmar', () => {
  const W = [100, 120, 90, 110, 80, 130]

  it('la respuesta conocida del spec: MDD −.333333, pico 1, fondo 4, recuperación 5', () => {
    const dd = drawdowns(W)
    expect(dd.maxDrawdown).toBeCloseTo(-0.333333, 6)
    expect(dd.peakIndex).toBe(1)
    expect(dd.troughIndex).toBe(4)
    expect(dd.recoveryIndex).toBe(5)
    expect(dd.durationPeriods).toBe(4)
  })

  it('la serie de caídas nunca es positiva y arranca en cero', () => {
    const dd = drawdowns(W)
    expect(dd.series[0]).toBe(0)
    expect(Math.max(...dd.series)).toBeLessThanOrEqual(0)
    expect(dd.series[2]).toBeCloseTo(-0.25, 12)
  })

  // Con un `>` en vez de `>=` este caso reportaría recoveryIndex null y una duración más larga
  // de la real: una cartera que vuelve EXACTAMENTE a su máximo ya se recuperó.
  it('volver exactamente al pico anterior cuenta como recuperación', () => {
    const dd = drawdowns([100, 120, 90, 120])
    expect(dd.peakIndex).toBe(1)
    expect(dd.troughIndex).toBe(2)
    expect(dd.recoveryIndex).toBe(3)
    expect(dd.durationPeriods).toBe(2)
    expect(dd.maxDrawdown).toBeCloseTo(-0.25, 12)
  })

  it('una caída que no se recupera deja recoveryIndex en null', () => {
    const dd = drawdowns([100, 120, 90, 95])
    expect(dd.recoveryIndex).toBeNull()
    expect(dd.durationPeriods).toBe(2)
  })

  it('una serie que solo sube no tiene caída', () => {
    const dd = drawdowns([100, 110, 120])
    expect(dd.maxDrawdown).toBe(0)
    expect(calmar(0.2, dd.maxDrawdown)).toBeNull()
  })

  it('calmar divide entre el valor absoluto de la caída', () => {
    expect(calmar(0.25, -0.333333)).toBeCloseTo(0.750001, 5)
    expect(calmar(NaN, -0.2)).toBeNull()
  })

  it('pide dos valores positivos', () => {
    expect(drawdowns([100])).toBeNull()
    expect(drawdowns([100, 0])).toBeNull()
    expect(drawdowns([100, -50])).toBeNull()
    expect(drawdowns([100, NaN])).toBeNull()
  })
})

describe('VaR y CVaR', () => {
  it('la respuesta conocida del spec: al 95 % da .05 y .05', () => {
    expect(historicalVaR(VEINTE, 0.95)).toBeCloseTo(0.05, 12)
    expect(historicalCVaR(VEINTE, 0.95)).toBeCloseTo(0.05, 12)
  })

  it('la respuesta conocida del spec: al 90 % da .04 y .045', () => {
    expect(historicalVaR(VEINTE, 0.9)).toBeCloseTo(0.04, 12)
    expect(historicalCVaR(VEINTE, 0.9)).toBeCloseTo(0.045, 12)
  })

  it('el CVaR nunca es menor que el VaR', () => {
    for (const alpha of [0.9, 0.95, 0.99]) {
      expect(historicalCVaR(VEINTE, alpha)).toBeGreaterThanOrEqual(historicalVaR(VEINTE, alpha))
    }
  })

  it('la respuesta conocida del spec para el paramétrico: .052311 y .077032', () => {
    const mu = 0.045
    const sigma = 0.05916079783099616
    expect(parametricVaR(mu, sigma, 0.95)).toBeCloseTo(0.052311, 6)
    expect(parametricCVaR(mu, sigma, 0.95)).toBeCloseTo(0.077032, 6)
  })

  it('con sigma cero el VaR paramétrico es solo la media al revés', () => {
    expect(parametricVaR(0.01, 0, 0.95)).toBeCloseTo(-0.01, 12)
  })

  it('alpha fuera de (0,1) y datos sucios devuelven null', () => {
    expect(historicalVaR(VEINTE, 1)).toBeNull()
    expect(historicalVaR(VEINTE, 0)).toBeNull()
    expect(historicalVaR([], 0.95)).toBeNull()
    expect(historicalCVaR([0.1, NaN], 0.95)).toBeNull()
    expect(parametricVaR(NaN, 0.05, 0.95)).toBeNull()
    expect(parametricVaR(0.01, -0.05, 0.95)).toBeNull()
    expect(parametricCVaR(0.01, 0.05, 1)).toBeNull()
  })

  // Las históricas ya rechazaban una alpha de texto; las paramétricas la convertían sola porque
  // su único uso es `1 - alpha`, y devolvían un número con toda naturalidad.
  it('una alpha que llega como texto devuelve null en las cuatro', () => {
    expect(parametricVaR(0.045, 0.0591608, '0.95')).toBeNull()
    expect(parametricCVaR(0.045, 0.0591608, '0.9')).toBeNull()
    expect(historicalVaR(VEINTE, '0.95')).toBeNull()
    expect(historicalCVaR(VEINTE, '0.95')).toBeNull()
  })

  it('una alpha fuera de (0,1) o ausente también devuelve null en las paramétricas', () => {
    expect(parametricVaR(0.045, 0.0591608, 0)).toBeNull()
    expect(parametricVaR(0.045, 0.0591608, 1)).toBeNull()
    expect(parametricVaR(0.045, 0.0591608, 1.5)).toBeNull()
    expect(parametricVaR(0.045, 0.0591608, NaN)).toBeNull()
    expect(parametricVaR(0.045, 0.0591608)).toBeNull()
    expect(parametricCVaR(0.045, 0.0591608, null)).toBeNull()
  })

  it('con una sola observación la cola es esa misma observación', () => {
    expect(historicalVaR([-0.2], 0.95)).toBeCloseTo(0.2, 12)
    expect(historicalCVaR([-0.2], 0.95)).toBeCloseTo(0.2, 12)
  })
})

describe('summary', () => {
  const r = [0.02, -0.01, 0.03, -0.02, 0.01, 0.015, -0.005, 0.004]

  it('junta todo con k explícito y cuenta los periodos positivos', () => {
    const s = summary(r, { k: 52, rf: 0 })
    expect(s.n).toBe(8)
    expect(s.years).toBeCloseTo(8 / 52, 12)
    expect(s.cagr).toBeCloseTo(cagrFromReturns(r, 52), 12)
    expect(s.vol).toBeCloseTo(annualizedVol(r, 52), 12)
    expect(s.sharpe).toBeCloseTo(sharpe(r, 0, 52), 12)
    expect(s.best).toBe(0.03)
    expect(s.worst).toBe(-0.02)
    expect(s.positivePct).toBeCloseTo(5 / 8, 12)
  })

  it('un campo que no se puede calcular sale en null sin tumbar el resto', () => {
    const subiendo = [0.01, 0.02, 0.015]
    const s = summary(subiendo, { k: 52, rf: 0 })
    expect(s.maxDrawdown).toBe(0)
    expect(s.calmar).toBeNull()
    expect(s.sortino).toBeNull()
    expect(s.cagr).not.toBeNull()
  })

  it('pide dos periodos y rechaza NaN', () => {
    expect(summary([0.01], { k: 52 })).toBeNull()
    expect(summary([0.01, NaN], { k: 52 })).toBeNull()
    expect(summary([], { k: 52 })).toBeNull()
    expect(summary([0.01, 0.02], { k: 0 })).toBeNull()
  })

  it('sin k no se supone ninguno: devuelve null', () => {
    expect(summary(r)).toBeNull()
    expect(summary(r, null)).toBeNull()
    expect(summary(r, {})).toBeNull()
    expect(summary(r, { rf: 0 })).toBeNull()
  })

  // `Math.max(...r)` reventaba el límite de argumentos del motor arriba de unos 100 mil puntos.
  // Una serie así sale de un Monte Carlo o de un walk-forward largo, no de un instrumento.
  it('una serie larguísima no revienta el límite de argumentos', () => {
    const larga = Array.from({ length: 200000 }, (_, i) => ((i % 7) - 3) / 100)
    larga[123] = 0.5
    larga[456] = -0.4
    const s = summary(larga, { k: 252 })
    expect(s).not.toBeNull()
    expect(s.best).toBeCloseTo(0.5, 12)
    expect(s.worst).toBeCloseTo(-0.4, 12)
    expect(s.n).toBe(200000)
  })
})

describe('percentile', () => {
  it('ordena antes de interpolar', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 0)).toBe(1)
  })

  it('vacío o sucio devuelve null', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(percentile([1, NaN], 0.5)).toBeNull()
  })
})

describe('golden de numpy y scipy', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})
