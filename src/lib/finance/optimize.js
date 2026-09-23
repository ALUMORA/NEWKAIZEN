// Optimización de portafolio: solo largos, con cajas l ≤ w ≤ u y Σw = 1.
//
// Por qué así y no como estaba: el optimizador anterior sorteaba 100 mil portafolios al azar y se
// quedaba con el mejor. Eso no es optimizar, es buscar con una lámpara en un cuarto grande, y con
// más de 4 o 5 activos ni se acerca al óptimo. Aquí se resuelve de verdad el problema convexo con
// FISTA (gradiente proximal acelerado) y proyección exacta sobre la intersección del símplex con
// la caja, que es el conjunto factible real de alguien que no puede vender en corto.
//
// Unidades: `mu`, `rf` y la covarianza tienen que venir en la MISMA periodicidad (todo anual, o
// todo por periodo). Los pesos son fracciones que suman 1. Ninguna función de aquí sugiere
// comprar ni vender nada: entrega la mezcla que cumple las restricciones que le diste.

import { assertSquare, assertVector, InvalidInputError, largestEigenvalue, matVec, quadForm, solveSPD } from './linalg.js'

/**
 * El problema no tiene solución con esas restricciones: los mínimos suman más de 1, o los máximos
 * suman menos de 1, o algún mínimo es mayor que su máximo.
 */
export class InfeasibleError extends Error {
  /** @param {string} message mensaje en español, se puede mostrar al usuario */
  constructor(message) {
    super(message)
    this.name = 'InfeasibleError'
  }
}

const FEAS_EPS = 1e-12

/**
 * Convierte un límite escalar o por activo en un arreglo de largo n.
 * @param {number | number[]} bound
 * @param {number} n
 * @param {string} name
 * @returns {number[]}
 */
function expandBound(bound, n, name) {
  if (typeof bound === 'number') {
    if (!Number.isFinite(bound)) throw new InvalidInputError(`${name} tiene que ser un número finito.`)
    return new Array(n).fill(bound)
  }
  const v = assertVector(bound, name)
  if (v.length !== n) throw new InvalidInputError(`${name} tiene que traer ${n} valores, no ${v.length}.`)
  return v
}

/**
 * Revisa que exista al menos un w con Σw = 1 y l ≤ w ≤ u.
 * @param {number[]} lo
 * @param {number[]} hi
 * @throws {InfeasibleError}
 */
function assertFeasible(lo, hi) {
  let sumLo = 0
  let sumHi = 0
  for (let i = 0; i < lo.length; i += 1) {
    if (lo[i] > hi[i]) {
      throw new InfeasibleError(
        `No hay solución: el mínimo del activo ${i + 1} (${lo[i]}) es mayor que su máximo (${hi[i]}).`,
      )
    }
    sumLo += lo[i]
    sumHi += hi[i]
  }
  if (sumLo > 1 + FEAS_EPS) {
    throw new InfeasibleError(
      `No hay solución: los pesos mínimos suman ${sumLo.toFixed(4)} y tendrían que sumar 1 o menos.`,
    )
  }
  if (sumHi < 1 - FEAS_EPS) {
    throw new InfeasibleError(
      `No hay solución: los pesos máximos suman ${sumHi.toFixed(4)} y tendrían que sumar 1 o más. ` +
        `Con ${lo.length} activos y un tope de ${(sumHi / lo.length).toFixed(4)} por activo no se llega al 100 %.`,
    )
  }
}

/**
 * Proyección euclidiana de v sobre { w : Σw = 1, l ≤ w ≤ u }.
 *
 * La solución tiene la forma w = recorte(v − θ, l, u) con un solo θ, que se encuentra por
 * bisección (Σw es no creciente en θ) y luego se ajusta exacto sobre el tramo lineal final, para
 * que casos como v=[.5,.3,.2] con u=.4 den [.4,.35,.25] sin error de redondeo.
 *
 * @param {number[]} v punto a proyectar
 * @param {number | number[]} [l] peso mínimo por activo (por omisión 0: solo largos)
 * @param {number | number[]} [u] peso máximo por activo (por omisión 1: sin tope)
 * @returns {number[]} pesos que suman 1 y respetan la caja
 * @throws {InfeasibleError} si Σl > 1, Σu < 1 o algún l_i > u_i
 * @throws {InvalidInputError} si `v` está vacío o algo no es un número finito
 */
