// Dona con etiqueta al centro y leyenda con valores y participación. Más de 8 rebanadas: las
// menores se juntan en "Otros". La leyenda dice lo mismo que el color, así que nada vive en un hover.
import { useMemo } from 'react'
import { fmtPct } from '../../lib/format.js'
import { ChartFrame, Swatch } from './ChartFrame.jsx'
import { valueFormatter } from './scale.js'
import { layoutArcs, toSlices } from './slices.js'

/**
 * @param {{
 *   data: { label: string, value: number, color?: string | number }[],
 *   format?: 'number' | 'money' | 'pct', currency?: string, decimals?: number,
 *   centerLabel?: string, centerValue?: string, size?: number, maxSlices?: number, sort?: boolean,
 *   emptyText?: string,
 *   title: import('react').ReactNode, titleAs?: 'h2' | 'h3' | 'h4' | 'p', description?: import('react').ReactNode,
 *   summary?: string, status?: any, source?: import('react').ReactNode, actions?: import('react').ReactNode, className?: string,
 * }} props
 */
export function Donut({
  data, format = 'money', currency = 'MXN', decimals, centerLabel = 'Total', centerValue, size = 180, maxSlices = 8, sort = true,
  emptyText = 'Sin datos para mostrar', title, titleAs, description, summary, status, source, actions, className,
}) {
  const { slices, total } = useMemo(() => toSlices(data, { max: maxSlices, sort }), [data, maxSlices, sort])
  const fmt = useMemo(() => valueFormatter(format, { currency, decimals: decimals ?? (format === 'money' ? 0 : 2) }), [format, currency, decimals])
  const fmtCenter = useMemo(() => valueFormatter(format, { currency, decimals: 1, compact: total >= 100000 }), [format, currency, total])
  const arcs = useMemo(() => layoutArcs(slices, size), [slices, size])
  const empty = slices.length === 0
  const autoSummary = summary ?? (empty ? undefined : `Total ${fmt(total)}. ${slices.map((s) => `${s.label} ${fmtPct(s.share, { decimals: 1 })}`).join(', ')}.`)
  const table = empty ? null : {
    rowKey: 'label',
    rows: slices.map((s) => ({ label: s.others ? `${s.label} (${s.members.join(', ')})` : s.label, value: s.value, share: s.share })),
    columns: [
      { key: 'label', header: 'Concepto', sortable: true },
      { key: 'value', header: 'Valor', numeric: true, format: (v) => fmt(v), sortable: true },
      { key: 'share', header: 'Participación', numeric: true, format: (v) => fmtPct(v, { decimals: 1 }), sortable: true },
    ],
  }
  return (
    <ChartFrame title={title} titleAs={titleAs} description={description} summary={autoSummary} table={table}
      status={status} source={source} actions={actions} className={className}>
      {empty ? (
        <div className="kz-chart__empty" style={{ height: size }}>{emptyText}</div>
      ) : (
        <div className="kz-donut">
          <div className="kz-donut__ring" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
              {arcs.map((a) => <path key={a.label} d={a.d} fill={a.color} fillRule="evenodd" />)}
            </svg>
            <div className="kz-donut__center" aria-hidden="true">
              <span className="kz-donut__center-label">{centerLabel}</span>
              <span className="kz-donut__center-value num">{centerValue ?? (total >= 100000 ? fmtCenter(total) : fmt(total))}</span>
            </div>
          </div>
          <ul className="kz-donut__legend" aria-label="Leyenda">
            {slices.map((s) => (
              <li key={s.label} className="kz-donut__item">
                <Swatch color={s.color} kind="area" />
                <span className="kz-donut__name">{s.label}</span>
                <span className="kz-donut__value num">{fmt(s.value)}</span>
                <span className="kz-donut__share num">{fmtPct(s.share, { decimals: 1 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartFrame>
  )
}
