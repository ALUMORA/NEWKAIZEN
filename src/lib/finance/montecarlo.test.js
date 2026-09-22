import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import {
  fromMessage,
  handleWorkerRequest,
  lognormalParams,
  perStepParams,
  quantilesOf,
  simulate,
  toMessage,
} from './montecarlo.js'

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../tests/golden/montecarlo.json', import.meta.url)), 'utf8'),
)

/**
 * @param {string} kind
 * @returns {any[]}
 */
function casesOf(kind) {
  return golden.cases.filter((/** @type {any} */ c) => c.kind === kind)
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol tolerancia relativa
 */
function closeEnough(actual, expected, tol) {
  if (tol === 0) {
    expect(actual).toBe(expected)
    return
  }
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)))
}

// 1 % mensual compuesto a un año: es el mu anual que deja ℓ = ln(1.01) en cada paso mensual.
const MU_1PCT_MENSUAL = Math.pow(1.01, 12) - 1

/** Plan base de la respuesta conocida: 100,000 iniciales y 5,000 al inicio de cada mes. */
const PLAN_BASE = {
  initial: 100000,
  contribution: 5000,
  contributionFrequency: /** @type {const} */ ('monthly'),
  contributionGrowth: 0,
  years: 1,
  stepsPerYear: 12,
  mu: MU_1PCT_MENSUAL,
  sigma: 0,
  inflation: 0,
  paths: 11,
  seed: 'prueba',
}

describe('lognormalParams', () => {
  it('respuesta conocida: m = 8 %, s = 15 %', () => {
    const p = lognormalParams(0.08, 0.15)
    expect(p).not.toBeNull()
    expect(p.mu).toBeCloseTo(0.0674078, 7)
    expect(p.sigma).toBeCloseTo(0.138226, 6)
    expect(p.mu).toBeCloseTo(0.06740782733107573, 12)
    expect(p.sigma).toBeCloseTo(0.13822600193200027, 12)
  })

  it('sin volatilidad, mu es el logaritmo del bruto', () => {
    const p = lognormalParams(0.08, 0)
    expect(p.sigma).toBe(0)
    expect(p.mu).toBeCloseTo(Math.log(1.08), 15)
  })

  it('con m = 0 y s = 0 los dos parámetros son cero', () => {
    expect(lognormalParams(0, 0)).toEqual({ mu: 0, sigma: 0 })
  })

  it('devuelve null cuando la pérdida es total o peor (m ≤ −1)', () => {
    expect(lognormalParams(-1, 0.1)).toBeNull()
    expect(lognormalParams(-1.5, 0.1)).toBeNull()
  })

  it('rechaza entradas que no son números finitos', () => {
    expect(() => lognormalParams(Number.NaN, 0.1)).toThrow(/número finito/)
    expect(() => lognormalParams(0.08, Number.NaN)).toThrow(/número finito/)
    expect(() => lognormalParams(Infinity, 0.1)).toThrow(/número finito/)
    expect(() => lognormalParams(/** @type {any} */ ('0.08'), 0.1)).toThrow(/número finito/)
    expect(() => lognormalParams(0.08, -0.01)).toThrow(/negativa/)
  })

  it.each(casesOf('lognormalParams'))('$name', (testCase) => {
    const p = lognormalParams(testCase.input.m, testCase.input.s)
    closeEnough(p.mu, testCase.expected.mu, testCase.tol)
    closeEnough(p.sigma, testCase.expected.sigma, testCase.tol)
  })
})

describe('perStepParams', () => {
  it('escala la deriva entre k y la volatilidad entre la raíz de k', () => {
    const anual = lognormalParams(0.08, 0.15)
    const paso = perStepParams(0.08, 0.15, 12)
    expect(paso.mu).toBeCloseTo(anual.mu / 12, 15)
    expect(paso.sigma).toBeCloseTo(anual.sigma / Math.sqrt(12), 15)
    expect(paso.annual).toEqual(anual)
  })

  it('rechaza pasos por año que no son enteros positivos', () => {
    expect(() => perStepParams(0.08, 0.15, 0)).toThrow(/entero mayor o igual a 1/)
    expect(() => perStepParams(0.08, 0.15, 2.5)).toThrow(/entero mayor o igual a 1/)
    expect(() => perStepParams(0.08, 0.15, Number.NaN)).toThrow(/número finito/)
  })

  it('devuelve null cuando la lognormal no existe', () => {
    expect(perStepParams(-1.2, 0.1, 12)).toBeNull()
  })

  it.each(casesOf('perStepParams'))('$name', (testCase) => {
    const p = perStepParams(testCase.input.m, testCase.input.s, testCase.input.stepsPerYear)
    closeEnough(p.mu, testCase.expected.mu, testCase.tol)
    closeEnough(p.sigma, testCase.expected.sigma, testCase.tol)
  })
})

