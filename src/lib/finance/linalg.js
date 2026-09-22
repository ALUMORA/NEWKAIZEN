// Álgebra lineal mínima para la librería financiera. Todo es denso y pensado para n chico
// (n <= 40 activos), que es el tamaño real de un portafolio de esta app: no hay estructuras
// dispersas ni bloques, porque a ese tamaño no pagan.
//
// Convenciones de toda la librería:
// - Una matriz es `number[][]` con filas por renglón: `a[i][j]` es el renglón i, columna j.
// - Una matriz de rendimientos es T x N: **renglones = periodos, columnas = activos**.
// - Entrada inválida (NaN, Infinity, renglones de distinto largo) **lanza** `InvalidInputError`,
//   con mensaje en español. Datos insuficientes devuelven `null`, nunca 0 ni NaN.
// - Nada de aleatoriedad: las iteraciones arrancan de vectores fijos.

/**
 * Error de entrada inválida (NaN, Infinity, matriz no rectangular, dimensiones que no casan).
 * Se distingue a propósito de "no hay datos suficientes", que devuelve `null`.
 */
export class InvalidInputError extends Error {
  /** @param {string} message mensaje en español, se puede mostrar al usuario */
  constructor(message) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

/**
 * ¿Es un número finito de verdad? Rechaza NaN, Infinity, null, booleanos y cadenas.
 * @param {unknown} x
 * @returns {boolean}
 */
export function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x)
}

/**
 * ¿Es un arreglo no vacío de números finitos?
 * @param {unknown} v
 * @returns {boolean}
 */
export function isFiniteVector(v) {
  return Array.isArray(v) && v.length > 0 && v.every(isFiniteNumber)
}

/**
 * ¿Es una matriz rectangular no vacía de números finitos?
 * @param {unknown} m
 * @returns {boolean}
 */
export function isFiniteMatrix(m) {
  if (!Array.isArray(m) || m.length === 0) return false
  const first = m[0]
  if (!Array.isArray(first) || first.length === 0) return false
  const cols = first.length
  return m.every((row) => Array.isArray(row) && row.length === cols && row.every(isFiniteNumber))
}

/**
 * Valida un vector y lo devuelve como copia de números.
 * @param {number[]} v
 * @param {string} [name] nombre para el mensaje de error
 * @returns {number[]}
 * @throws {InvalidInputError} si está vacío o trae algo que no es un número finito
 */
export function assertVector(v, name = 'el vector') {
  if (!Array.isArray(v) || v.length === 0) {
    throw new InvalidInputError(`${name} tiene que ser un arreglo con al menos un número.`)
  }
  const out = new Array(v.length)
  for (let i = 0; i < v.length; i += 1) {
    if (!isFiniteNumber(v[i])) {
      throw new InvalidInputError(`${name} tiene un valor que no es un número finito en la posición ${i}.`)
    }
    out[i] = v[i]
  }
  return out
}

/**
 * Valida una matriz rectangular y la devuelve como copia.
 * @param {number[][]} m
 * @param {string} [name]
 * @returns {number[][]}
 * @throws {InvalidInputError}
 */
export function assertMatrix(m, name = 'la matriz') {
  if (!Array.isArray(m) || m.length === 0) {
    throw new InvalidInputError(`${name} tiene que ser un arreglo de renglones con al menos uno.`)
  }
  const cols = Array.isArray(m[0]) ? m[0].length : -1
  if (cols <= 0) {
    throw new InvalidInputError(`${name} tiene que tener al menos una columna.`)
  }
  const out = new Array(m.length)
  for (let i = 0; i < m.length; i += 1) {
    const row = m[i]
    if (!Array.isArray(row) || row.length !== cols) {
      throw new InvalidInputError(`${name} no es rectangular: el renglón ${i} no tiene ${cols} columnas.`)
    }
    const copy = new Array(cols)
    for (let j = 0; j < cols; j += 1) {
      if (!isFiniteNumber(row[j])) {
        throw new InvalidInputError(`${name} tiene un valor que no es un número finito en (${i}, ${j}).`)
      }
      copy[j] = row[j]
    }
    out[i] = copy
  }
  return out
}

