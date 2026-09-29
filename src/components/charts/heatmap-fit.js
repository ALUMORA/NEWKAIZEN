// Qué texto cabe en una celda y en un encabezado del mapa de calor. Puro, sin DOM: mide con
// textWidth (12 px) y, para el respaldo compacto a 10 px, con esa misma medida escalada 10/12.
// Orden de respaldo de una celda: la cifra completa a 12 px; a 10 px sin el cero inicial (".53",
// "−.12"); a 10 px con un decimal menos ("−.1"); y si ni así cabe, nada: la tabla y el resumen de
// la gráfica la siguen diciendo.
import { MISSING, isNum } from '../../lib/format.js'
import { fitText, textWidth } from './measure.js'
import { valueFormatter } from './scale.js'

/** Razón entre la fuente compacta (10 px) y la normal (12 px) de las gráficas. */
export const COMPACT_SCALE = 10 / 12
/** Aire mínimo a los lados del texto dentro de la celda, a 12 px y a 10 px. */
const PAD = 8
const PAD_COMPACT = 4
/** Alto mínimo de celda para cada tamaño de letra. */
const MIN_H = 20
const MIN_H_COMPACT = 14

/**
 * Quita el cero antes del punto decimal: "0.53" → ".53", "−0.12" → "−.12". Lo demás queda igual.
 * @param {string} text
 */
export function compactNumber(text) {
  return String(text).replace(/^([−+-]?)0(?=\.\d)/, '$1')
}

/** @param {string} text */
const compactWidth = (text) => textWidth(text) * COMPACT_SCALE

/**
 * Texto de una celda, o null si no cabe ninguna versión.
 * @param {number | null | undefined} value
 * @param {{ cellW: number, cellHeight?: number, showValues?: 'auto' | boolean, format?: 'number' | 'pct', decimals?: number }} options
 * @returns {{ text: string, compact: boolean } | null}
 */
export function heatmapCellText(value, { cellW, cellHeight = 34, showValues = 'auto', format = 'number', decimals = 2 }) {
  if (showValues === false) return null
  const full = isNum(value) ? valueFormatter(format, { decimals })(value) : MISSING
  if (showValues === true) return { text: full, compact: false }
  if (cellHeight >= MIN_H && textWidth(full) + PAD <= cellW) return { text: full, compact: false }
  if (cellHeight < MIN_H_COMPACT) return null
  const options = [compactNumber(full)]
  if (isNum(value) && decimals > 1) options.push(compactNumber(valueFormatter(format, { decimals: decimals - 1 })(value)))
  const text = options.find((t) => compactWidth(t) + PAD_COMPACT <= cellW)
  return text ? { text, compact: true } : null
}

/** Alto de la franja de encabezados horizontales y tope de la de encabezados verticales. */
const HEAD_H = 24
const MAX_VERTICAL = 72

/**
 * Encabezados de columna, todos con la misma regla: completos a 12 px si caben; si no, a 10 px; y
 * si ni así caben, verticales a 10 px y completos (recortados solo pasando de diez caracteres), con la franja
 * del alto de la más larga. Antes se recortaban a lo ancho y "GFNORTE" quedaba en "GFN…".
 * @param {string[]} columns @param {number} cellW
 * @returns {{ labels: string[], compact: boolean, vertical: boolean, height: number }}
 */
export function heatmapHeaders(columns, cellW) {
  const labels = columns.map(String)
  const room = cellW - 2
  if (labels.every((s) => textWidth(s) <= room)) return { labels, compact: false, vertical: false, height: HEAD_H }
  if (labels.every((s) => compactWidth(s) <= room)) return { labels, compact: true, vertical: false, height: HEAD_H }
  // El alto se mide a 7.2 px por carácter aunque la letra sea de 10 px: las claves van en mayúsculas,
  // que son más anchas que el promedio, y quedarse corto las saca por arriba del SVG.
  const cut = labels.map((s) => fitText(s, MAX_VERTICAL))
  const longest = Math.max(...cut.map(textWidth))
  return { labels: cut, compact: true, vertical: true, height: Math.max(HEAD_H, Math.ceil(longest) + 10) }
}
