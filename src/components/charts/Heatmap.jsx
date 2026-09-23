// Mapa de calor divergente (azul y naranja), pensado para correlaciones. Imprime el valor en la
// celda cuando cabe; si no, la tabla y el resumen lo dicen.
import { useMemo } from 'react'
import { MISSING, isNum } from '../../lib/format.js'
import { ChartFrame } from './ChartFrame.jsx'
import { useWidth } from './hooks.js'
import { fitText, textWidth } from './measure.js'
import { valueFormatter } from './scale.js'
import { CUTS, DIVERGING, divergingIndex, maxAbs } from './diverging.js'

/**
 * @param {{
 *   rows: string[], columns: string[], values: (number | null)[][],
 *   max?: number, format?: 'number' | 'pct', decimals?: number, showValues?: 'auto' | boolean,
 *   cellHeight?: number, emptyText?: string,
 *   title: import('react').ReactNode, titleAs?: 'h2' | 'h3' | 'h4' | 'p', description?: import('react').ReactNode,
 *   summary?: string, status?: any, source?: import('react').ReactNode, actions?: import('react').ReactNode, className?: string,
 * }} props
 *   max: tope del dominio simétrico [−max, max] (1 para correlaciones; por omisión, el máximo absoluto).
 */
export function Heatmap({
  rows, columns, values, max, format = 'number', decimals = 2, showValues = 'auto', cellHeight = 34, emptyText = 'Sin datos para mostrar',
  title, titleAs, description, summary, status, source, actions, className,
}) {
  const [ref, width] = useWidth()
  const top = maxAbs(values)
  const m = max ?? top
  const fmt = useMemo(() => valueFormatter(format, { decimals }), [format, decimals])
  const empty = !rows?.length || !columns?.length
  const legend = empty ? undefined : DIVERGING.map((color, i) => {
    const edges = [-m, ...CUTS.map((c) => c * m), m]
    return { label: `${fmt(edges[i])} a ${fmt(edges[i + 1])}`, color, kind: /** @type {'area'} */ ('area') }
  })
  const table = empty ? null : {
    rowKey: 'row',
    rows: rows.map((r, i) => Object.fromEntries([['row', r], ...columns.map((c, j) => [`c${j}`, values?.[i]?.[j] ?? null])])),
    columns: [{ key: 'row', header: 'Fila' }, ...columns.map((c, j) => ({ key: `c${j}`, header: c, numeric: true, format: (v) => fmt(v) }))],
  }
  const autoSummary = summary ?? (empty ? undefined : describeExtremes(rows, columns, values, fmt))

  const labelW = empty ? 0 : Math.min(Math.max(...rows.map(textWidth)) + 10, width * 0.3)
  const headH = 24
  const cellW = empty ? 0 : Math.max(1, (width - labelW) / columns.length)
  const h = empty ? 160 : headH + rows.length * cellHeight
  const fits = (s) => (showValues === true || (showValues === 'auto' && textWidth(s) + 8 <= cellW && cellHeight >= 20))
  return (
    <ChartFrame title={title} titleAs={titleAs} description={description} summary={autoSummary} legend={legend} table={table}
      status={status} source={source} actions={actions} className={className}>
      <div ref={ref} className="kz-chart__plot" style={{ height: h }}>
        {empty ? <div className="kz-chart__empty">{emptyText}</div> : width > 0 && (
          <svg className="kz-chart__svg" width={width} height={h} aria-hidden="true" focusable="false">
            {columns.map((c, j) => (
              <text key={`h${j}`} className="kz-chart__tick" x={labelW + cellW * j + cellW / 2} y={headH - 8} textAnchor="middle">{fitText(c, cellW - 2)}</text>
            ))}
            {rows.map((r, i) => (
              <g key={`r${i}`}>
                <text className="kz-chart__label" x={0} y={headH + cellHeight * i + cellHeight / 2} dy="0.32em">{fitText(r, labelW - 8)}</text>
                {columns.map((c, j) => {
                  const v = values?.[i]?.[j]
                  const k = divergingIndex(v, m)
                  const text = isNum(v) ? fmt(v) : MISSING
                  const x = labelW + cellW * j
                  const y = headH + cellHeight * i
                  return (
                    <g key={`c${j}`}>
                      <rect className="kz-heatmap__cell" x={x + 1} y={y + 1} width={Math.max(0, cellW - 2)} height={cellHeight - 2} rx={2}
                        fill={k < 0 ? 'var(--surface-2)' : DIVERGING[k]} />
                      {fits(text) && (
                        <text className={k < 0 ? 'kz-chart__tick' : 'kz-heatmap__value'} x={x + cellW / 2} y={y + cellHeight / 2} dy="0.32em" textAnchor="middle">{text}</text>
                      )}
                    </g>
                  )
                })}
              </g>
            ))}
          </svg>
        )}
      </div>
    </ChartFrame>
  )
}

/** Par con la correlación más alta y la más baja, fuera de la diagonal. */
function describeExtremes(rows, columns, values, fmt) {
  let hi = null
  let lo = null
  rows.forEach((r, i) => columns.forEach((c, j) => {
    const v = values?.[i]?.[j]
    if (!isNum(v) || r === c) return
    if (!hi || v > hi.v) hi = { r, c, v }
    if (!lo || v < lo.v) lo = { r, c, v }
  }))
  if (!hi) return undefined
  return `Valor más alto: ${hi.r} con ${hi.c}, ${fmt(hi.v)}. Más bajo: ${lo.r} con ${lo.c}, ${fmt(lo.v)}.`
}