describe('quantilesOf', () => {
  it('con un solo valor los cinco percentiles son ese valor', () => {
    expect(quantilesOf([7])).toEqual({ p5: 7, p25: 7, p50: 7, p75: 7, p95: 7 })
  })

  it('devuelve null con el arreglo vacío', () => {
    expect(quantilesOf([])).toBeNull()
    expect(quantilesOf(null)).toBeNull()
  })

  it('no modifica el arreglo que recibe', () => {
    const values = [5, 1, 4, 2, 3]
    quantilesOf(values)
    expect(values).toEqual([5, 1, 4, 2, 3])
  })

  it('rechaza valores que no son finitos', () => {
    expect(() => quantilesOf([1, Number.NaN, 3])).toThrow(/número finito/)
    expect(() => quantilesOf([1, Infinity])).toThrow(/número finito/)
  })

  it('coincide con ordenar e interpolar, en muestras aleatorias', () => {
    // Referencia directa: ordenar todo y aplicar el cuantil tipo 7. La selección múltiple del
    // módulo tiene que dar exactamente lo mismo, incluso con empates y con n chicos.
    let state = 123456789
    const next = () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
    for (const n of [1, 2, 3, 4, 5, 9, 17, 20, 101, 997]) {
      for (let round = 0; round < 3; round += 1) {
        const values = Array.from({ length: n }, () => Math.round(next() * 1000) / 7)
        const sorted = [...values].sort((a, b) => a - b)
        /** @param {number} q */
        const ref = (q) => {
          const h = (n - 1) * q
          const lo = Math.floor(h)
          const hi = Math.min(lo + 1, n - 1)
          return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
        }
        const got = quantilesOf(values)
        expect(got.p5).toBeCloseTo(ref(0.05), 12)
        expect(got.p25).toBeCloseTo(ref(0.25), 12)
        expect(got.p50).toBeCloseTo(ref(0.5), 12)
        expect(got.p75).toBeCloseTo(ref(0.75), 12)
        expect(got.p95).toBeCloseTo(ref(0.95), 12)
      }
    }
  })

  it('aguanta muestras ya ordenadas y con muchos empates', () => {
    const asc = Array.from({ length: 500 }, (_, i) => i)
    expect(quantilesOf(asc).p50).toBeCloseTo(249.5, 12)
    const desc = [...asc].reverse()
    expect(quantilesOf(desc).p50).toBeCloseTo(249.5, 12)
    const empates = new Array(300).fill(42)
    expect(quantilesOf(empates)).toEqual({ p5: 42, p25: 42, p50: 42, p75: 42, p95: 42 })
  })

  it.each(casesOf('quantiles'))('$name', (testCase) => {
    const got = quantilesOf(testCase.input.values)
    for (const key of ['p5', 'p25', 'p50', 'p75', 'p95']) {
      closeEnough(got[key], testCase.expected[key], testCase.tol)
    }
  })
})

