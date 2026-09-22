import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { DEFAULT_SEED, createRng, hashSeed } from './rng.js'

// Las secuencias de referencia las escribe scripts/golden/montecarlo_golden.py, que reimplementa
// xoshiro128** con enteros de Python (exactos). Si el JS se equivoca en una rotación, en un
// Math.imul o en el sembrado, estas pruebas lo cachan.
const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../tests/golden/montecarlo.json', import.meta.url)), 'utf8'),
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

describe('hashSeed', () => {
  it('coincide con la referencia de Python', () => {
    const [testCase] = casesOf('hashSeed')
    expect(testCase).toBeTruthy()
    const actual = testCase.input.seeds.map((/** @type {string} */ s) => hashSeed(s))
    expect(actual).toEqual(testCase.expected)
  })

  it('trata null y undefined como la cadena vacía', () => {
    expect(hashSeed(null)).toBe(hashSeed(''))
    expect(hashSeed(undefined)).toBe(hashSeed(''))
  })

  it('separa semillas parecidas', () => {
    expect(hashSeed('kaizen1')).not.toBe(hashSeed('kaizen2'))
    expect(hashSeed('meta-1')).not.toBe(hashSeed('meta-2'))
  })

  it('siempre devuelve un entero sin signo de 32 bits', () => {
    for (const seed of ['', 'a', 'ñ', 'portafolio de Ana', '0', '999999999']) {
      const h = hashSeed(seed)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(2 ** 32)
    }
  })
})

describe('createRng: secuencias contra la referencia', () => {
  it.each(casesOf('rngUint32'))('$name', (testCase) => {
    const rng = createRng(testCase.input.seed)
    const actual = Array.from({ length: testCase.input.n }, () => rng.nextUint32())
    expect(actual).toEqual(testCase.expected)
  })

  it.each(casesOf('rngUniform'))('$name', (testCase) => {
    const rng = createRng(testCase.input.seed)
    const actual = Array.from({ length: testCase.input.n }, () => rng.uniform())
    expect(actual).toEqual(testCase.expected)
  })

  it.each(casesOf('rngNormal'))('$name', (testCase) => {
    const rng = createRng(testCase.input.seed)
    for (let i = 0; i < testCase.input.n; i += 1) {
      closeEnough(rng.normal(), testCase.expected[i], testCase.tol)
    }
  })

  it.each(casesOf('rngInt'))('$name', (testCase) => {
    const rng = createRng(testCase.input.seed)
    const actual = Array.from({ length: testCase.input.n }, () => rng.int(testCase.input.max))
    expect(actual).toEqual(testCase.expected)
  })
})

describe('createRng: determinismo', () => {
  it('dos generadores con la misma semilla dan la misma secuencia', () => {
    const a = createRng('meta-casa')
    const b = createRng('meta-casa')
    for (let i = 0; i < 50; i += 1) {
      expect(a.nextUint32()).toBe(b.nextUint32())
      expect(a.normal()).toBe(b.normal())
    }
  })

  it('semillas distintas dan secuencias distintas', () => {
    const a = createRng('meta-casa')
    const b = createRng('meta-coche')
    const seqA = Array.from({ length: 20 }, () => a.nextUint32())
    const seqB = Array.from({ length: 20 }, () => b.nextUint32())
    expect(seqA).not.toEqual(seqB)
  })

  it('reset() regresa al estado inicial, incluida la caché de Box-Muller', () => {
    const rng = createRng('reinicio')
    const first = [rng.normal(), rng.normal(), rng.normal(), rng.uniform()]
    rng.reset()
    const second = [rng.normal(), rng.normal(), rng.normal(), rng.uniform()]
    expect(second).toEqual(first)
  })

  it('un número y su texto son la misma semilla', () => {
    expect(createRng(42).nextUint32()).toBe(createRng('42').nextUint32())
  })

  it('sin semilla usa DEFAULT_SEED', () => {
    expect(createRng().seed).toBe(DEFAULT_SEED)
    expect(createRng().nextUint32()).toBe(createRng(DEFAULT_SEED).nextUint32())
  })
})