export function projectBoxSimplex(v, l = 0, u = 1) {
  const x = assertVector(v, 'el vector a proyectar')
  const n = x.length
  const lo = expandBound(l, n, 'el peso mínimo')
  const hi = expandBound(u, n, 'el peso máximo')
  assertFeasible(lo, hi)

  const clipAt = (theta) => {
    const w = new Array(n)
    for (let i = 0; i < n; i += 1) {
      const raw = x[i] - theta
      w[i] = raw < lo[i] ? lo[i] : raw > hi[i] ? hi[i] : raw
    }
    return w
  }

  let thetaLo = Infinity
  let thetaHi = -Infinity
  for (let i = 0; i < n; i += 1) {
    thetaLo = Math.min(thetaLo, x[i] - hi[i])
    thetaHi = Math.max(thetaHi, x[i] - lo[i])
  }
  if (!(thetaHi > thetaLo)) return clipAt(thetaLo)

  let a = thetaLo
  let b = thetaHi
  for (let it = 0; it < 200; it += 1) {
    const mid = (a + b) / 2
    if (!(mid > a && mid < b)) break
    const w = clipAt(mid)
    let sum = 0
    for (let i = 0; i < n; i += 1) sum += w[i]
    if (sum > 1) a = mid
    else b = mid
  }

  const theta = (a + b) / 2
  const w = clipAt(theta)

  // Ajuste exacto sobre el tramo lineal: con el conjunto libre ya fijo, θ sale de una división.
  const free = []
  let clipped = 0
  for (let i = 0; i < n; i += 1) {
    const raw = x[i] - theta
    if (raw > lo[i] && raw < hi[i]) free.push(i)
    else clipped += w[i]
  }
  if (free.length > 0) {
    let sumFree = 0
    for (const i of free) sumFree += x[i]
    const exact = (sumFree + clipped - 1) / free.length
    const candidate = clipAt(exact)
    let ok = true
    for (const i of free) {
      const raw = x[i] - exact
      if (raw < lo[i] - 1e-12 || raw > hi[i] + 1e-12) ok = false
    }
    if (ok) return candidate
  }
  return w
}

/**
 * Portafolio factible que maximiza cᵀw (el extremo lineal del conjunto factible).
 * Arranca en los mínimos y reparte lo que falta en orden de c descendente.
 * @param {number[]} c
 * @param {number[]} lo
 * @param {number[]} hi
 * @returns {number[]}
 */
function greedyLinear(c, lo, hi) {
  const n = c.length
  const w = lo.slice()
  let remaining = 1
  for (let i = 0; i < n; i += 1) remaining -= lo[i]
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => c[j] - c[i] || i - j)
  for (const i of order) {
    if (remaining <= 0) break
    const room = hi[i] - lo[i]
    const add = Math.min(room, remaining)
    w[i] += add
    remaining -= add
  }
  return w
}

/**
 * Constante de Lipschitz del gradiente de ½ wᵀΣw, o sea λmax(Σ), con margen de seguridad.
 *
 * El cociente de Rayleigh de la iteración de potencia SIEMPRE se queda corto (vᵀΣv ≤ λmax para v
 * unitario) y un paso 1/L con L por debajo de λmax puede hacer divergir a FISTA. De ahí el margen
 * de 1e-9. Si la iteración no convergió se usa la norma infinito, que es cota superior garantizada
 * de λmax: da un paso más chico, o sea más lento, pero nunca inestable.
 * @param {number[][]} cov
 * @returns {number} 0 si la matriz es toda ceros
 */
function lipschitzOf(cov) {
  const eig = largestEigenvalue(cov)
  if (!eig) return 0
  if (eig.converged) return eig.value * (1 + 1e-9)
  let bound = 0
  for (const row of cov) {
    let s = 0
    for (const x of row) s += Math.abs(x)
    bound = Math.max(bound, s)
  }
  return Math.max(eig.value, bound)
}

/**
 * FISTA con reinicio adaptativo para  min ½ wᵀΣw − cᵀw  sujeto a  Σw = 1, lo ≤ w ≤ hi.
 * El paso es 1/λmax(Σ), que es la constante de Lipschitz del gradiente.
 * @param {number[][]} cov
 * @param {number[]} c término lineal (τ·μ, o ceros para mínima varianza)
 * @param {number[]} lo
 * @param {number[]} hi
 * @param {{ maxIter?: number, tol?: number, start?: number[] | null, lipschitz?: number | null }} [options]
 * @returns {{ weights: number[], iterations: number, converged: boolean }}
 */
