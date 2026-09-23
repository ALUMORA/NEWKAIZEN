import { describe, expect, it } from 'vitest'

import {
  assertMatrix,
  assertSquare,
  assertVector,
  cholesky,
  dot,
  frobeniusNorm,
  identity,
  InvalidInputError,
  isFiniteMatrix,
  isFiniteNumber,
  isFiniteVector,
  isPositiveDefinite,
  isPositiveSemiDefinite,
  isSymmetric,
  jacobiEigen,
  largestEigenvalue,
  matmul,
  matVec,
  nearestPSD,
  quadForm,
  solveSPD,
  symmetrize,
  transpose,
  zeros,
  zerosMatrix,
} from './linalg.js'

describe('guardas de entrada', () => {
  it('isFiniteNumber distingue números de verdad', () => {
    expect(isFiniteNumber(1.5)).toBe(true)
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(Number.NaN)).toBe(false)
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isFiniteNumber(/** @type {any} */ ('1.5'))).toBe(false)
    expect(isFiniteNumber(/** @type {any} */ (null))).toBe(false)
    expect(isFiniteNumber(/** @type {any} */ (true))).toBe(false)
  })

  it('isFiniteVector e isFiniteMatrix rechazan vacíos, desparejos y NaN', () => {
    expect(isFiniteVector([1, 2])).toBe(true)
    expect(isFiniteVector([])).toBe(false)
    expect(isFiniteVector([1, Number.NaN])).toBe(false)
    expect(
      isFiniteMatrix([
        [1, 2],
        [3, 4],
      ]),
    ).toBe(true)
    expect(isFiniteMatrix([[1, 2], [3]])).toBe(false)
    expect(isFiniteMatrix([])).toBe(false)
    expect(isFiniteMatrix([[]])).toBe(false)
  })

  it('los assert lanzan InvalidInputError con mensaje en español y sin guiones largos', () => {
    for (const run of [
      () => assertVector([]),
      () => assertVector([1, Number.NaN]),
      () => assertMatrix([[1, 2], [3]]),
      () => assertSquare([[1, 2]]),
    ]) {
      expect(run).toThrow(InvalidInputError)
      try {
        run()
      } catch (err) {
        expect(/** @type {Error} */ (err).message).not.toMatch(/[—–]/)
        expect(/** @type {Error} */ (err).message).toMatch(/tiene|no es/)
      }
    }
  })

  it('assertVector y assertMatrix devuelven copias, no la misma referencia', () => {
    const v = [1, 2, 3]
    expect(assertVector(v)).not.toBe(v)
    const m = [
      [1, 2],
      [3, 4],
    ]
    const copy = assertMatrix(m)
    copy[0][0] = 99
    expect(m[0][0]).toBe(1)
  })
})

describe('operaciones básicas', () => {
  it('zeros, zerosMatrix e identity', () => {
    expect(zeros(3)).toEqual([0, 0, 0])
    expect(zerosMatrix(2, 3)).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ])
    expect(identity(2)).toEqual([
      [1, 0],
      [0, 1],
    ])
  })

  it('transpose', () => {
    expect(
      transpose([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ])
  })

  it('matmul con dimensiones que casan', () => {
    const a = [
      [1, 2],
      [3, 4],
    ]
    const b = [
      [5, 6],
      [7, 8],
    ]
    expect(matmul(a, b)).toEqual([
      [19, 22],
      [43, 50],
    ])
    expect(matmul(a, identity(2))).toEqual(a)
  })

  it('matmul rechaza dimensiones que no casan', () => {
    expect(() => matmul([[1, 2, 3]], [[1, 2]])).toThrow(InvalidInputError)
  })

  it('matVec y dot', () => {
    expect(
      matVec(
        [
          [1, 2],
          [3, 4],
        ],
        [5, 6],
      ),
    ).toEqual([17, 39])
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(() => dot([1, 2], [1, 2, 3])).toThrow(InvalidInputError)
    expect(() => matVec([[1, 2]], [1, 2, 3])).toThrow(InvalidInputError)
  })

  it('quadForm es la varianza del portafolio', () => {
    const cov = [
      [0.04, 0.006],
      [0.006, 0.09],
    ]
    const w = [0.6, 0.4]
    const expected = 0.6 * 0.6 * 0.04 + 2 * 0.6 * 0.4 * 0.006 + 0.4 * 0.4 * 0.09
    expect(quadForm(w, cov)).toBeCloseTo(expected, 15)
    expect(() => quadForm([1, 2, 3], cov)).toThrow(InvalidInputError)
  })

  it('symmetrize, isSymmetric y frobeniusNorm', () => {
    const a = [
      [1, 2],
      [4, 1],
    ]
    expect(isSymmetric(a)).toBe(false)
    expect(symmetrize(a)).toEqual([
      [1, 3],
      [3, 1],
    ])
    expect(isSymmetric(symmetrize(a))).toBe(true)
    expect(
      frobeniusNorm([
        [3, 0],
        [0, 4],
      ]),
    ).toBeCloseTo(5, 14)
  })
})

