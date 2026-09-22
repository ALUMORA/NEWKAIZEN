// Matrices de covarianza para el optimizador.
//
// La covarianza muestral de un portafolio chico con pocos periodos trae muchísimo ruido: con N
// activos hay N(N+1)/2 parámetros que estimar y casi nunca hay T suficiente. El optimizador se
// come ese ruido y saca pesos extremos. Por eso el estimador de casa es la contracción de
// Ledoit y Wolf (2003) hacia una matriz de correlación constante, que es la que mejor le queda a
// un portafolio de acciones: conserva las volatilidades individuales y jala las correlaciones
// hacia su promedio.
//
// Orientación de los datos, siempre: `returnMatrix` es T x N, **renglones = periodos,
// columnas = activos**. Las covarianzas quedan por periodo, en la misma periodicidad que los
// rendimientos que entraron; para anualizar está `annualize(cov, k)`.

import {
  assertSquare,
  assertMatrix,
  InvalidInputError,
  isPositiveSemiDefinite,
  nearestPSD,
  zerosMatrix,
} from './linalg.js'

/**
 * Promedio por columna de una matriz T x N.
 * @param {number[][]} x
 * @returns {number[]}
 */
function columnMeans(x) {
  const T = x.length
  const N = x[0].length
  const out = new Array(N).fill(0)
  for (let t = 0; t < T; t += 1) {
    for (let i = 0; i < N; i += 1) out[i] += x[t][i]
  }
  for (let i = 0; i < N; i += 1) out[i] /= T
  return out
}

/**
 * Matriz centrada por columna (cada activo menos su media).
 * @param {number[][]} x
 * @returns {number[][]}
 */
function demean(x) {
  const mu = columnMeans(x)
  return x.map((row) => row.map((v, i) => v - mu[i]))
}

/**
 * Covarianza muestral (divisor n − 1), igual que `pandas.DataFrame.cov()`.
 *
 * @param {number[][]} returnMatrix T x N: renglones = periodos, columnas = activos. Mínimo T = 2.
 * @returns {number[][] | null} matriz N x N, o `null` si hay menos de 2 periodos
 * @throws {import('./linalg.js').InvalidInputError} si la matriz no es rectangular o trae NaN
 */
export function sampleCov(returnMatrix) {
  const X = assertMatrix(returnMatrix, 'la matriz de rendimientos')
  const T = X.length
  const N = X[0].length
  if (T < 2) return null
  const Xm = demean(X)
  const out = zerosMatrix(N, N)
  for (let i = 0; i < N; i += 1) {
    for (let j = i; j < N; j += 1) {
      let s = 0
      for (let t = 0; t < T; t += 1) s += Xm[t][i] * Xm[t][j]
      const v = s / (T - 1)
      out[i][j] = v
      out[j][i] = v
    }
  }
  return out
}

/**
 * Contracción de Ledoit y Wolf (2003) hacia una matriz de correlación constante.
 *
 * Es el mismo estimador que `pypfopt.risk_models.CovarianceShrinkage(X, returns_data=True,
 * frequency=1).ledoit_wolf(shrinkage_target="constant_correlation")`, incluido el detalle de que
 * la covarianza muestral S usa divisor T − 1 mientras que los términos π y θ usan T. Se compara
 * contra PyPortfolioOpt en `tests/golden/covariance.json` con tolerancia 1e-10.
 *
 * El objetivo F tiene las varianzas de S en la diagonal y fuera de ella la correlación promedio
 * r̄ multiplicada por σ_i σ_j. El resultado es δ·F + (1 − δ)·S, y se corrige a la matriz
 * semidefinida positiva más cercana si hiciera falta (recortando eigenvalores negativos, igual
 * que PyPortfolioOpt).
 *
 * @param {number[][]} returnMatrix T x N: renglones = periodos, columnas = activos. Mínimo T = 2.
 * @returns {{ cov: number[][], shrinkage: number, target: number[][], meanCorrelation: number | null } | null}
 *   `shrinkage` es δ ∈ [0, 1]; `meanCorrelation` es r̄, o `null` con un solo activo.
 *   Devuelve `null` si hay menos de 2 periodos.
 * @throws {import('./linalg.js').InvalidInputError} si la matriz no es rectangular o trae NaN
 */