/**
 * Valida una matriz cuadrada.
 * @param {number[][]} m
 * @param {string} [name]
 * @returns {number[][]}
 * @throws {InvalidInputError}
 */
export function assertSquare(m, name = 'la matriz') {
  const a = assertMatrix(m, name)
  if (a.length !== a[0].length) {
    throw new InvalidInputError(`${name} tiene que ser cuadrada: viene de ${a.length} x ${a[0].length}.`)
  }
  return a
}

/**
 * Vector de ceros.
 * @param {number} n
 * @returns {number[]}
 */
export function zeros(n) {
  return new Array(Math.max(0, n | 0)).fill(0)
}

/**
 * Matriz de ceros.
 * @param {number} rows
 * @param {number} cols
 * @returns {number[][]}
 */
export function zerosMatrix(rows, cols) {
  return Array.from({ length: Math.max(0, rows | 0) }, () => zeros(cols))
}

/**
 * Matriz identidad de n x n.
 * @param {number} n
 * @returns {number[][]}
 */
export function identity(n) {
  const out = zerosMatrix(n, n)
  for (let i = 0; i < out.length; i += 1) out[i][i] = 1
  return out
}

/**
 * Transpuesta.
 * @param {number[][]} a
 * @returns {number[][]}
 */
export function transpose(a) {
  const m = assertMatrix(a, 'la matriz')
  const rows = m.length
  const cols = m[0].length
  const out = zerosMatrix(cols, rows)
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) out[j][i] = m[i][j]
  }
  return out
}

/**
 * Producto punto de dos vectores del mismo largo.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 * @throws {InvalidInputError} si los largos no casan
 */
export function dot(a, b) {
  const x = assertVector(a, 'el primer vector')
  const y = assertVector(b, 'el segundo vector')
  if (x.length !== y.length) {
    throw new InvalidInputError(`Los vectores tienen que medir lo mismo: ${x.length} contra ${y.length}.`)
  }
  let s = 0
  for (let i = 0; i < x.length; i += 1) s += x[i] * y[i]
  return s
}

/**
 * Producto de matrices A (p x q) por B (q x r).
 * @param {number[][]} a
 * @param {number[][]} b
 * @returns {number[][]}
 * @throws {InvalidInputError} si las dimensiones internas no casan
 */
export function matmul(a, b) {
  const A = assertMatrix(a, 'la primera matriz')
  const B = assertMatrix(b, 'la segunda matriz')
  if (A[0].length !== B.length) {
    throw new InvalidInputError(
      `No se pueden multiplicar: ${A.length} x ${A[0].length} por ${B.length} x ${B[0].length}.`,
    )
  }
  const p = A.length
  const q = B.length
  const r = B[0].length
  const out = zerosMatrix(p, r)
  for (let i = 0; i < p; i += 1) {
    for (let k = 0; k < q; k += 1) {
      const aik = A[i][k]
      if (aik === 0) continue
      for (let j = 0; j < r; j += 1) out[i][j] += aik * B[k][j]
    }
  }
  return out
}

/**
 * Producto matriz por vector.
 * @param {number[][]} a
 * @param {number[]} v
 * @returns {number[]}
 * @throws {InvalidInputError} si las dimensiones no casan
 */
export function matVec(a, v) {
  const A = assertMatrix(a, 'la matriz')
  const x = assertVector(v, 'el vector')
  if (A[0].length !== x.length) {
    throw new InvalidInputError(`La matriz es ${A.length} x ${A[0].length} y el vector mide ${x.length}.`)
  }
  const out = zeros(A.length)
  for (let i = 0; i < A.length; i += 1) {
    let s = 0
    for (let j = 0; j < x.length; j += 1) s += A[i][j] * x[j]
    out[i] = s
  }
  return out
}

