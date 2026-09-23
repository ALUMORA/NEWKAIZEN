// Barras horizontales o verticales, con signo: con `signed` cada barra toma --up o --down y su
// valor lleva "+" o "−", así que el color nunca va solo. Los valores se imprimen junto a la barra
// en --ink-soft (nunca en el color de la serie).
import { useMemo } from 'react'
import { isNum } from '../../lib/format.js'
import { ChartFrame } from './ChartFrame.jsx'
import { YGrid } from './axes.jsx'
import { useWidth } from './hooks.js'
import { fitText, textWidth } from './measure.js'
import { linearScale, niceTicks, valueFormatter } from './scale.js'
import { resolveColor } from './series.js'

/**
 * @param {{
 *   data: { label: string, value: number | null, color?: string | number }[],
 *   orientation?: 'horizontal' | 'vertical', signed?: boolean, color?: string | number,
 *   format?: 'number' | 'money' | 'pct' | 'pp' | 'bp', currency?: string, decimals?: number,
 *   valueLabels?: boolean, height?: number, rowHeight?: number, categoryLabel?: string, valueLabel?: string,
 *   emptyText?: string,
 *   title: import('react').ReactNode, titleAs?: 'h2' | 'h3' | 'h4' | 'p', description?: import('react').ReactNode,
 *   summary?: string, status?: any, source?: import('react').ReactNode, actions?: import('react').ReactNode, className?: string,
 * }} props
 */
export function Bars({
  data, orientation = 'horizontal', signed = false, color, format = 'number', currency = 'MXN', decimals, valueLabels = true,
  height = 240, rowHeight = 30, categoryLabel = 'Concepto', valueLabel = 'Valor', emptyText = 'Sin datos para mostrar',
  title, titleAs, description, summary, status, source, actions, className,
}) {
  const [ref, width] = useWidth()
  const items = useMemo(() => (data ?? []).map((d) => ({ ...d, v: isNum(d.value) ? d.value : null })), [data])
  const vals = items.map((d) => d.v).filter(isNum)
  const empty = vals.length === 0
  const lo = Math.min(0, ...vals)
  const hi = Math.max(0, ...vals)
  const fmt = useMemo(() => valueFormatter(format, { currency, decimals: decimals ?? (format === 'bp' || format === 'money' ? 0 : 1), sign: signed }), [format, currency, decimals, signed])
  const colorOf = (d, i) => (signed ? (d.v < 0 ? 'var(--down)' : 'var(--up)') : resolveColor(d.color ?? color, d.color ? i : 0))
  const horizontal = orientation === 'horizontal'
  const plotH = horizontal ? Math.max(1, items.length) * rowHeight + 8 : height

  const table = empty ? null : {
    rowKey: 'label',
    rows: items.map((d) => ({ label: d.label, value: d.v })),
    columns: [
      { key: 'label', header: categoryLabel, sortable: true },
      { key: 'value', header: valueLabel, numeric: true, format: (v) => fmt(v), sortable: true },
    ],
  }
  const autoSummary = summary ?? (empty ? undefined : items.map((d) => `${d.label}: ${fmt(d.v)}`).join('. '))

  let content = null
  if (!empty && width > 0) {
    content = horizontal
      ? <HBars items={items} width={width} rowHeight={rowHeight} lo={lo} hi={hi} fmt={fmt} colorOf={colorOf} valueLabels={valueLabels} />
      : <VBars items={items} width={width} height={height} lo={lo} hi={hi} fmt={fmt} colorOf={colorOf} valueLabels={valueLabels} format={format} currency={currency} />
  }
  return (
    <ChartFrame title={title} titleAs={titleAs} description={description} summary={autoSummary} table={table}
      status={status} source={source} actions={actions} className={className}>
      <div ref={ref} className="kz-chart__plot" style={{ height: plotH }}>
        {empty ? <div className="kz-chart__empty">{emptyText}</div> : content}
      </div>
    </ChartFrame>
  )
}