describe('cholesky y solveSPD', () => {
  const A = [
    [4, 12, -16],
    [12, 37, -43],
    [-16, -43, 98],
  ]

  it('factoriza el ejemplo clásico A = L Lᵀ', () => {
    const result = cholesky(A)
    expect(result).not.toBeNull()
    const { L } = /** @type {any} */ (result)
    expect(L[0][0]).toBeCloseTo(2, 12)
    expect(L[1][0]).toBeCloseTo(6, 12)
    expect(L[1][1]).toBeCloseTo(1, 12)
    expect(L[2][0]).toBeCloseTo(-8, 12)
    expect(L[2][1]).toBeCloseTo(5, 12)
    expect(L[2][2]).toBeCloseTo(3, 12)
    const reconstructed = matmul(L, transpose(L))
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) expect(reconstructed[i][j]).toBeCloseTo(A[i][j], 10)
    }
  })

  it('a una matriz semidefinida (con un eigenvalor cero) le pone jitter y sale adelante', () => {
    const singular = [
      [1, 1],
      [1, 1],
    ]
    const result = cholesky(singular)
    expect(result).not.toBeNull()
    expect(/** @type {any} */ (result).jitter).toBeGreaterThan(0)
  })

  it('devuelve null si ni con jitter se puede (matriz claramente indefinida)', () => {
    expect(cholesky([[-1]], { maxAttempts: 4 })).toBeNull()
  })

  it('devuelve null si la matriz no es simétrica', () => {
    expect(
      cholesky([
        [4, 1],
        [9, 3],
      ]),
    ).toBeNull()
  })

  it('isPositiveDefinite e isPositiveSemiDefinite separan los tres casos', () => {
    const singular = [
      [1, 1],
      [1, 1],
    ]
    const indefinida = [
      [1, 2],
      [2, 1],
    ]
    expect(isPositiveDefinite(A)).toBe(true)
    expect(isPositiveSemiDefinite(A)).toBe(true)
    // Singular: NO es definida positiva, pero sí semidefinida. Es el caso de dos activos
    // perfectamente correlacionados, que Cholesky reprobaría por un redondeo.
    expect(isPositiveDefinite(singular)).toBe(false)
    expect(isPositiveSemiDefinite(singular)).toBe(true)
    expect(isPositiveDefinite(indefinida)).toBe(false)
    expect(isPositiveSemiDefinite(indefinida)).toBe(false)
  })

  it('solveSPD resuelve A x = b', () => {
    const x = /** @type {number[]} */ (
      solveSPD(
        [
          [4, 1],
          [1, 3],
        ],
        [1, 2],
      )
    )
    expect(x[0]).toBeCloseTo(1 / 11, 12)
    expect(x[1]).toBeCloseTo(7 / 11, 12)
  })

  it('solveSPD reproduce el lado derecho al multiplicar de vuelta', () => {
    const b = [1, -2, 3]
    const x = /** @type {number[]} */ (solveSPD(A, b))
    const check = matVec(A, x)
    for (let i = 0; i < 3; i += 1) expect(check[i]).toBeCloseTo(b[i], 9)
  })

  it('solveSPD rechaza dimensiones que no casan y NaN', () => {
    expect(() => solveSPD([[4, 1], [1, 3]], [1])).toThrow(InvalidInputError)
    expect(() => solveSPD([[4, 1], [1, 3]], [1, Number.NaN])).toThrow(InvalidInputError)
  })
})