/**
 * Forma cuadrática vᵀ A v (por ejemplo la varianza de un portafolio wᵀ Σ w).
 * @param {number[]} v
 * @param {number[][]} a matriz cuadrada
 * @returns {number}
 * @throws {InvalidInputError}
 */
export function quadForm(v, a) {
  const A = assertSquare(a, 'la matriz')
  const x = assertVector(v, 'el vector')
  if (A.length !== x.length) {
    throw new InvalidInputError(`La matriz es de ${A.length} y el vector mide ${x.length}.`)
  }
  let s = 0
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i]
    if (xi === 0) continue
    for (let j = 0; j < x.length; j += 1) s += xi * A[i][j] * x[j]
  }
  return s
}

/**
 * Promedia A con su transpuesta. Quita la asimetría numérica que dejan las cuentas de covarianza.
 * @param {number[][]} a matriz cuadrada
 * @returns {number[][]}
 */
export function symmetrize(a) {
  const A = assertSquare(a, 'la matriz')
  const n = A.length
  const out = zerosMatrix(n, n)
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) out[i][j] = (A[i][j] + A[j][i]) / 2
  }
  return out
}

/**
 * ¿Es simétrica dentro de una tolerancia relativa?
 * @param {number[][]} a matriz cuadrada
 * @param {number} [tol] tolerancia absoluta escalada por la magnitud de la matriz
 * @returns {boolean}
 */
export function isSymmetric(a, tol = 1e-10) {
  const A = assertSquare(a, 'la matriz')
  let scale = 0
  for (const row of A) for (const x of row) scale = Math.max(scale, Math.abs(x))
  const limit = tol * Math.max(1, scale)
  for (let i = 0; i < A.length; i += 1) {
    for (let j = i + 1; j < A.length; j += 1) {
      if (Math.abs(A[i][j] - A[j][i]) > limit) return false
    }
  }
  return true
}

/**
 * Norma de Frobenius.
 * @param {number[][]} a
 * @returns {number}
 */
export function frobeniusNorm(a) {
  const A = assertMatrix(a, 'la matriz')
  let s = 0
  for (const row of A) for (const x of row) s += x * x
  return Math.sqrt(s)
}

/**
 * Descomposición de Cholesky A = L Lᵀ con L triangular inferior.
 *
 * Si A no es definida positiva se le suma un múltiplo de la identidad ("jitter") y se reintenta,
 * multiplicando el jitter por 10 en cada intento. Devuelve `null` si tras `maxAttempts` sigue sin
 * funcionar, o si la matriz no es simétrica.
 *
 * @param {number[][]} a matriz simétrica cuadrada (n >= 1)
 * @param {{ jitter?: number, maxAttempts?: number }} [options]
 *   `jitter` inicial (0 = intentar primero sin nada), `maxAttempts` intentos totales
 * @returns {{ L: number[][], jitter: number } | null}
 */
export function cholesky(a, { jitter = 0, maxAttempts = 10 } = {}) {
  const A = assertSquare(a, 'la matriz')
  if (!isSymmetric(A, 1e-8)) return null
  const n = A.length
  let trace = 0
  for (let i = 0; i < n; i += 1) trace += Math.abs(A[i][i])
  const base = jitter > 0 ? jitter : Math.max(1e-14, (trace / n) * 1e-14)
  let eps = jitter

  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    const L = zerosMatrix(n, n)
    let ok = true
    for (let i = 0; i < n && ok; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        let s = A[i][j] + (i === j ? eps : 0)
        for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k]
        if (i === j) {
          if (!(s > 0)) {
            ok = false
            break
          }
          L[i][j] = Math.sqrt(s)
        } else {
          L[i][j] = s / L[j][j]
        }
      }
    }
    if (ok) return { L, jitter: eps }
    eps = eps > 0 ? eps * 10 : base
  }
  return null
}