describe('simulate: respuestas conocidas sin volatilidad', () => {
  it('aportación constante termina en 176,729.14', () => {
    const sim = simulate(PLAN_BASE)
    expect(sim.steps).toBe(12)
    expect(sim.terminal.p50).toBeCloseTo(176729.14322984172, 6)
    // Sin volatilidad todas las trayectorias son la misma, así que los cinco percentiles coinciden.
    for (const key of ['p5', 'p25', 'p50', 'p75', 'p95']) {
      expect(sim.terminal[key]).toBeCloseTo(176729.14322984172, 6)
      expect(sim.percentiles[key][12]).toBeCloseTo(176729.14322984172, 6)
    }
    expect(sim.contributedTotal).toBe(160000)
  })

  it('aportación que crece 1 % al mes termina en 180,292.00', () => {
    const sim = simulate({ ...PLAN_BASE, contributionGrowth: MU_1PCT_MENSUAL })
    expect(sim.terminal.p50).toBeCloseTo(180292.00482111517, 6)
    expect(sim.terminal.min).toBeCloseTo(180292.00482111517, 6)
    expect(sim.terminal.max).toBeCloseTo(180292.00482111517, 6)
  })

  it('la trayectoria arranca en el saldo inicial y crece mes a mes', () => {
    const sim = simulate(PLAN_BASE)
    expect(sim.percentiles.p50).toHaveLength(13)
    expect(sim.percentiles.p50[0]).toBe(100000)
    // Primer mes: (100,000 + 5,000) · 1.01
    expect(sim.percentiles.p50[1]).toBeCloseTo(106050, 8)
    for (let t = 1; t <= 12; t += 1) {
      expect(sim.percentiles.p50[t]).toBeGreaterThan(sim.percentiles.p50[t - 1])
    }
  })

  it('con aportación anual solo se aporta una vez al año', () => {
    const sim = simulate({
      ...PLAN_BASE,
      contributionFrequency: 'annual',
      contribution: 60000,
      years: 2,
    })
    // contributed[t] es lo que se lleva aportado ANTES del saldo del paso t, así que la segunda
    // aportación (paso 12) aparece en contributed[13].
    expect(sim.steps).toBe(24)
    expect(sim.contributedTotal).toBe(100000 + 60000 * 2)
    expect(sim.contributed[0]).toBe(100000)
    expect(sim.contributed[1]).toBe(160000)
    expect(sim.contributed[12]).toBe(160000)
    expect(sim.contributed[13]).toBe(220000)
    expect(sim.contributed[24]).toBe(220000)
  })

  it.each(casesOf('simulateDeterministic'))('$name', (testCase) => {
    const sim = simulate(testCase.input)
    expect(sim).not.toBeNull()
    closeEnough(sim.terminal.p50, testCase.expected.terminal, testCase.tol)
    closeEnough(sim.terminalReal.p50, testCase.expected.terminalReal, testCase.tol)
    closeEnough(sim.contributedTotal, testCase.expected.contributedTotal, testCase.tol)
    expect(sim.percentiles.p50).toHaveLength(testCase.expected.p50.length)
    for (let t = 0; t < testCase.expected.p50.length; t += 1) {
      closeEnough(sim.percentiles.p50[t], testCase.expected.p50[t], testCase.tol)
    }
  })
})

describe('simulate: forma del resultado', () => {
  const sim = simulate({
    initial: 50000,
    contribution: 2000,
    years: 5,
    stepsPerYear: 12,
    mu: 0.08,
    sigma: 0.15,
    inflation: 0.04,
    paths: 2000,
    seed: 'forma',
    samplePaths: 3,
  })

  it('devuelve bandas de largo steps + 1 en orden creciente de percentil', () => {
    expect(sim.steps).toBe(60)
    for (const key of ['p5', 'p25', 'p50', 'p75', 'p95']) {
      expect(sim.percentiles[key]).toHaveLength(61)
      expect(sim.percentilesReal[key]).toHaveLength(61)
    }
    for (let t = 0; t <= 60; t += 1) {
      expect(sim.percentiles.p5[t]).toBeLessThanOrEqual(sim.percentiles.p25[t])
      expect(sim.percentiles.p25[t]).toBeLessThanOrEqual(sim.percentiles.p50[t])
      expect(sim.percentiles.p50[t]).toBeLessThanOrEqual(sim.percentiles.p75[t])
      expect(sim.percentiles.p75[t]).toBeLessThanOrEqual(sim.percentiles.p95[t])
    }
  })

  it('los percentiles reales son los nominales deflactados', () => {
    expect(sim.deflators[0]).toBe(1)
    expect(sim.deflators[60]).toBeCloseTo(Math.pow(1.04, 5), 12)
    for (let t = 0; t <= 60; t += 1) {
      expect(sim.percentilesReal.p50[t]).toBeCloseTo(sim.percentiles.p50[t] / sim.deflators[t], 9)
    }
    expect(sim.terminalReal.p50).toBeCloseTo(sim.terminal.p50 / sim.deflators[60], 9)
  })

  it('los percentiles del cierre cuadran con ordenar las 2,000 terminales', () => {
    const sorted = Array.from(sim.terminalSorted)
    for (let i = 1; i < sorted.length; i += 1) expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i - 1])
    const ref = quantilesOf(sorted)
    for (const key of ['p5', 'p25', 'p50', 'p75', 'p95']) {
      expect(sim.percentiles[key][60]).toBeCloseTo(ref[key], 9)
      expect(sim.terminal[key]).toBeCloseTo(ref[key], 9)
    }
  })

  it('el resumen terminal usa varianza muestral (n − 1)', () => {
    const values = Array.from(sim.terminalSorted)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
    expect(sim.terminal.mean).toBeCloseTo(mean, 6)
    expect(sim.terminal.sd).toBeCloseTo(Math.sqrt(variance), 6)
    expect(sim.terminal.min).toBe(values[0])
    expect(sim.terminal.max).toBe(values[values.length - 1])
  })

  it('devuelve las trayectorias de muestra que se le piden y ninguna más', () => {
    expect(sim.samples).toHaveLength(3)
    for (const path of sim.samples) {
      expect(path).toHaveLength(61)
      expect(path[0]).toBe(50000)
      for (const value of path) expect(Number.isFinite(value)).toBe(true)
    }
    const sinMuestras = simulate({ ...PLAN_BASE, paths: 5 })
    expect(sinMuestras.samples).toEqual([])
  })

  it('reporta los parámetros que de verdad usó', () => {
    expect(sim.stepsPerYear).toBe(12)
    expect(sim.paths).toBe(2000)
    expect(sim.method).toBe('lognormal')
    expect(sim.annual).toEqual(lognormalParams(0.08, 0.15))
    expect(sim.perStep.mu).toBeCloseTo(sim.annual.mu / 12, 15)
  })

  it('con la desviación muestral n − 1, una sola trayectoria deja sd en null', () => {
    const uno = simulate({ ...PLAN_BASE, paths: 1 })
    expect(uno.terminal.sd).toBeNull()
  })
})