function fista(cov, c, lo, hi, { maxIter = 20000, tol = 1e-13, start = null, lipschitz = null } = {}) {
  const n = cov.length
  const L = lipschitz == null ? lipschitzOf(cov) : lipschitz
  if (!(L > 0)) {
    // Covarianza toda ceros: el problema se vuelve lineal. Si además el término lineal es cero,
    // todos los portafolios factibles empatan y lo neutral es repartir parejo, no amontonar todo
    // en el primer activo de la lista nada más porque quedó primero.
    const flat = c.every((v) => v === 0)
    const weights = flat ? projectBoxSimplex(new Array(n).fill(1 / n), lo, hi) : greedyLinear(c, lo, hi)
    return { weights, iterations: 0, converged: true }
  }
  const step = 1 / L

  let x = projectBoxSimplex(start && start.length === n ? start : new Array(n).fill(1 / n), lo, hi)
  let y = x.slice()
  let t = 1
  let iterations = 0
  let converged = false
  let quiet = 0

  for (let it = 1; it <= maxIter; it += 1) {
    iterations = it
    const grad = matVec(cov, y)
    const probe = new Array(n)
    for (let i = 0; i < n; i += 1) probe[i] = y[i] - step * (grad[i] - c[i])
    const xNext = projectBoxSimplex(probe, lo, hi)

    let restart = 0
    let delta = 0
    for (let i = 0; i < n; i += 1) {
      restart += (y[i] - xNext[i]) * (xNext[i] - x[i])
      delta = Math.max(delta, Math.abs(xNext[i] - x[i]))
    }

    if (restart > 0) {
      t = 1
      y = xNext.slice()
    } else {
      const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2
      const beta = (t - 1) / tNext
      const yNext = new Array(n)
      for (let i = 0; i < n; i += 1) yNext[i] = xNext[i] + beta * (xNext[i] - x[i])
      y = yNext
      t = tNext
    }
    x = xNext

    if (delta <= tol) {
      quiet += 1
      if (quiet >= 3) {
        converged = true
        break
      }
    } else {
      quiet = 0
    }
  }
  return { weights: x, iterations, converged }
}

/**
 * @typedef {{
 *   weights: number[],
 *   variance: number,
 *   volatility: number,
 *   expectedReturn: number | null,
 *   iterations: number,
 *   converged: boolean,
 * }} PortfolioResult
 */

/**
 * Arma el resultado común de todas las funciones de esta página.
 * @param {number[]} weights
 * @param {number[][]} cov
 * @param {number[] | null} mu
 * @param {number} iterations
 * @param {boolean} converged
 * @returns {PortfolioResult}
 */
function describe(weights, cov, mu, iterations, converged) {
  const variance = Math.max(0, quadForm(weights, cov))
  let expectedReturn = null
  if (mu) {
    let s = 0
    for (let i = 0; i < weights.length; i += 1) s += weights[i] * mu[i]
    expectedReturn = s
  }
  return { weights, variance, volatility: Math.sqrt(variance), expectedReturn, iterations, converged }
}

/**
 * Prepara y valida covarianza + cajas.
 * @param {number[][]} cov
 * @param {{ l?: number | number[], u?: number | number[] }} [options]
 * @returns {{ S: number[][], lo: number[], hi: number[], n: number }}
 */
function prepare(cov, { l = 0, u = 1 } = {}) {
  const S = assertSquare(cov, 'la covarianza')
  const n = S.length
  const lo = expandBound(l, n, 'el peso mínimo')
  const hi = expandBound(u, n, 'el peso máximo')
  assertFeasible(lo, hi)
  return { S, lo, hi, n }
}

/**
 * Portafolio de mínima varianza: el que menos se mueve, sin mirar rendimientos esperados.
 *
 * Es el punto de arranque honesto del optimizador, porque no depende de estimar medias (que es lo
 * que más ruido trae). Con σ=(.2,.3) y ρ=0 da w₁ = .692308 y σ_p = .166410.
 *
 * @param {number[][]} cov covarianza N x N (anual o por periodo, tú decides; la volatilidad sale igual)
 * @param {{ l?: number | number[], u?: number | number[], maxIter?: number, tol?: number }} [options]
 * @returns {PortfolioResult}
 * @throws {InfeasibleError} si las cajas no dejan sumar 1
 * @throws {InvalidInputError} si la covarianza no es cuadrada o trae NaN
 */