export function ledoitWolfConstantCorrelation(returnMatrix) {
  const X = assertMatrix(returnMatrix, 'la matriz de rendimientos')
  const T = X.length
  const N = X[0].length
  if (T < 2) return null

  const S = /** @type {number[][]} */ (sampleCov(X))

  // Con un solo activo no hay correlación que contraer: el objetivo es la propia varianza.
  if (N === 1) {
    return { cov: [[S[0][0]]], shrinkage: 0, target: [[S[0][0]]], meanCorrelation: null }
  }

  const variance = new Array(N)
  const std = new Array(N)
  for (let i = 0; i < N; i += 1) {
    variance[i] = S[i][i]
    std[i] = Math.sqrt(Math.max(0, S[i][i]))
  }

  // r̄ = promedio de las correlaciones fuera de la diagonal.
  //
  // Diferencia a propósito con PyPortfolioOpt: una serie constante (varianza cero, por ejemplo un
  // pagaré a tasa fija que se pegó al panel) hace que allá salga NaN y contagie toda la matriz.
  // Aquí esa serie no entra al promedio y su correlación con las demás se toma como cero, que es
  // lo que de verdad significa "no se movió". Con varianzas positivas, que es el caso que se
  // compara contra el golden, el resultado es idéntico.
  let sumCorr = 0
  let pairs = 0
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      if (i === j || !(std[i] > 0) || !(std[j] > 0)) continue
      sumCorr += S[i][j] / (std[i] * std[j])
      pairs += 1
    }
  }
  const rBar = pairs > 0 ? sumCorr / pairs : 0

  const F = zerosMatrix(N, N)
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      if (i === j) F[i][j] = variance[i]
      else F[i][j] = std[i] > 0 && std[j] > 0 ? rBar * std[i] * std[j] : 0
    }
  }

  const Xm = demean(X)

  // π: varianza asintótica de las entradas de S.
  const piMat = zerosMatrix(N, N)
  let piHat = 0
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      let yy = 0
      let xx = 0
      for (let t = 0; t < T; t += 1) {
        const a = Xm[t][i]
        const b = Xm[t][j]
        yy += a * a * b * b
        xx += a * b
      }
      const value = yy / T - (2 * xx * S[i][j]) / T + S[i][j] * S[i][j]
      piMat[i][j] = value
      piHat += value
    }
  }

  // θ: covarianza asintótica entre S y el objetivo F, término por término.
  const help = zerosMatrix(N, N)
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      let s = 0
      for (let t = 0; t < T; t += 1) s += Xm[t][i] * Xm[t][j]
      help[i][j] = s / T
    }
  }

  let rhoHat = 0
  for (let i = 0; i < N; i += 1) rhoHat += piMat[i][i]

  let thetaSum = 0
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      if (i === j || !(std[i] > 0) || !(std[j] > 0)) continue
      let term1 = 0
      for (let t = 0; t < T; t += 1) term1 += Xm[t][i] * Xm[t][i] * Xm[t][i] * Xm[t][j]
      term1 /= T
      const term2 = help[i][i] * S[i][j]
      const term3 = help[i][j] * variance[i]
      const term4 = variance[i] * S[i][j]
      const theta = term1 - term2 - term3 + term4
      thetaSum += (std[j] / std[i]) * theta
    }
  }
  rhoHat += rBar * thetaSum

  // γ: distancia al objetivo.
  let gammaHat = 0
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const d = S[i][j] - F[i][j]
      gammaHat += d * d
    }
  }

  // γ = 0 quiere decir que la muestra YA es el objetivo (pasa con un panel de puros ceros):
  // no hay nada que ganar contrayendo y la división daría NaN.
  const delta = gammaHat > 0 ? Math.max(0, Math.min(1, (piHat - rhoHat) / gammaHat / T)) : 0

  const shrunk = zerosMatrix(N, N)
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) shrunk[i][j] = delta * F[i][j] + (1 - delta) * S[i][j]
  }

  const cov = isPositiveSemiDefinite(shrunk) ? shrunk : nearestPSD(shrunk)
  return { cov, shrinkage: delta, target: F, meanCorrelation: rBar }
}

/**
 * Pasa una covarianza por periodo a covarianza anual multiplicando por k
 * (252 diaria, 52 semanal, 12 mensual). No toca correlaciones.
 * @param {number[][]} cov matriz cuadrada por periodo
 * @param {number} k periodos por año
 * @returns {number[][]}
 * @throws {import('./linalg.js').InvalidInputError} si `cov` no es cuadrada, trae NaN o k no es finito
 */
export function annualize(cov, k) {
  const A = assertSquare(cov, 'la covarianza')
  if (!Number.isFinite(k) || k <= 0) {
    throw new InvalidInputError('Los periodos por año (k) tienen que ser un número mayor que cero.')
  }
  return A.map((row) => row.map((v) => v * k))
}

/**
 * Matriz de correlación a partir de una covarianza.
 * @param {number[][]} cov matriz cuadrada
 * @returns {number[][] | null} `null` si algún activo tiene varianza cero o negativa
 *   (su correlación no está definida; conviene quitar esa serie antes de optimizar)
 * @throws {import('./linalg.js').InvalidInputError} si `cov` no es cuadrada o trae NaN
 */
export function corrFromCov(cov) {
  const A = assertSquare(cov, 'la covarianza')
  const n = A.length
  const sd = new Array(n)
  for (let i = 0; i < n; i += 1) {
    if (!(A[i][i] > 0)) return null
    sd[i] = Math.sqrt(A[i][i])
  }
  const out = zerosMatrix(n, n)
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      out[i][j] = i === j ? 1 : A[i][j] / (sd[i] * sd[j])
    }
  }
  return out
}
