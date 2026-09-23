// Marco común de todas las gráficas: título, descripción visible y para lector de pantalla,
// leyenda, botón "Ver tabla" (la alternativa de texto, con el DataTable de C1) y pie con la fuente
// y el DataStatus del dato.
import { useId, useState } from 'react'
import { Button, DataStatus, DataTable } from '../ui/index.js'
import { markerPath } from './series.js'
import './charts.css'

/**
 * @typedef {{ label: import('react').ReactNode, color: string, value?: import('react').ReactNode,
 *   shape?: string, kind?: 'line' | 'area' | 'marker' | 'band' | 'dash', opacity?: number }} LegendItem
 * @typedef {{ columns: any[], rows: any[], rowKey: string | ((row: any) => string) }} ChartTable
 */

/** Muestra de color de la leyenda: línea, área, banda o marcador con su forma. */
export function Swatch({ color, shape = 'circle', kind = 'line', opacity = undefined }) {
  return (
    <svg className="kz-chart__swatch" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
      {kind === 'marker' && <path d={markerPath(shape, 8, 6, 4.5)} fill={color} />}
      {kind === 'line' && <line x1="1" x2="15" y1="6" y2="6" stroke={color} strokeWidth="2.5" strokeLinecap="round" />}
      {kind === 'dash' && <line x1="1" x2="15" y1="6" y2="6" stroke={color} strokeWidth="2" strokeDasharray="3 2" />}
      {(kind === 'area' || kind === 'band') && <rect x="1" y="1" width="14" height="10" rx="2" fill={color} opacity={opacity} />}
    </svg>
  )
}

/** Leyenda como lista; cada entrada trae su muestra y, si se da, su valor. */
export function Legend({ items }) {
  if (!items?.length) return null
  return (
    <ul className="kz-chart__legend" aria-label="Leyenda">
      {items.map((item, i) => (
        <li key={i} className="kz-chart__legend-item">
          <Swatch color={item.color} shape={item.shape} kind={item.kind} opacity={item.opacity} />
          <span>{item.label}</span>
          {item.value != null && <span className="kz-chart__legend-value num">{item.value}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * @param {{
 *   title: import('react').ReactNode,
 *   titleAs?: 'h2' | 'h3' | 'h4' | 'p',
 *   description?: import('react').ReactNode,
 *   summary?: string,
 *   legend?: LegendItem[],
 *   table?: ChartTable | null,
 *   tableCaption?: string,
 *   status?: import('../ui/status.js').DataStatusMeta & { now?: number },
 *   source?: import('react').ReactNode,
 *   actions?: import('react').ReactNode,
 *   className?: string,
 *   children?: import('react').ReactNode,
 * }} props
 *   description: pie visible bajo el título; summary: texto solo para lector de pantalla con lo que
 *   la gráfica muestra (tendencia, extremos); table: filas para "Ver tabla".
 */
export function ChartFrame({
  title, titleAs = 'h3', description, summary, legend, table, tableCaption, status, source, actions, className, children,
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const Heading = titleAs
  const titleId = `${id}-t`
  const descId = `${id}-d`
  const sumId = `${id}-s`
  const tableId = `${id}-tabla`
  const describedBy = [description && descId, summary && sumId].filter(Boolean).join(' ') || undefined
  const caption = tableCaption ?? (typeof title === 'string' ? `Datos de ${title}` : 'Datos de la gráfica')
  const hasTable = !!table && Array.isArray(table.rows)
  return (
    <figure className={['kz-chart', className].filter(Boolean).join(' ')} aria-labelledby={titleId} aria-describedby={describedBy}>
      <div className="kz-chart__header">
        <div className="kz-chart__heading">
          <Heading id={titleId} className="kz-chart__title">{title}</Heading>
          {description && <p id={descId} className="kz-chart__caption">{description}</p>}
          {summary && <p id={sumId} className="sr-only">{summary}</p>}
        </div>
        {(actions || hasTable) && (
          <div className="kz-chart__actions">
            {actions}
            {hasTable && (
              <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((v) => !v)}>
                {open ? 'Ocultar tabla' : 'Ver tabla'}
              </Button>
            )}
          </div>
        )}
      </div>
      {legend && legend.length > 0 && <Legend items={legend} />}
      <div className="kz-chart__body">{children}</div>
      {hasTable && (
        <div id={tableId} className="kz-chart__table" hidden={!open}>
          {open && <DataTable columns={table.columns} rows={table.rows} rowKey={table.rowKey} caption={caption} density="compact" empty={{ title: 'Sin datos' }} />}
        </div>
      )}
      {(source || status) && (
        <figcaption className="kz-chart__footer">
          {source ? <p className="kz-chart__source">Fuente: {source}</p> : <span />}
          {status && <DataStatus {...status} />}
        </figcaption>
      )}
    </figure>
  )
}