/**
 * ¿Es definida positiva? Cholesky sin jitter: pide que TODOS los eigenvalores sean mayores que
 * cero, no mayores o iguales.
 * @param {number[][]} a matriz simétrica cuadrada
 * @returns {boolean}
 */
export function isPositiveDefinite(a) {
  const A = assertSquare(a, 'la matriz')
  return cholesky(A, { jitter: 0, maxAttempts: 1 }) !== null
}

/**
 * ¿Es semidefinida positiva, o sea sin eigenvalores negativos?
 *
 * Se decide por eigenvalores y no por Cholesky a propósito. Cholesky prueba definida positiva
 * ESTRICTA, así que una matriz legítimamente singular (por ejemplo dos activos perfectamente
 * correlacionados, cuyo eigenvalor más chico es cero exacto) la reprobaría por un redondeo de
 * 1e-16. Con n ≤ 40, Jacobi cuesta nada y contesta la pregunta que de verdad importa.
 *
 * @param {number[][]} a matriz simétrica cuadrada
 * @param {number} [tol] qué tan negativo se tolera, relativo a la magnitud de la matriz
 * @returns {boolean}
 */
export function isPositiveSemiDefinite(a, tol = 1e-12) {
  const A = assertSquare(a, 'la matriz')
  let scale = 0
  for (const row of A) for (const x of row) scale = Math.max(scale, Math.abs(x))
  if (scale === 0) return true
  const { values } = jacobiEigen(A)
  return values[0] >= -tol * scale
}

/**
 * Resuelve A x = b con A simétrica definida positiva, vía Cholesky.
 * @param {number[][]} a matriz simétrica definida positiva (n x n)
 * @param {number[]} b lado derecho (n)
 * @returns {number[] | null} `null` si A no se pudo factorizar ni con jitter
 * @throws {InvalidInputError} si las dimensiones no casan o hay NaN
 */
export function solveSPD(a, b) {
  const A = assertSquare(a, 'la matriz')
  const y = assertVector(b, 'el lado derecho')
  if (A.length !== y.length) {
    throw new InvalidInputError(`La matriz es de ${A.length} y el lado derecho mide ${y.length}.`)
  }
  const chol = cholesky(A)
  if (!chol) return null
  const { L } = chol
  const n = A.length
  // L z = b (sustitución hacia adelante)
  const z = zeros(n)
  for (let i = 0; i < n; i += 1) {
    let s = y[i]
    for (let k = 0; k < i; k += 1) s -= L[i][k] * z[k]
    z[i] = s / L[i][i]
  }
  // Lᵀ x = z (sustitución hacia atrás)
  const x = zeros(n)
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = z[i]
    for (let k = i + 1; k < n; k += 1) s -= L[k][i] * x[k]
    x[i] = s / L[i][i]
  }
  return x
}

/**
 * Eigenvalor de mayor magnitud de una matriz simétrica, por iteración de potencia.
 *
 * Para una matriz de covarianza (semidefinida positiva) ese eigenvalor es λmax, que es justo la
 * constante de Lipschitz del gradiente de ½ wᵀΣw y por eso el paso 1/λmax de FISTA.
 * El vector inicial es fijo (v_i = 1/(i+1) normalizado), así que el resultado es determinista.
 *
 * Dos advertencias para quien lo use:
 * - El valor se estima con el cociente de Rayleigh, que para una matriz simétrica **siempre se
 *   queda corto** (vᵀAv ≤ λmax con v unitario). Si vas a usarlo como tamaño de paso, súmale un
 *   margen, porque quedarte por debajo de λmax puede desestabilizar el método.
 * - El eigenvalor converge mucho más rápido que el eigenvector (cuadrático contra lineal). Con la
 *   tolerancia por omisión el valor sale a ~1e-12 y el vector a ~1e-8.
 *
 * @param {number[][]} a matriz simétrica cuadrada
 * @param {{ maxIter?: number, tol?: number }} [options]
 * @returns {{ value: number, vector: number[], iterations: number, converged: boolean } | null}
 *   `null` si la matriz es toda ceros (no hay dirección dominante)
 */
