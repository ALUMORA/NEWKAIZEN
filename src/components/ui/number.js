// Lectura de números escritos a mano en es-MX (NumberInput).
//
// En México el separador de miles es la coma y el decimal es el punto, igual
// que en inglés: "1,234.56". Pero la gente pega valores de todos lados, así que
// también se aceptan el signo menos tipográfico (U+2212), los espacios finos
// que mete Excel, el símbolo de peso y la coma decimal a la europea cuando no
// puede ser separador de miles.
import { fmtNumber } from '../../lib/format.js'

/** Espacio normal, duro (U+00A0), fino (U+2009) y angosto (U+202F). */
const SPACES = /[\s\u00a0\u2009\u202f]/g
/** "1,234" o "12,345,678.5": grupos de tres después de un primer grupo que no empieza en 0. */
const GROUPED = /^-?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/
/** "1234", "1234.56", ".5" o "1234.": ya está listo para Number(). */
const PLAIN = /^-?(?:\d+\.?\d*|\.\d+)$/
/** "1,5", "0,375" o "12,34": una sola coma que no puede ser de miles, o sea decimal. */
const COMMA_DECIMAL = /^-?\d+,\d+$/

/**
 * Convierte texto a número. Devuelve null cuando está vacío o no se entiende,
 * nunca NaN: quien llama distingue "sin dato" de "cero".
 *
 *   parseNumber('1,234.56')  // 1234.56
 *   parseNumber('−1,141.00') // -1141      (menos tipográfico)
 *   parseNumber('$ 2 500')   // 2500
 *   parseNumber('0,375')     // 0.375      (coma decimal pegada de otro lado)
 *   parseNumber('1,23,4')    // null       (agrupación imposible)
 *   parseNumber('abc')       // null
 *
 * @param {unknown} input
 * @returns {number | null}
 */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (typeof input !== 'string') return null

  let text = input
    .replace(SPACES, '')
    .replace(/−/g, '-')
    .replace(/^(-?)\$/, '$1')
    .replace(/^\+/, '')
  if (text.startsWith('$')) text = text.slice(1)
  if (text === '' || text === '-' || text === '.') return null

  if (GROUPED.test(text)) text = text.replace(/,/g, '')
  else if (COMMA_DECIMAL.test(text)) text = text.replace(',', '.')

  if (!PLAIN.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * Texto con el que se dibuja un número dentro de un campo. Vacío cuando no hay
 * dato (un campo no dice "s/d", se queda vacío), agrupado cuando sí lo hay. Sin
 * `decimals` conserva los que el número traiga (hasta 6), para no redondearle a
 * nadie lo que escribió.
 * @param {number | null | undefined} value
 * @param {number} [decimals]
 */
export function formatForInput(value, decimals) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  if (decimals !== undefined) return fmtNumber(value, { decimals })
  const [, frac = ''] = String(value).split('.')
  return fmtNumber(value, { decimals: Math.min(6, frac.replace(/e.*$/, '').length) })
}

/**
 * ¿El texto ya escrito corresponde al mismo número? Sirve para no reescribirle
 * el campo a alguien que está a medio teclear ("1,2" mientras va a "1,234.5").
 * @param {string} text
 * @param {number | null | undefined} value
 */
export function sameNumber(text, value) {
  const parsed = parseNumber(text)
  if (parsed === null) return value === null || value === undefined
  return parsed === value
}