describe('eigenvalores', () => {
  it('largestEigenvalue de [[2,1],[1,2]] es 3 con eigenvector (1,1)', () => {
    const r = /** @type {any} */ (
      largestEigenvalue([
        [2, 1],
        [1, 2],
      ])
    )
    expect(r.value).toBeCloseTo(3, 12)
    expect(r.converged).toBe(true)
    // El eigenvector converge más lento que el eigenvalor (lineal contra cuadrático del cociente
    // de Rayleigh). Para lo que se usa, el paso 1/λmax de FISTA, lo que importa es el valor.
    expect(Math.abs(r.vector[0])).toBeCloseTo(Math.abs(r.vector[1]), 7)
  })

  it('largestEigenvalue de una diagonal es el mayor de la diagonal', () => {
    const r = /** @type {any} */ (
      largestEigenvalue([
        [0.04, 0, 0],
        [0, 0.09, 0],
        [0, 0, 0.16],
      ])
    )
    expect(r.value).toBeCloseTo(0.16, 12)
  })

  it('largestEigenvalue no se engaña con la escala: el criterio de paro es relativo', () => {
    // Antes la tolerancia era absoluta para matrices chicas (tol · max(1, |λ|)) y con s = 1e-15
    // declaraba convergencia en la primera iteración con λ = 1.6e-15 en vez de 4e-15.
    for (const s of [1, 1e-6, 1e-12, 1e-15, 1e-20]) {
      const r = /** @type {any} */ (
        largestEigenvalue([
          [s, 0],
          [0, 4 * s],
        ])
      )
      expect(r.converged).toBe(true)
      expect(r.iterations).toBeGreaterThanOrEqual(2)
      expect(Math.abs(r.value - 4 * s) / (4 * s)).toBeLessThan(1e-10)
    }
  })

  it('largestEigenvalue devuelve null con la matriz cero', () => {
    expect(
      largestEigenvalue([
        [0, 0],
        [0, 0],
      ]),
    ).toBeNull()
  })

  it('jacobiEigen entrega eigenvalores ascendentes y eigenvectores ortonormales', () => {
    const A = [
      [4, 1, 2],
      [1, 3, 0],
      [2, 0, 5],
    ]
    const { values, vectors } = jacobiEigen(A)
    expect(values[0]).toBeLessThanOrEqual(values[1])
    expect(values[1]).toBeLessThanOrEqual(values[2])
    // La traza y el determinante tienen que cuadrar con los eigenvalores.
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(4 + 3 + 5, 10)
    // A = V Λ Vᵀ
    const lambda = zerosMatrix(3, 3)
    for (let i = 0; i < 3; i += 1) lambda[i][i] = values[i]
    const reconstructed = matmul(matmul(vectors, lambda), transpose(vectors))
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) expect(reconstructed[i][j]).toBeCloseTo(A[i][j], 10)
    }
    // Vᵀ V = I
    const vtv = matmul(transpose(vectors), vectors)
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) expect(vtv[i][j]).toBeCloseTo(i === j ? 1 : 0, 10)
    }
  })

  it('jacobiEigen de la identidad da puros unos', () => {
    const { values } = jacobiEigen(identity(4))
    for (const v of values) expect(v).toBeCloseTo(1, 14)
  })
})

describe('nearestPSD', () => {
  it('deja intacta una matriz que ya es semidefinida positiva', () => {
    const A = [
      [4, 1],
      [1, 3],
    ]
    expect(nearestPSD(A)).toEqual(A)
  })

  it('recorta el eigenvalor negativo: [[1,2],[2,1]] queda en 1.5 en todas sus entradas', () => {
    const fixed = nearestPSD([
      [1, 2],
      [2, 1],
    ])
    for (const row of fixed) for (const v of row) expect(v).toBeCloseTo(1.5, 10)
    expect(isPositiveSemiDefinite(fixed)).toBe(true)
  })

  it('el resultado siempre pasa la prueba de semidefinida positiva', () => {
    const roto = [
      [0.04, 0.05, 0.02],
      [0.05, 0.03, 0.04],
      [0.02, 0.04, 0.02],
    ]
    expect(isPositiveSemiDefinite(roto)).toBe(false)
    expect(isPositiveSemiDefinite(nearestPSD(roto))).toBe(true)
  })
})
