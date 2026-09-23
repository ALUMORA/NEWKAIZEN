// Medidas de texto aproximadas (sin tocar el DOM) y acomodo de etiquetas de eje sin encimarse.

/** Ancho aproximado de una etiqueta de 12px en la fuente de la interfaz. */
export function textWidth(text) {
  return String(text).length * 7.2
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

/** Recorta una etiqueta para que quepa en `px` de ancho, con puntos suspensivos. */
export function fitText(text, px) {
  const s = String(text)
  const max = Math.floor(px / 7.2)
  if (s.length <= max) return s
  return max <= 1 ? '' : `${s.slice(0, max - 1).trimEnd()}…`
}

/**
 * Coloca etiquetas directas junto a sus puntos sin encimarlas: prueba derecha, izquierda, arriba y
 * abajo, y se queda con la primera que no choca con otra etiqueta ni con otro punto ni se sale.
 * Las marcas importantes van primero en `points` para quedarse con el mejor lugar.
 * @param {{ x: number, y: number, text: string }[]} points
 * @param {{ x0: number, x1: number, y0: number, y1: number }} bounds
 *   Con `optional` en un punto, si no hay lugar libre su etiqueta se omite (hidden: true).
 * @returns {{ x: number, y: number, anchor: 'start' | 'end' | 'middle', hidden?: boolean }[]}
 */
export function placeLabels(/** @type {{ x: number, y: number, text: string, optional?: boolean }[]} */ points, bounds, gap = 9, lineH = 14) {
  const boxes = points.map((p) => ({ l: p.x - 5, r: p.x + 5, t: p.y - 5, b: p.y + 5 }))
  const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
  return points.map((p, i) => {
    const w = textWidth(p.text)
    const options = [
      { x: p.x + gap, y: p.y, anchor: 'start', box: { l: p.x + gap, r: p.x + gap + w, t: p.y - lineH / 2, b: p.y + lineH / 2 } },
      { x: p.x - gap, y: p.y, anchor: 'end', box: { l: p.x - gap - w, r: p.x - gap, t: p.y - lineH / 2, b: p.y + lineH / 2 } },
      { x: p.x, y: p.y - lineH, anchor: 'middle', box: { l: p.x - w / 2, r: p.x + w / 2, t: p.y - lineH * 1.5, b: p.y - lineH / 2 } },
      { x: p.x, y: p.y + lineH, anchor: 'middle', box: { l: p.x - w / 2, r: p.x + w / 2, t: p.y + lineH / 2, b: p.y + lineH * 1.5 } },
    ]
    const inside = (bx) => bx.l >= bounds.x0 && bx.r <= bounds.x1 && bx.t >= bounds.y0 && bx.b <= bounds.y1
    const free = (bx) => boxes.every((o, j) => j === i || !hit(bx, o))
    const freeSpot = options.find((o) => inside(o.box) && free(o.box))
    if (!freeSpot && p.optional) return { x: p.x, y: p.y, anchor: /** @type {'start'} */ ('start'), hidden: true }
    const pick = freeSpot ?? options.find((o) => inside(o.box)) ?? options[0]
    boxes.push(pick.box)
    return { x: pick.x, y: pick.y, anchor: /** @type {'start' | 'end' | 'middle'} */ (pick.anchor) }
  })
}