describe('createRng: rangos y validación', () => {
  it('uniform() cae en [0, 1)', () => {
    const rng = createRng('rango')
    for (let i = 0; i < 20000; i += 1) {
      const u = rng.uniform()
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('nextUint32() cae en [0, 2^32)', () => {
    const rng = createRng('rango')
    for (let i = 0; i < 5000; i += 1) {
      const x = rng.nextUint32()
      expect(Number.isInteger(x)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(2 ** 32)
    }
  })

  it('int(max) cae en [0, max) y cubre todos los valores', () => {
    const rng = createRng('dados')
    const seen = new Set()
    for (let i = 0; i < 3000; i += 1) {
      const v = rng.int(6)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
      seen.add(v)
    }
    expect(seen.size).toBe(6)
  })

  it('int() rechaza máximos inválidos', () => {
    const rng = createRng('dados')
    expect(() => rng.int(0)).toThrow(/mayor que cero/)
    expect(() => rng.int(-3)).toThrow(/mayor que cero/)
    expect(() => rng.int(Number.NaN)).toThrow(/mayor que cero/)
    expect(() => rng.int(2 ** 33)).toThrow(/2\^32/)
  })

  it('normals(n) es lo mismo que n llamadas a normal()', () => {
    const a = createRng('lote')
    const b = createRng('lote')
    const lote = a.normals(7)
    expect(lote).toBeInstanceOf(Float64Array)
    expect(lote.length).toBe(7)
    for (let i = 0; i < 7; i += 1) expect(lote[i]).toBe(b.normal())
  })

  it('normals(0) devuelve un arreglo vacío y normals(-1) truena', () => {
    const rng = createRng('lote')
    expect(rng.normals(0).length).toBe(0)
    expect(() => rng.normals(-1)).toThrow(/mayor o igual a cero/)
    expect(() => rng.normals(Number.NaN)).toThrow(/mayor o igual a cero/)
  })
})

describe('createRng: calidad estadística', () => {
  it('las uniformes se reparten parejo', () => {
    const rng = createRng('estadistica')
    const n = 200000
    const buckets = new Array(10).fill(0)
    let sum = 0
    for (let i = 0; i < n; i += 1) {
      const u = rng.uniform()
      sum += u
      buckets[Math.min(9, Math.floor(u * 10))] += 1
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005)
    // Cada décima tiene que quedar cerca de n/10; ±3 % es holgado para 200 mil muestras.
    for (const count of buckets) {
      expect(Math.abs(count / n - 0.1)).toBeLessThan(0.003)
    }
  })

  it('las normales tienen media 0, desviación 1 y las colas de una normal', () => {
    const rng = createRng('estadistica')
    const n = 200000
    let sum = 0
    let sumSq = 0
    let within1 = 0
    let within2 = 0
    for (let i = 0; i < n; i += 1) {
      const z = rng.normal()
      sum += z
      sumSq += z * z
      if (Math.abs(z) <= 1) within1 += 1
      if (Math.abs(z) <= 2) within2 += 1
    }
    const mean = sum / n
    const sd = Math.sqrt(sumSq / n - mean * mean)
    expect(Math.abs(mean)).toBeLessThan(0.01)
    expect(Math.abs(sd - 1)).toBeLessThan(0.01)
    expect(Math.abs(within1 / n - 0.6827)).toBeLessThan(0.01)
    expect(Math.abs(within2 / n - 0.9545)).toBeLessThan(0.01)
  })

  it('ninguna normal sale NaN ni infinita', () => {
    const rng = createRng('sin-nan')
    for (let i = 0; i < 50000; i += 1) {
      expect(Number.isFinite(rng.normal())).toBe(true)
    }
  })
})