function HBars({ items, width, rowHeight, lo, hi, fmt, colorOf, valueLabels }) {
  const labelW = Math.min(Math.max(...items.map((d) => textWidth(d.label))) + 10, width * 0.38)
  const valW = valueLabels ? Math.max(...items.map((d) => textWidth(fmt(d.v)))) + 8 : 4
  const left = labelW + (lo < 0 ? valW : 0)
  const right = width - (hi > 0 ? valW : 4)
  const sx = linearScale([lo, hi], [left, Math.max(left + 1, right)])
  const x0 = sx(0)
  const barH = Math.min(18, rowHeight * 0.62)
  const h = items.length * rowHeight + 8
  return (
    <svg className="kz-chart__svg" width={width} height={h} aria-hidden="true" focusable="false">
      {items.map((d, i) => {
        const cy = 4 + i * rowHeight + rowHeight / 2
        const xv = isNum(d.v) ? sx(d.v) : x0
        const neg = isNum(d.v) && d.v < 0
        return (
          <g key={`${d.label}${i}`}>
            <text className="kz-chart__label" x={0} y={cy} dy="0.32em">{fitText(d.label, labelW - 8)}</text>
            {isNum(d.v) && <rect x={Math.min(x0, xv)} y={cy - barH / 2} width={Math.max(1, Math.abs(xv - x0))} height={barH} rx={2} fill={colorOf(d, i)} />}
            {valueLabels && (
              <text className="kz-chart__label kz-chart__label--strong" x={neg ? xv - 6 : xv + 6} y={cy} dy="0.32em" textAnchor={neg ? 'end' : 'start'}>{fmt(d.v)}</text>
            )}
          </g>
        )
      })}
      <line className="kz-chart__zero" x1={Math.round(x0) + 0.5} x2={Math.round(x0) + 0.5} y1={0} y2={h} />
    </svg>
  )
}

function VBars({ items, width, height, lo, hi, fmt, colorOf, valueLabels, format, currency }) {
  const nice = niceTicks(lo, hi, Math.max(3, Math.round(height / 60)))
  const tickFmt = valueFormatter(format, { currency, step: nice.step })
  const margin = { top: valueLabels ? 22 : 10, bottom: 28, right: 6, left: Math.max(...nice.ticks.map((t) => textWidth(tickFmt(t)))) + 14 }
  const innerW = Math.max(1, width - margin.left - margin.right)
  const sy = linearScale([nice.min, nice.max], [height - margin.bottom, margin.top])
  const band = innerW / items.length
  const barW = Math.min(48, band * 0.64)
  const y0 = sy(0)
  const every = Math.max(1, Math.ceil(Math.max(...items.map((d) => textWidth(d.label))) / Math.max(1, band - 6)))
  const showVals = valueLabels && Math.max(...items.map((d) => textWidth(fmt(d.v)))) <= band - 2
  return (
    <svg className="kz-chart__svg" width={width} height={height} aria-hidden="true" focusable="false">
      <YGrid ticks={nice.ticks} y={sy} x0={margin.left} x1={width - margin.right} format={tickFmt} />
      {items.map((d, i) => {
        const cx = margin.left + band * i + band / 2
        const yv = isNum(d.v) ? sy(d.v) : y0
        const neg = isNum(d.v) && d.v < 0
        return (
          <g key={`${d.label}${i}`}>
            {isNum(d.v) && <rect x={cx - barW / 2} y={Math.min(y0, yv)} width={barW} height={Math.max(1, Math.abs(yv - y0))} rx={2} fill={colorOf(d, i)} />}
            {showVals && <text className="kz-chart__label kz-chart__label--strong" x={cx} y={neg ? yv + 14 : yv - 6} textAnchor="middle">{fmt(d.v)}</text>}
            {i % every === 0 && <text className="kz-chart__tick" x={cx} y={height - margin.bottom + 18} textAnchor="middle">{fitText(d.label, band * every - 4)}</text>}
          </g>
        )
      })}
      <line className="kz-chart__zero" x1={margin.left} x2={width - margin.right} y1={Math.round(y0) + 0.5} y2={Math.round(y0) + 0.5} />
    </svg>
  )
}