export function largestEigenvalue(a, { maxIter = 2000, tol = 1e-14 } = {}) {
  const A = assertSquare(a, 'la matriz')
  const n = A.length
  let scale = 0
  for (const row of A) for (const x of row) scale = Math.max(scale, Math.abs(x))
  if (scale === 0) return null

  let v = zeros(n)
  for (let i = 0; i < n; i += 1) v[i] = 1 / (i + 1)
  let norm = Math.hypot(...v)
  v = v.map((x) => x / norm)

  let lambda = 0
  let converged = false
  let iterations = 0
  for (let it = 1; it <= maxIter; it += 1) {
    iterations = it
    const w = matVec(A, v)
    norm = Math.hypot(...w)
    if (norm === 0) return { value: 0, vector: v, iterations: it, converged: true }
    const next = w.map((x) => x / norm)
    // Cociente de Rayleigh: más preciso que la norma y con el signo correcto.
    const rayleigh = dot(v, w)
    if (Math.abs(rayleigh - lambda) <= tol * Math.max(1, Math.abs(rayleigh))) {
      lambda = rayleigh
      v = next
      converged = true
      break
    }
    lambda = rayleigh
    v = next
  }
  return { value: lambda, vector: v, iterations, converged }
}

/**
 * Eigen-descomposición de una matriz simétrica por el método cíclico de Jacobi.
 *
 * Exacto hasta precisión de máquina para n chico y sin dependencias. Devuelve los eigenvalores en
 * orden ascendente, igual que `numpy.linalg.eigh`, y los eigenvectores por columna:
 * `vectors[i][j]` es la componente i del eigenvector j.
 *
 * @param {number[][]} a matriz simétrica cuadrada
 * @param {{ maxSweeps?: number, tol?: number }} [options]
 * @returns {{ values: number[], vectors: number[][] }}
 * @throws {InvalidInputError} si no es cuadrada o trae NaN
 */
export function jacobiEigen(a, { maxSweeps = 100, tol = 1e-15 } = {}) {
  const A = symmetrize(a)
  const n = A.length
  const V = identity(n)

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let off = 0
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) off += A[i][j] * A[i][j]
    }
    if (Math.sqrt(off) <= tol * Math.max(1, frobeniusNorm(A))) break

    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = A[p][q]
        if (apq === 0) continue
        const theta = (A[q][q] - A[p][p]) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k += 1) {
          const akp = A[k][p]
          const akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k += 1) {
          const apk = A[p][k]
          const aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = V[k][p]
          const vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => A[i][i] - A[j][j])
  const values = order.map((i) => A[i][i])
  const vectors = zerosMatrix(n, n)
  for (let col = 0; col < n; col += 1) {
    for (let row = 0; row < n; row += 1) vectors[row][col] = V[row][order[col]]
  }
  return { values, vectors }
}

/**
 * Matriz semidefinida positiva más cercana, recortando a cero los eigenvalores negativos y
 * reconstruyendo (el método "spectral" de PyPortfolioOpt). Si ya es SDP la devuelve tal cual.
 * @param {number[][]} a matriz simétrica cuadrada
 * @returns {number[][]}
 */
export function nearestPSD(a) {
  const A = symmetrize(a)
  if (isPositiveSemiDefinite(A)) return A
  const { values, vectors } = jacobiEigen(A)
  const n = A.length
  const out = zerosMatrix(n, n)
  for (let k = 0; k < n; k += 1) {
    const lambda = values[k] > 0 ? values[k] : 0
    if (lambda === 0) continue
    for (let i = 0; i < n; i += 1) {
      const vi = vectors[i][k] * lambda
      for (let j = 0; j < n; j += 1) out[i][j] += vi * vectors[j][k]
    }
  }
  return symmetrize(out)
}