describe('simulate: probabilidad de llegar', () => {
  it('cuenta las trayectorias que terminan en la meta o arriba', () => {
    const sim = simulate(PLAN_BASE)
    expect(sim.probabilityAbove(176000)).toBe(1)
    expect(sim.probabilityAbove(177000)).toBe(0)
    // "o más": la meta exacta cuenta como alcanzada.
    expect(sim.probabilityAbove(sim.terminalSorted[0])).toBe(1)
  })

  it('con volatilidad queda entre 0 y 1 y baja al subir la meta', () => {
    const sim = simulate({
      initial: 100000,
      contribution: 3000,
      years: 10,
      stepsPerYear: 12,
      mu: 0.08,
      sigma: 0.15,
      paths: 4000,
      seed: 'probabilidad',
    })
    const baja = sim.probabilityAbove(500000)
    const alta = sim.probabilityAbove(1500000)
    expect(baja).toBeGreaterThan(alta)
    expect(baja).toBeLessThanOrEqual(1)
    expect(alta).toBeGreaterThanOrEqual(0)
  })

  it('la meta real se compara contra el saldo deflactado', () => {
    const sim = simulate({ ...PLAN_BASE, inflation: 0.05 })
    const realTerminal = sim.terminalReal.p50
    expect(sim.probabilityAbove(realTerminal - 1, { real: true })).toBe(1)
    expect(sim.probabilityAbove(realTerminal + 1, { real: true })).toBe(0)
    // La misma meta sin deflactar sí se alcanza en términos nominales.
    expect(sim.probabilityAbove(realTerminal + 1, { real: false })).toBe(1)
  })

  it('devuelve null si la meta no es un número finito', () => {
    const sim = simulate({ ...PLAN_BASE, paths: 3 })
    expect(sim.probabilityAbove(Number.NaN)).toBeNull()
    expect(sim.probabilityAbove(/** @type {any} */ ('100000'))).toBeNull()
  })
})

describe('simulate: determinismo', () => {
  const opciones = {
    initial: 10000,
    contribution: 500,
    years: 3,
    stepsPerYear: 12,
    mu: 0.09,
    sigma: 0.18,
    paths: 500,
    seed: 'igualito',
  }

  it('la misma semilla da exactamente el mismo resultado', () => {
    const a = simulate(opciones)
    const b = simulate(opciones)
    expect(Array.from(a.terminalSorted)).toEqual(Array.from(b.terminalSorted))
    expect(a.percentiles.p50).toEqual(b.percentiles.p50)
  })

  it('otra semilla da otro resultado', () => {
    const a = simulate(opciones)
    const b = simulate({ ...opciones, seed: 'otra' })
    expect(a.percentiles.p50).not.toEqual(b.percentiles.p50)
  })

  it('la semilla puede ser número o texto y da lo mismo', () => {
    const a = simulate({ ...opciones, seed: 7 })
    const b = simulate({ ...opciones, seed: '7' })
    expect(a.percentiles.p95).toEqual(b.percentiles.p95)
  })
})