export function minVariance(cov, options = {}) {
  const { S, lo, hi, n } = prepare(cov, options)
  const zero = new Array(n).fill(0)
  const { weights, iterations, converged } = fista(S, zero, lo, hi, {
    maxIter: options.maxIter,
    tol: options.tol,
  })
  return describe(weights, S, null, iterations, converged)
}

/**
 * Portafolio media-varianza para una tolerancia al riesgo τ:
 * minimiza ½ wᵀΣw − τ μᵀw. τ = 0 es mínima varianza y τ grande es máximo rendimiento.
 *
 * @param {number[]} mu rendimientos esperados por activo, misma periodicidad que `cov`
 * @param {number[][]} cov covarianza N x N
 * @param {number} tau tolerancia al riesgo, ≥ 0
 * @param {{ l?: number | number[], u?: number | number[], maxIter?: number, tol?: number, start?: number[] | null }} [options]
 * @returns {PortfolioResult}
 * @throws {InfeasibleError} si las cajas no dejan sumar 1
 * @throws {InvalidInputError} si las dimensiones no casan, hay NaN o τ es negativo
 */
export function meanVariance(mu, cov, tau, options = {}) {
  const { S, lo, hi, n } = prepare(cov, options)
  const m = assertVector(mu, 'los rendimientos esperados')
  if (m.length !== n) throw new InvalidInputError(`Hay ${m.length} rendimientos esperados y la covarianza es de ${n}.`)
  if (!Number.isFinite(tau) || tau < 0) {
    throw new InvalidInputError('La tolerancia al riesgo (tau) tiene que ser un número mayor o igual a cero.')
  }
  const c = m.map((v) => v * tau)
  const { weights, iterations, converged } = fista(S, c, lo, hi, {
    maxIter: options.maxIter,
    tol: options.tol,
    start: options.start ?? null,
  })
  return describe(weights, S, m, iterations, converged)
}

/**
 * @typedef {PortfolioResult & { tau: number }} FrontierPoint
 */

/**
 * Barre τ y devuelve los puntos de la frontera eficiente, repartidos parejo en el eje de
 * rendimiento esperado (que es como se ve bien en la gráfica), del portafolio de mínima varianza
 * al de máximo rendimiento factible.
 *
 * @param {number[]} mu rendimientos esperados por activo
 * @param {number[][]} cov covarianza N x N
 * @param {{ points?: number, l?: number | number[], u?: number | number[], grid?: number }} [options]
 *   `points` cuántos puntos devolver (30 por omisión), `grid` cuántos τ barrer por dentro (160)
 * @returns {FrontierPoint[]} ordenados de menor a mayor rendimiento esperado; puede traer menos de
 *   `points` si la frontera es degenerada (por ejemplo, todos los μ iguales)
 * @throws {InfeasibleError} si las cajas no dejan sumar 1
 * @throws {InvalidInputError} si las dimensiones no casan o hay NaN
 */
