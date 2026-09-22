// Generador de números pseudoaleatorios sembrado (xoshiro128**), la única fuente de azar de la
// librería financiera. Toda simulación tiene que poder repetirse: misma semilla, misma corrida.
//
// Por qué xoshiro128**: es rápido con la aritmética de 32 bits que JS hace bien (Math.imul),
// tiene periodo 2^128 − 1 y pasa las pruebas estadísticas de Vigna y Blackman. No sirve para
// criptografía y aquí no hace falta.
//
// La semilla se acepta como texto (por ejemplo el id del portafolio) o como número. Se pasa por
// un hash FNV-1a de 32 bits y luego por splitmix32 para llenar los cuatro registros de estado,
// que es la forma recomendada de sembrar un generador chico desde una sola palabra.

const UINT32 = 4294967296 // 2^32

/** Semilla por omisión cuando quien llama no da una. */
export const DEFAULT_SEED = 'kaizen'

/**
 * Convierte cualquier semilla a un entero sin signo de 32 bits, con FNV-1a sobre las unidades
 * de código UTF-16. Determinista y estable entre corridas y entre plataformas.
 * @param {string | number | null | undefined} seed
 * @returns {number} entero en [0, 2^32)
 */
export function hashSeed(seed) {
  const text = seed == null ? '' : String(seed)
  let h = 2166136261 >>> 0 // offset basis de FNV-1a
  for (let i = 0; i < text.length; i += 1) {
    h = (h ^ text.charCodeAt(i)) >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  // Mezcla final para que semillas parecidas ("kaizen1" y "kaizen2") no queden pegadas.
  h = (h ^ (h >>> 16)) >>> 0
  h = Math.imul(h, 2246822507) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 3266489909) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * splitmix32: expande una palabra de 32 bits a una secuencia con buena dispersión de bits.
 * Se usa solo para llenar el estado inicial de xoshiro.
 * @param {number} seed
 * @returns {() => number} siguiente palabra de 32 bits
 */
function splitmix32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x9e3779b9) | 0
    let t = a ^ (a >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    t = t ^ (t >>> 15)
    return t >>> 0
  }
}

/**
 * @param {number} x
 * @param {number} k
 * @returns {number}
 */
function rotl(x, k) {
  return (((x << k) | (x >>> (32 - k))) >>> 0)
}

/**
 * @typedef {{
 *   seed: string,
 *   nextUint32: () => number,
 *   uniform: () => number,
 *   normal: () => number,
 *   normals: (n: number) => Float64Array,
 *   int: (maxExclusive: number) => number,
 *   reset: () => void,
 * }} Rng
 */

/**
 * Crea un generador sembrado. Dos generadores con la misma semilla producen exactamente la misma
 * secuencia, en cualquier máquina.
 *
 * - `nextUint32()` entero en [0, 2^32).
 * - `uniform()` flotante en [0, 1), con 2^32 valores posibles.
 * - `normal()` normal estándar por Box-Muller con caché del segundo valor del par.
 * - `normals(n)` n normales estándar en un Float64Array.
 * - `int(max)` entero en [0, max) sin sesgo (rechaza el residuo del último bloque incompleto).
 * - `reset()` regresa el generador a su estado inicial, incluida la caché de Box-Muller.
 *
 * @param {string | number | null | undefined} [seed] semilla; por omisión `DEFAULT_SEED`
 * @returns {Rng}
 */
export function createRng(seed = DEFAULT_SEED) {
  const label = seed == null ? DEFAULT_SEED : String(seed)
  const word = hashSeed(label)
  const mix = splitmix32(word)
  const initial = [mix(), mix(), mix(), mix()]
  // El estado de xoshiro no puede ser todo ceros; con splitmix32 es prácticamente imposible,
  // pero la guarda cuesta nada y evita un generador mudo.
  if ((initial[0] | initial[1] | initial[2] | initial[3]) === 0) initial[0] = 1

  let s0 = initial[0]
  let s1 = initial[1]
  let s2 = initial[2]
  let s3 = initial[3]
  /** @type {number | null} */
  let spare = null

  function nextUint32() {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0
    const t = (s1 << 9) >>> 0
    s2 = (s2 ^ s0) >>> 0
    s3 = (s3 ^ s1) >>> 0
    s1 = (s1 ^ s2) >>> 0
    s0 = (s0 ^ s3) >>> 0
    s2 = (s2 ^ t) >>> 0
    s3 = rotl(s3, 11)
    return result
  }

  function uniform() {
    return nextUint32() / UINT32
  }

  function normal() {
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    let u1 = uniform()
    while (u1 === 0) u1 = uniform() // ln(0) no existe; la probabilidad es 2^-32
    const u2 = uniform()
    const radius = Math.sqrt(-2 * Math.log(u1))
    const theta = 2 * Math.PI * u2
    spare = radius * Math.sin(theta)
    return radius * Math.cos(theta)
  }

  /**
   * @param {number} n
   * @returns {Float64Array}
   */
  function normals(n) {
    const count = Math.trunc(n)
    if (!Number.isFinite(count) || count < 0) {
      throw new Error('rng.normals: n tiene que ser un entero mayor o igual a cero')
    }
    const out = new Float64Array(count)
    for (let i = 0; i < count; i += 1) out[i] = normal()
    return out
  }

  /**
   * @param {number} maxExclusive
   * @returns {number}
   */
  function int(maxExclusive) {
    const max = Math.trunc(maxExclusive)
    if (!Number.isFinite(max) || max <= 0) {
      throw new Error('rng.int: el máximo tiene que ser un entero mayor que cero')
    }
    if (max > UINT32) {
      throw new Error('rng.int: el máximo no puede pasar de 2^32')
    }
    // Rechazo del bloque incompleto para que todos los valores sean igual de probables.
    const limit = UINT32 - (UINT32 % max)
    let x = nextUint32()
    while (x >= limit) x = nextUint32()
    return x % max
  }

  function reset() {
    s0 = initial[0]
    s1 = initial[1]
    s2 = initial[2]
    s3 = initial[3]
    spare = null
  }

  return { seed: label, nextUint32, uniform, normal, normals, int, reset }
}