describe('simulate: bootstrap por bloques', () => {
  const history = [0.03, -0.02, 0.01, 0.04, -0.05, 0.02, 0.015, -0.01, 0.025, 0.005, -0.03, 0.012]

  it('usa solo rendimientos de la historia', () => {
    const sim = simulate({
      initial: 1000,
      contribution: 0,
      years: 1,
      stepsPerYear: 12,
      method: 'bootstrap',
      history,
      blockSize: 3,
      paths: 300,
      seed: 'bloques',
    })
    expect(sim.method).toBe('bootstrap')
    expect(sim.perStep).toBeNull()
    expect(sim.annual).toBeNull()
    // Cota: 12 pasos, cada uno entre el peor y el mejor rendimiento de la historia.
    const peor = 1000 * Math.pow(1 + Math.min(...history), 12)
    const mejor = 1000 * Math.pow(1 + Math.max(...history), 12)
    expect(sim.terminal.min).toBeGreaterThanOrEqual(peor - 1e-9)
    expect(sim.terminal.max).toBeLessThanOrEqual(mejor + 1e-9)
  })

  it('devuelve null cuando la historia no alcanza para un bloque', () => {
    expect(simulate({ years: 1, method: 'bootstrap', history: [], paths: 10 })).toBeNull()
    expect(simulate({ years: 1, method: 'bootstrap', history: [0.01], paths: 10 })).toBeNull()
    expect(
      simulate({ years: 1, method: 'bootstrap', history: [0.01, 0.02, 0.03], blockSize: 6, paths: 10 }),
    ).toBeNull()
    expect(simulate({ years: 1, method: 'bootstrap', history: null, paths: 10 })).toBeNull()
  })

  it('rechaza historia con valores no finitos o con pérdida total', () => {
    expect(() => simulate({ years: 1, method: 'bootstrap', history: [0.01, Number.NaN, 0.02] })).toThrow(
      /número finito/,
    )
    expect(() => simulate({ years: 1, method: 'bootstrap', history: [0.01, -1, 0.02] })).toThrow(/−100 %/)
    expect(() => simulate({ years: 1, method: 'bootstrap', history: [0.01, -1.5, 0.02, 0.03, 0.04, 0.05] })).toThrow(
      /−100 %/,
    )
    expect(() => simulate({ years: 1, method: 'bootstrap', history, blockSize: 0 })).toThrow(
      /entero mayor o igual a 1/,
    )
  })
})

