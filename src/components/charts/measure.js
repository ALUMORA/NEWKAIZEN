// Medidas de texto aproximadas (sin tocar el DOM) y acomodo de etiquetas de eje sin encimarse.

/** Ancho aproximado de una etiqueta de 12px en la fuente de la interfaz. */
export function textWidth(text) {
  return String(text).length * 6.8
}

/**
 * Acomoda etiquetas de x: ancla al borde la que se saldría y omite la que chocaría con la anterior.
 * @param {{ value: number, label: string }[]} ticks @param {(v: number) => number} x
 * @param {number} x0 @param {number} x1
 * @returns {{ value: number, label: string, px: number, anchor: 'start' | 'middle' | 'end' }[]}
 */
export function placeXTicks(ticks, x, x0, x1) {
  const out = []
  let lastEnd = -Infinity
  for (const t of ticks) {
    const px = x(t.value)
    const w = textWidth(t.label)
    let anchor = /** @type {'start' | 'middle' | 'end'} */ ('middle')
    let left = px - w / 2
    if (left < x0 - 4) { anchor = 'start'; left = px } else if (px + w / 2 > x1 + 4) { anchor = 'end'; left = px - w }
    if (left < lastEnd + 6) continue
    lastEnd = left + w
    out.push({ ...t, px, anchor })
  }
  return out
}