export function efficientFrontier(mu, cov, options = {}) {
  const { S, lo, hi, n } = prepare(cov, options)
  const m = assertVector(mu, 'los rendimientos esperados')
  if (m.length !== n) throw new InvalidInputError(`Hay ${m.length} rendimientos esperados y la covarianza es de ${n}.`)
  const points = Math.max(2, Math.round(options.points ?? 30))
  const gridSize = Math.max(points, Math.round(options.grid ?? 160))

  const lipschitz = lipschitzOf(S)
  const spread = Math.max(...m) - Math.min(...m)

  if (!(lipschitz > 0) || !(spread > 0)) {
    // Sin riesgo o sin diferencia de rendimientos la frontera se colapsa a un punto.
    const w = spread > 0 ? greedyLinear(m, lo, hi) : minVariance(S, { l: lo, u: hi }).weights
    return [{ ...describe(w, S, m, 0, true), tau: spread > 0 ? Infinity : 0 }]
  }

  const tauMax = (64 * lipschitz) / spread
  /** @type {FrontierPoint[]} */
  const dense = []

  const first = fista(S, new Array(n).fill(0), lo, hi, { lipschitz })
  dense.push({ ...describe(first.weights, S, m, first.iterations, first.converged), tau: 0 })

  const solveAt = (tau, start) => {
    const c = m.map((v) => v * tau)
    const r = fista(S, c, lo, hi, { start, lipschitz, maxIter: 8000 })
    return { ...describe(r.weights, S, m, r.iterations, r.converged), tau }
  }

  let warm = first.weights
  const tauMin = tauMax * 1e-6
  for (let j = 0; j < gridSize; j += 1) {
    const tau = tauMin * Math.pow(tauMax / tauMin, j / (gridSize - 1))
    const point = solveAt(tau, warm)
    warm = point.weights
    dense.push(point)
  }

  // El mapa τ -> rendimiento es muy poco lineal: un barrido geométrico deja huecos grandes en el
  // eje que de verdad se grafica. Se rellenan a propósito los huecos más anchos, partiendo τ por
  // la mitad geométrica, hasta que ninguno pase de medio espacio objetivo. Cada solución arranca
  // caliente desde su vecina, así que cada relleno cuesta muy poco.
  const rangeLow = dense[0].expectedReturn ?? 0
  const rangeHigh = dense[dense.length - 1].expectedReturn ?? 0
  const wanted = (rangeHigh - rangeLow) / (2 * (points - 1))
  let budget = points * 6
  while (budget > 0 && wanted > 0) {
    let worst = -1
    let widest = 0
    for (let i = 1; i < dense.length; i += 1) {
      const gap = (dense[i].expectedReturn ?? 0) - (dense[i - 1].expectedReturn ?? 0)
      if (gap > widest) {
        widest = gap
        worst = i
      }
    }
    if (worst < 0 || widest <= wanted) break
    const tauLow = dense[worst - 1].tau
    const tauHigh = dense[worst].tau
    const tauMid = tauLow > 0 ? Math.sqrt(tauLow * tauHigh) : tauHigh / 2
    if (!(tauMid > tauLow && tauMid < tauHigh)) break
    dense.splice(worst, 0, solveAt(tauMid, dense[worst - 1].weights))
    budget -= 1
  }

  dense.sort((a, b) => (a.expectedReturn ?? 0) - (b.expectedReturn ?? 0))
  const rMin = dense[0].expectedReturn ?? 0
  const rMax = dense[dense.length - 1].expectedReturn ?? 0
  if (!(rMax > rMin)) return [dense[0]]

  /** @type {FrontierPoint[]} */
  const out = []
  for (let j = 0; j < points; j += 1) {
    const targetReturn = rMin + ((rMax - rMin) * j) / (points - 1)
    let best = dense[0]
    let bestGap = Infinity
    for (const p of dense) {
      const gap = Math.abs((p.expectedReturn ?? 0) - targetReturn)
      if (gap < bestGap) {
        bestGap = gap
        best = p
      }
    }
    const last = out[out.length - 1]
    if (!last || Math.abs((last.expectedReturn ?? 0) - (best.expectedReturn ?? 0)) > 1e-14) out.push(best)
  }
  return out
}

/**
 * Portafolio tangente: el de mayor razón de Sharpe dentro del conjunto factible.
 *
 * Se busca sobre la frontera (que está parametrizada por τ y es donde vive el óptimo) con un
 * barrido grueso para acotar y después sección áurea para afinar. Con μ=(.10,.15), σ=(.2,.3),
 * ρ=0 y rf=.05 da [.529412, .470588] con Sharpe .416667.
 *
 * Eso solo vale si algún portafolio factible rinde MÁS que rf. Si ninguno lo hace, el máximo de
 * (μ − rf)/σ está en la rama ineficiente (con exceso negativo conviene más volatilidad, no menos),
 * que no es un portafolio tangente ni tiene sentido enseñarlo como tal. En ese caso sale `null`,
 * y la pantalla muestra "s/d" o cae a mínima varianza diciéndolo, como hace `walkForward`.
 *
 * @param {number[]} mu rendimientos esperados por activo
 * @param {number[][]} cov covarianza N x N
 * @param {number} rf tasa libre de riesgo en la MISMA periodicidad que `mu` y `cov`
 * @param {{ l?: number | number[], u?: number | number[], scan?: number, refine?: number }} [options]
 * @returns {(PortfolioResult & { sharpe: number, tau: number }) | null}
 *   `null` si ningún portafolio que cumpla la caja rinde más que rf (no hay tangente con Sharpe
 *   positivo), o si la volatilidad del mejor punto es cero (Sharpe no está definido)
 * @throws {InfeasibleError} si las cajas no dejan sumar 1
 * @throws {InvalidInputError} si las dimensiones no casan o hay NaN
 */
