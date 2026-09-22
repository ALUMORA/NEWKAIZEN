// Ayudantes internos de src/lib/finance. NO son API pública: index.js no los reexporta.
//
// Reglas que aplican a toda la librería financiera:
// - Módulos ES puros. Nada de React, nada de fetch y nada de Date.now() dentro de un cálculo:
//   las fechas entran siempre como argumento, para que el resultado sea reproducible.
// - Cuando no alcanzan los datos se responde `null`, nunca 0 ni NaN, para que la interfaz pueda
//   mostrar "s/d". Cada función documenta su n mínimo.
// - Una entrada sucia (NaN, Infinity, null, texto, arreglos de largo distinto) también se
//   responde con `null`: un dato malo no se propaga como NaN hasta la pantalla.
// - Las estadísticas de muestra usan n−1 y toda anualización recibe `k` explícito
//   (252, 52 o 12 según el intervalo). No hay ningún 52 escondido.
// - Nunca se mezclan monedas: las series entran ya convertidas a una sola, y lo que necesita
//   tipo de cambio lo recibe como argumento (ver fx.js).

/** Tolerancia para comparar contra cero en divisiones y sumas de pesos. */
export const EPS = 1e-12

/**
 * ¿Es un número de verdad y finito?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Copia numérica de un arreglo. Devuelve null si no es arreglo, si es más corto que
 * `minLength` o si trae algo que no sea número finito.
 * @param {unknown} values
 * @param {number} [minLength] largo mínimo aceptable
 * @returns {number[] | null}
 */
export function numericArray(values, minLength = 0) {
  if (!Array.isArray(values) || values.length < minLength) return null
  /** @type {number[]} */
  const out = new Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!isNum(v)) return null
    out[i] = v
  }
  return out
}

/**
 * Matriz numérica (arreglo de renglones del mismo largo). Devuelve null si algo no cuadra.
 * @param {unknown} rows
 * @param {{ square?: boolean }} [options] `square` exige tantas columnas como renglones
 * @returns {number[][] | null}
 */
export function numericMatrix(rows, { square = false } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const width = Array.isArray(rows[0]) ? rows[0].length : -1
  if (width <= 0) return null
  if (square && width !== rows.length) return null
  /** @type {number[][]} */
  const out = new Array(rows.length)
  for (let i = 0; i < rows.length; i++) {
    const row = numericArray(rows[i])
    if (row === null || row.length !== width) return null
    out[i] = row
  }
  return out
}

/**
 * Suma simple, sin compensación: los arreglos de esta librería son cortos (n ≤ unos miles).
 * @param {number[]} values
 * @returns {number}
 */
export function sumOf(values) {
  let total = 0
  for (let i = 0; i < values.length; i++) total += values[i]
  return total
}

/**
 * Convierte una tasa por periodo que puede venir como número o como serie, a una serie de largo n.
 * Sirve para `rfPerPeriod`, que unas veces es constante y otras una serie de CETES alineada.
 * @param {number | number[] | null | undefined} rate
 * @param {number} n
 * @returns {number[] | null} null si es una serie de otro largo o trae valores no finitos
 */
export function perPeriodSeries(rate, n) {
  if (rate == null) return null
  if (isNum(rate)) return new Array(n).fill(rate)
  const series = numericArray(rate)
  if (series === null || series.length !== n) return null
  return series
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Fecha ISO `YYYY-MM-DD` a milisegundos UTC. Solo acepta ese formato exacto, y rechaza fechas
 * que no existen (por ejemplo 2026-02-30), para que un dato malo no se vuelva una fecha corrida.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null
  const m = ISO_DATE.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null
  return ms
}

/**
 * Lista de fechas ISO `YYYY-MM-DD` estrictamente ascendentes y sin repetir, que es lo que
 * garantiza `alignPanel` y lo que suponen los calendarios de la librería. Devuelve los
 * milisegundos UTC de cada una para no volver a parsearlas.
 * @param {unknown} dates
 * @param {number} [minLength] largo mínimo aceptable
 * @returns {number[] | null} null si no es arreglo, si es más corto que `minLength`, si alguna
 *   no es una fecha ISO válida o si no vienen en orden ascendente estricto
 */
export function ascendingIsoDates(dates, minLength = 0) {
  if (!Array.isArray(dates) || dates.length < minLength) return null
  /** @type {number[]} */
  const out = new Array(dates.length)
  let previous = -Infinity
  for (let i = 0; i < dates.length; i++) {
    const ms = parseIsoDate(dates[i])
    if (ms === null || ms <= previous) return null
    out[i] = ms
    previous = ms
  }
  return out
}

/** Milisegundos en un día. */
const DAY_MS = 86400000

/**
 * Días de calendario entre dos fechas ISO (b − a). Negativo si b es anterior.
 * @param {string} a
 * @param {string} b
 * @returns {number | null} null si alguna no es una fecha ISO válida
 */
export function daysBetween(a, b) {
  const ta = parseIsoDate(a)
  const tb = parseIsoDate(b)
  if (ta === null || tb === null) return null
  return Math.round((tb - ta) / DAY_MS)
}

/**
 * Producto punto de dos vectores del mismo largo.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function dot(a, b) {
  let total = 0
  for (let i = 0; i < a.length; i++) total += a[i] * b[i]
  return total
}

/**
 * Producto matriz por vector.
 * @param {number[][]} matrix
 * @param {number[]} vector
 * @returns {number[]}
 */
export function matVec(matrix, vector) {
  /** @type {number[]} */
  const out = new Array(matrix.length)
  for (let i = 0; i < matrix.length; i++) out[i] = dot(matrix[i], vector)
  return out
}

/**
 * Pesos de un objeto `{símbolo: peso}` en el orden de `symbols`, normalizados para que sumen 1.
 * @param {Record<string, number>} weights
 * @param {string[]} symbols
 * @returns {number[] | null} null si falta algún símbolo, hay valores no finitos o la suma es ~0
 */
export function normalizedWeights(weights, symbols) {
  if (!weights || typeof weights !== 'object') return null
  /** @type {number[]} */
  const raw = new Array(symbols.length)
  for (let i = 0; i < symbols.length; i++) {
    const w = weights[symbols[i]]
    if (!isNum(w)) return null
    raw[i] = w
  }
  const total = sumOf(raw)
  if (Math.abs(total) < EPS) return null
  return raw.map((w) => w / total)
}