describe('simulate: casos límite y validación', () => {
  it('el saldo nunca queda negativo', () => {
    const sim = simulate({
      initial: 1000,
      contribution: 0,
      years: 30,
      stepsPerYear: 12,
      mu: -0.5,
      sigma: 0.9,
      paths: 500,
      seed: 'caida',
    })
    expect(sim.terminal.min).toBeGreaterThanOrEqual(0)
    for (let t = 0; t <= sim.steps; t += 1) expect(sim.percentiles.p5[t]).toBeGreaterThanOrEqual(0)
  })

  it('sin aportación ni saldo inicial, todo queda en cero', () => {
    const sim = simulate({ initial: 0, contribution: 0, years: 2, mu: 0.08, sigma: 0.15, paths: 50 })
    expect(sim.terminal.max).toBe(0)
    expect(sim.contributedTotal).toBe(0)
  })

  it('con un solo paso hace un solo periodo', () => {
    const sim = simulate({ ...PLAN_BASE, years: 1, stepsPerYear: 1, contributionFrequency: 'annual' })
    expect(sim.steps).toBe(1)
    expect(sim.percentiles.p50).toHaveLength(2)
    expect(sim.percentiles.p50[1]).toBeCloseTo((100000 + 5000) * (1 + MU_1PCT_MENSUAL), 6)
  })

  it('devuelve null cuando no hay ni un paso que simular', () => {
    expect(simulate({ ...PLAN_BASE, years: 0 })).toBeNull()
    expect(simulate({ ...PLAN_BASE, years: -3 })).toBeNull()
    expect(simulate({ ...PLAN_BASE, years: 0.04, stepsPerYear: 12 })).toBeNull()
  })

  it('devuelve null cuando la lognormal no existe', () => {
    expect(simulate({ ...PLAN_BASE, mu: -1 })).toBeNull()
    expect(simulate({ ...PLAN_BASE, mu: -2 })).toBeNull()
  })

  it('rechaza entradas que no son números finitos', () => {
    expect(() => simulate({ ...PLAN_BASE, years: Number.NaN })).toThrow(/número finito/)
    expect(() => simulate({ ...PLAN_BASE, initial: Number.NaN })).toThrow(/número finito/)
    expect(() => simulate({ ...PLAN_BASE, contribution: Infinity })).toThrow(/número finito/)
    expect(() => simulate({ ...PLAN_BASE, mu: Number.NaN })).toThrow(/número finito/)
    expect(() => simulate({ ...PLAN_BASE, sigma: Number.NaN })).toThrow(/número finito/)
    expect(() => simulate({ ...PLAN_BASE, inflation: Number.NaN })).toThrow(/número finito/)
    expect(() => simulate(/** @type {any} */ (null))).toThrow(/objeto de opciones/)
  })

  it('rechaza parámetros fuera de rango', () => {
    expect(() => simulate({ ...PLAN_BASE, initial: -1 })).toThrow(/initial no puede ser negativo/)
    expect(() => simulate({ ...PLAN_BASE, sigma: -0.1 })).toThrow(/negativa/)
    expect(() => simulate({ ...PLAN_BASE, inflation: -1 })).toThrow(/mayor que −1/)
    expect(() => simulate({ ...PLAN_BASE, contributionGrowth: -1 })).toThrow(/mayor que −1/)
    expect(() => simulate({ ...PLAN_BASE, paths: 0 })).toThrow(/entero mayor o igual a 1/)
    expect(() => simulate({ ...PLAN_BASE, paths: 2.5 })).toThrow(/entero mayor o igual a 1/)
    expect(() => simulate({ ...PLAN_BASE, stepsPerYear: 0 })).toThrow(/entero mayor o igual a 1/)
    expect(() => simulate({ ...PLAN_BASE, method: /** @type {any} */ ('normal') })).toThrow(
      /lognormal.*bootstrap/,
    )
    expect(() =>
      simulate({ ...PLAN_BASE, contributionFrequency: /** @type {any} */ ('semanal') }),
    ).toThrow(/monthly.*annual/)
  })

  it('exige que los pasos por año cuadren con la frecuencia de aportación', () => {
    expect(() => simulate({ ...PLAN_BASE, stepsPerYear: 5 })).toThrow(/múltiplo de 12/)
    expect(() => simulate({ ...PLAN_BASE, stepsPerYear: 52 })).toThrow(/múltiplo de 12/)
    // Anual sí acepta cualquier número de pasos por año.
    expect(simulate({ ...PLAN_BASE, stepsPerYear: 52, contributionFrequency: 'annual' })).not.toBeNull()
  })

  it('sin contributionGrowth las aportaciones siguen a la inflación', () => {
    const conInflacion = simulate({ ...PLAN_BASE, inflation: 0.06, contributionGrowth: null })
    const explicito = simulate({ ...PLAN_BASE, inflation: 0.06, contributionGrowth: 0.06 })
    expect(conInflacion.contributedTotal).toBeCloseTo(explicito.contributedTotal, 9)
    const sinCrecimiento = simulate({ ...PLAN_BASE, inflation: 0.06, contributionGrowth: 0 })
    expect(conInflacion.contributedTotal).toBeGreaterThan(sinCrecimiento.contributedTotal)
  })
})