export function maxSharpe(mu, cov, rf, options = {}) {
  const { S, lo, hi, n } = prepare(cov, options)
  const m = assertVector(mu, 'los rendimientos esperados')
  if (m.length !== n) throw new InvalidInputError(`Hay ${m.length} rendimientos esperados y la covarianza es de ${n}.`)
  if (!Number.isFinite(rf)) throw new InvalidInputError('La tasa libre de riesgo tiene que ser un número finito.')

  // El rendimiento máximo factible sale del extremo lineal del conjunto (llenar primero a los de
  // mayor μ hasta su tope). Si ni ese le gana a rf, no hay portafolio tangente.
  const richest = greedyLinear(m, lo, hi)
  let maxReturn = 0
  for (let i = 0; i < n; i += 1) maxReturn += richest[i] * m[i]
  if (!(maxReturn - rf > 0)) return null

  const lipschitz = lipschitzOf(S)
  const spread = Math.max(...m) - Math.min(...m)
  if (!(lipschitz > 0)) return null

  // Cada τ que se resuelve se guarda, y el siguiente arranca desde la solución del τ más cercano
  // en escala logarítmica. Los pesos cambian poco entre τ vecinos, así que el arranque caliente
  // le quita la mayor parte del trabajo a FISTA: es lo que hace que esto se pueda correr dentro
  // de un walk-forward con decenas de cortes.
  /** @type {{ logTau: number, weights: number[] }[]} */
  const solved = []
  const solveAt = (tau) => {
    let start = null
    if (solved.length > 0) {
      const target = Math.log(Math.max(tau, 1e-300))
      let closest = solved[0]
      for (const entry of solved) {
        if (Math.abs(entry.logTau - target) < Math.abs(closest.logTau - target)) closest = entry
      }
      start = closest.weights
    }
    const c = tau === 0 ? new Array(n).fill(0) : m.map((v) => v * tau)
    const r = fista(S, c, lo, hi, { lipschitz, maxIter: 20000, start })
    solved.push({ logTau: Math.log(Math.max(tau, 1e-300)), weights: r.weights })
    const d = describe(r.weights, S, m, r.iterations, r.converged)
    const sharpe = d.volatility > 0 ? ((d.expectedReturn ?? 0) - rf) / d.volatility : -Infinity
    return { ...d, sharpe, tau }
  }

  if (!(spread > 0)) {
    const only = solveAt(0)
    return only.volatility > 0 ? only : null
  }

  const tauMax = (64 * lipschitz) / spread
  const scan = Math.max(8, Math.round(options.scan ?? 40))
  const tauMin = tauMax * 1e-6

  /** @type {number[]} */
  const taus = [0]
  for (let j = 0; j < scan; j += 1) taus.push(tauMin * Math.pow(tauMax / tauMin, j / (scan - 1)))
  let bestIndex = 0
  let best = solveAt(taus[0])
  for (let j = 1; j < taus.length; j += 1) {
    const candidate = solveAt(taus[j])
    if (candidate.sharpe > best.sharpe) {
      best = candidate
      bestIndex = j
    }
  }

  // Sección áurea dentro del intervalo que quedó alrededor del mejor τ del barrido.
  let a = taus[Math.max(0, bestIndex - 1)]
  let b = taus[Math.min(taus.length - 1, bestIndex + 1)]
  const phi = (Math.sqrt(5) - 1) / 2
  let c1 = b - phi * (b - a)
  let d1 = a + phi * (b - a)
  let f1 = solveAt(c1)
  let f2 = solveAt(d1)
  const refine = Math.max(10, Math.round(options.refine ?? 100))
  for (let it = 0; it < refine; it += 1) {
    if (b - a <= 1e-15 * Math.max(1, b)) break
    if (f1.sharpe >= f2.sharpe) {
      b = d1
      d1 = c1
      f2 = f1
      c1 = b - phi * (b - a)
      f1 = solveAt(c1)
    } else {
      a = c1
      c1 = d1
      f1 = f2
      d1 = a + phi * (b - a)
      f2 = solveAt(d1)
    }
    if (f1.sharpe > best.sharpe) best = f1
    if (f2.sharpe > best.sharpe) best = f2
  }
  const mid = solveAt((a + b) / 2)
  if (mid.sharpe > best.sharpe) best = mid

  return best.volatility > 0 ? best : null
}

