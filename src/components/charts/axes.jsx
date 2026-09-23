// Piezas de eje compartidas: rejilla horizontal con etiquetas de y, marcas de x y línea de cero.
// El texto de ejes va en --muted (nunca en el color de una serie, pedido 4 de C1).
import { placeXTicks } from './measure.js'

/**
 * Rejilla y etiquetas del eje y a la izquierda.
 * @param {{ ticks: number[], y: (v: number) => number, x0: number, x1: number, format: (v: number) => string }} props
 */
export function YGrid({ ticks, y, x0, x1, format }) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => {
        const py = Math.round(y(t)) + 0.5
        return (
          <g key={t}>
            <line className="kz-chart__grid" x1={x0} x2={x1} y1={py} y2={py} />
            <text className="kz-chart__tick" x={x0 - 8} y={py} dy="0.32em" textAnchor="end">{format(t)}</text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * Etiquetas del eje x abajo. La primera y la última no se salen del área: se anclan al borde.
 * @param {{ ticks: { value: number, label: string }[], x: (v: number) => number, y: number, x0: number, x1: number }} props
 */
export function XTicks({ ticks, x, y, x0, x1 }) {
  return (
    <g aria-hidden="true">
      <line className="kz-chart__axis-line" x1={x0} x2={x1} y1={Math.round(y) + 0.5} y2={Math.round(y) + 0.5} />
      {placeXTicks(ticks, x, x0, x1).map(({ value, label, px, anchor }) => {
        return (
          <g key={value}>
            <line className="kz-chart__axis-line" x1={Math.round(px) + 0.5} x2={Math.round(px) + 0.5} y1={y} y2={y + 4} />
            <text className="kz-chart__tick" x={px} y={y + 18} textAnchor={anchor}>{label}</text>
          </g>
        )
      })}
    </g>
  )
}