describe('ida y vuelta por el Web Worker', () => {
  it('toMessage quita la función y fromMessage la devuelve igual', () => {
    const sim = simulate({ ...PLAN_BASE, paths: 50, sigma: 0.12, seed: 'worker' })
    const esperado = {
      p50: [...sim.percentiles.p50],
      terminal: sim.terminal.p50,
      probabilidad: sim.probabilityAbove(150000),
      probabilidadReal: sim.probabilityAbove(150000, { real: true }),
    }
    const { payload, transfer } = toMessage(sim)
    expect(payload.probabilityAbove).toBeUndefined()
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).toBeInstanceOf(ArrayBuffer)

    // structuredClone es lo mismo que hace postMessage sin transferencia.
    const vuelta = fromMessage(structuredClone(payload))
    expect(vuelta.percentiles.p50).toEqual(esperado.p50)
    expect(vuelta.terminal.p50).toBe(esperado.terminal)
    expect(vuelta.terminalSorted).toBeInstanceOf(Float64Array)
    expect(typeof vuelta.probabilityAbove).toBe('function')
    expect(vuelta.probabilityAbove(150000)).toBe(esperado.probabilidad)
    expect(vuelta.probabilityAbove(150000, { real: true })).toBe(esperado.probabilidadReal)
    expect(vuelta.probabilityAbove(Number.NaN)).toBeNull()
  })

  it('toMessage y fromMessage aguantan el null de "no alcanzan los datos"', () => {
    expect(toMessage(null)).toEqual({ payload: null, transfer: [] })
    expect(fromMessage(null)).toBeNull()
    expect(fromMessage(undefined)).toBeNull()
  })

  it('handleWorkerRequest contesta con el id y con el error en español', () => {
    const ok = handleWorkerRequest({ id: 'abc', options: { ...PLAN_BASE, paths: 4 } })
    expect(ok.message.id).toBe('abc')
    expect(ok.message.ok).toBe(true)
    expect(fromMessage(ok.message.result).terminal.p50).toBeCloseTo(176729.14322984172, 6)

    const nulo = handleWorkerRequest({ id: 'def', options: { ...PLAN_BASE, years: 0 } })
    expect(nulo.message.ok).toBe(true)
    expect(nulo.message.result).toBeNull()

    const malo = handleWorkerRequest({ id: 'ghi', options: { ...PLAN_BASE, paths: -1 } })
    expect(malo.message.ok).toBe(false)
    expect(malo.message.error).toMatch(/entero mayor o igual a 1/)
    expect(malo.transfer).toEqual([])

    const sinNada = handleWorkerRequest(null)
    expect(sinNada.message.ok).toBe(false)
    expect(sinNada.message.error).toMatch(/objeto de opciones/)
  })

  it('el archivo del worker escucha mensajes y contesta de verdad', async () => {
    /** @type {any[]} */
    const listeners = []
    /** @type {any[]} */
    const enviados = []
    vi.stubGlobal('self', {
      /** @param {string} type @param {any} fn */
      addEventListener(type, fn) {
        if (type === 'message') listeners.push(fn)
      },
      /** @param {any} message @param {any} transfer */
      postMessage(message, transfer) {
        enviados.push({ message, transfer })
      },
    })
    await import('./montecarlo.worker.js')
    expect(listeners).toHaveLength(1)

    listeners[0]({ data: { id: 7, options: { ...PLAN_BASE, paths: 4 } } })
    expect(enviados).toHaveLength(1)
    expect(enviados[0].message.id).toBe(7)
    expect(enviados[0].message.ok).toBe(true)
    expect(enviados[0].transfer).toHaveLength(1)
    const sim = fromMessage(enviados[0].message.result)
    expect(sim.terminal.p50).toBeCloseTo(176729.14322984172, 6)
  })
})

describe('simulate: desempeño', () => {
  // Objetivo del spec: 10,000 trayectorias por 360 pasos en menos de 400 ms en node. Se toma el
  // mejor de tres para no medir el ruido de la máquina ni el calentamiento del JIT.
  it('10,000 trayectorias por 360 pasos en menos de 400 ms', () => {
    const opciones = {
      initial: 100000,
      contribution: 5000,
      contributionFrequency: /** @type {const} */ ('monthly'),
      years: 30,
      stepsPerYear: 12,
      mu: 0.08,
      sigma: 0.15,
      inflation: 0.04,
      paths: 10000,
      seed: 'desempeño',
    }
    simulate({ ...opciones, paths: 1000, years: 3 }) // calentamiento
    let best = Infinity
    for (let i = 0; i < 3; i += 1) {
      const t0 = performance.now()
      const sim = simulate(opciones)
      const elapsed = performance.now() - t0
      expect(sim.steps).toBe(360)
      if (elapsed < best) best = elapsed
    }
    expect(best).toBeLessThan(400)
  })
})