/**
 * Contribuciones de riesgo de y (sin normalizar) y su distancia al presupuesto.
 * @param {number[][]} S
 * @param {number[]} y
 * @param {number[]} b
 * @returns {{ weights: number[], riskContributions: number[], variance: number, residual: number }}
 */
function riskBudgetState(S, y, b) {
  let sum = 0
  for (const v of y) sum += v
  const weights = y.map((v) => v / sum)
  const Sw = matVec(S, weights)
  let raw = 0
  for (let i = 0; i < weights.length; i += 1) raw += weights[i] * Sw[i]
  const variance = Math.max(0, raw)
  const riskContributions = weights.map((w, i) => (variance > 0 ? (w * Sw[i]) / variance : 0))
  let residual = variance > 0 ? 0 : Infinity
  for (let i = 0; i < weights.length; i += 1) {
    const gap = Math.abs(riskContributions[i] - b[i])
    if (!(gap <= residual)) residual = Number.isFinite(gap) ? gap : Infinity
  }
  return { weights, riskContributions, variance, residual }
}

/** Tolerancia del spec para decir que las contribuciones quedaron iguales al presupuesto. */
const RISK_PARITY_ACCEPT = 1e-8

/**
 * Paridad de riesgo: cada activo aporta la misma parte del riesgo total del portafolio, en vez de
 * la misma parte del dinero. Un activo volátil pesa menos y uno tranquilo pesa más.
 *
 * Se resuelve sobre y > 0 (sin normalizar) la condición y_i·(Σy)_i = b_i, que es el mínimo de la
 * función convexa ½ yᵀΣy − Σ b_i·log y_i (Spinu, 2013); al final w = y/Σy. Primero van barridos
 * de descenso coordinado cíclico, baratos y suficientes para cualquier covarianza sana, y si no
 * alcanzan (covarianza mal condicionada) se termina con Newton sobre esa misma función, con
 * búsqueda de línea exacta y sin salir de y > 0. Con σ=(.2,.3) y ρ=0 da [.6, .4], o sea
 * proporcional a 1/σ, como debe ser sin correlación.
 *
 * El paro es el residual que de verdad define la paridad, max_i |RC_i − b_i|, no el tamaño del
 * paso. `converged` es true si ese residual quedó en 1e-8 o menos (lo que pide el spec) o en `tol`
 * si pediste algo más holgado. REVISA `converged` antes de enseñar `riskContributions`: con una
 * covarianza casi singular (condición de 1e12 o más) la aritmética de doble precisión ya no deja
 * calcular las contribuciones a 1e-8, y ahí sale false con el mejor punto que se encontró.
 *
 * Solo largos por construcción: no acepta cajas, porque la solución ya es interior.
 *
 * @param {number[][]} cov covarianza N x N simétrica con diagonal positiva
 * @param {{ budget?: number[] | null, maxIter?: number, tol?: number }} [options]
 *   `budget` es el reparto de riesgo objetivo (por omisión, parejo); se normaliza a sumar 1.
 *   `maxIter` topa barridos más pasos de Newton (500); `tol` es el residual al que se afina (1e-12)
 * @returns {{
 *   weights: number[],
 *   riskContributions: number[],
 *   variance: number,
 *   volatility: number,
 *   residual: number,
 *   iterations: number,
 *   converged: boolean,
 * } | null} `null` si algún activo tiene varianza cero o negativa, o si la covarianza es tan
 *   singular que ninguna iteración dio contribuciones positivas (no significarían nada)
 * @throws {InvalidInputError} si la covarianza no es cuadrada, trae NaN o el
 *   presupuesto no casa
 */
export function riskParity(cov, { budget = null, maxIter = 500, tol = 1e-12 } = {}) {
  const S = assertSquare(cov, 'la covarianza')
  const n = S.length
  let b
  if (budget == null) {
    b = new Array(n).fill(1 / n)
  } else {
    const raw = assertVector(budget, 'el presupuesto de riesgo')
    if (raw.length !== n) throw new InvalidInputError(`El presupuesto de riesgo tiene que traer ${n} valores.`)
    let total = 0
    for (const v of raw) {
      if (!(v > 0)) throw new InvalidInputError('Cada parte del presupuesto de riesgo tiene que ser mayor que cero.')
      total += v
    }
    b = raw.map((v) => v / total)
  }
  for (let i = 0; i < n; i += 1) {
    if (!(S[i][i] > 0)) return null
  }

  const y = new Array(n)
  for (let i = 0; i < n; i += 1) y[i] = Math.sqrt(b[i] / S[i][i])

  let state = riskBudgetState(S, y, b)
  let best = { y: y.slice(), state }
  const keep = () => {
    if (state.residual < best.state.residual) best = { y: y.slice(), state }
  }

  // 1. Descenso coordinado cíclico: cada paso resuelve exacto la cuadrática de y_i.
  let iterations = 0
  const sweeps = Math.min(maxIter, 60)
  while (iterations < sweeps && best.state.residual > tol) {
    iterations += 1
    for (let i = 0; i < n; i += 1) {
      let c = 0
      for (let j = 0; j < n; j += 1) if (j !== i) c += S[i][j] * y[j]
      y[i] = (-c + Math.sqrt(c * c + 4 * S[i][i] * b[i])) / (2 * S[i][i])
    }
    state = riskBudgetState(S, y, b)
    keep()
  }

  // 2. Newton sobre ½ yᵀΣy − Σ b·log y. El hessiano Σ + diag(b/y²) es definido positivo siempre.
  //    La búsqueda de línea usa la derivada direccional (más precisa que comparar valores de la
  //    función) y nunca deja salir a y de y > 0. Se para al llegar a `tol` o cuando el residual ya
  //    rebota en el piso de redondeo sin mejorar.
  if (best.state.residual > tol) {
    for (let i = 0; i < n; i += 1) y[i] = best.y[i]
    /** @param {number[]} point @param {number[]} dir */
    const slope = (point, dir) => {
      const Sy = matVec(S, point)
      let d = 0
      for (let i = 0; i < n; i += 1) d += (Sy[i] - b[i] / point[i]) * dir[i]
      return d
    }
    let stall = 0
    while (iterations < maxIter && best.state.residual > tol && stall < 8) {
      iterations += 1
      const Sy = matVec(S, y)
      const minusGrad = new Array(n)
      const H = new Array(n)
      for (let i = 0; i < n; i += 1) {
        minusGrad[i] = b[i] / y[i] - Sy[i]
        H[i] = S[i].slice()
        H[i][i] += b[i] / (y[i] * y[i])
      }
      const dir = solveSPD(H, minusGrad)
      if (!dir || dir.some((v) => !Number.isFinite(v))) break
      let tMax = 1
      for (let i = 0; i < n; i += 1) if (dir[i] < 0) tMax = Math.min(tMax, (-0.99 * y[i]) / dir[i])
      /** @param {number} t */
      const at = (t) => y.map((v, i) => v + t * dir[i])
      let t = tMax
      if (slope(at(tMax), dir) > 0) {
        let lo = 0
        let hi = tMax
        for (let k = 0; k < 60; k += 1) {
          const mid = (lo + hi) / 2
          if (slope(at(mid), dir) > 0) hi = mid
          else lo = mid
        }
        t = lo > 0 ? lo : hi / 2
      }
      const next = at(t)
      let moved = false
      for (let i = 0; i < n; i += 1) {
        if (next[i] !== y[i]) moved = true
        y[i] = next[i]
      }
      state = riskBudgetState(S, y, b)
      const before = best.state.residual
      keep()
      // Solo cuenta como estancado si ya está cerca: lejos del óptimo el residual puede subir
      // unos pasos mientras Newton avanza en la función convexa.
      if (best.state.residual < before) stall = 0
      else if (best.state.residual <= 1e-6) stall += 1
      if (!moved) break
    }
  }

  const { weights, riskContributions, variance, residual } = best.state
  if (!(variance > 0) || riskContributions.some((c) => !(c > 0))) return null
  return {
    weights,
    riskContributions,
    variance,
    volatility: Math.sqrt(variance),
    residual,
    iterations,
    converged: residual <= Math.max(tol, RISK_PARITY_ACCEPT),
  }
}
