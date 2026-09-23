// Frontera eficiente: dispersión de activos (riesgo contra rendimiento), la curva de la frontera y
// marcas de mínima varianza, tangente y portafolio actual. En oscuro tres colores no bastan para
// distinguir series (pedido 3 de C1): cada grupo tiene forma propia y etiqueta directa.
import { useMemo } from 'react'
import { isNum } from '../../lib/format.js'
import { ChartFrame } from './ChartFrame.jsx'
import { XTicks, YGrid } from './axes.jsx'
import { useWidth } from './hooks.js'
import { placeLabels, textWidth } from './measure.js'
import { extent, linearScale, niceTicks, valueFormatter } from './scale.js'
import { markerPath } from './series.js'

const MARKS = [
  { key: 'minVar', label: 'Mínima varianza', shape: 'diamond', color: 'var(--chart-3)' },
  { key: 'tangency', label: 'Tangente', shape: 'triangle', color: 'var(--chart-4)' },
  { key: 'current', label: 'Actual', shape: 'square', color: 'var(--chart-5)' },
]
const ASSET = { shape: 'circle', color: 'var(--chart-2)' }
const FRONTIER = 'var(--chart-1)'

/**
 * @param {{
 *   assets?: { label: string, risk: number, ret: number }[],
 *   frontier?: { risk: number, ret: number }[],
 *   markers?: { minVar?: { risk: number, ret: number }, tangency?: { risk: number, ret: number }, current?: { risk: number, ret: number } },
 *   height?: number, decimals?: number, emptyText?: string,
 *   title: import('react').ReactNode, titleAs?: 'h2' | 'h3' | 'h4' | 'p', description?: import('react').ReactNode,
 *   summary?: string, status?: any, source?: import('react').ReactNode, actions?: import('react').ReactNode, className?: string,
 * }} props
 *   risk y ret son fracciones anuales (0.18 = 18%).
 */
export function FrontierChart({
  assets = [], frontier = [], markers = {}, height = 320, decimals = 1, emptyText = 'Sin datos para mostrar',
  title, titleAs, description, summary, status, source, actions, className,
}) {
  const [ref, width] = useWidth()
  const fmt = useMemo(() => valueFormatter('pct', { decimals }), [decimals])
  const ok = (p) => p && isNum(p.risk) && isNum(p.ret)
  const pts = [...assets.filter(ok), ...frontier.filter(ok), ...MARKS.map((m) => markers[m.key]).filter(ok)]
  const empty = pts.length === 0
  const xe = extent(pts.map((p) => p.risk)) ?? [0, 1]
  const ye = extent(pts.map((p) => p.ret)) ?? [0, 1]
  const xn = niceTicks(Math.min(0, xe[0]), xe[1], Math.max(3, Math.floor(width / 110)))
  const yn = niceTicks(ye[0], ye[1], Math.max(3, Math.round(height / 60)))
  const tickX = valueFormatter('pct', { step: xn.step })
  const tickY = valueFormatter('pct', { step: yn.step })
  const margin = { top: 12, right: 16, bottom: 44, left: Math.max(...yn.ticks.map((t) => textWidth(tickY(t)))) + 14 }
  const x0 = margin.left
  const x1 = Math.max(x0 + 1, width - margin.right)
  const yBot = height - margin.bottom
  const sx = linearScale([xn.min, xn.max], [x0, x1])
  const sy = linearScale([yn.min, yn.max], [yBot, margin.top])
  const f = (n) => Number(n.toFixed(2))
  const line = frontier.filter(ok).sort((a, b) => a.ret - b.ret).map((p, i) => `${i ? 'L' : 'M'}${f(sx(p.risk))},${f(sy(p.ret))}`).join('')

  const legend = [
    ...(frontier.length ? [{ label: 'Frontera eficiente', color: FRONTIER, kind: /** @type {'line'} */ ('line') }] : []),
    ...(assets.length ? [{ label: 'Activos', color: ASSET.color, shape: ASSET.shape, kind: /** @type {'marker'} */ ('marker') }] : []),
    ...MARKS.filter((m) => ok(markers[m.key])).map((m) => ({ label: m.label, color: m.color, shape: m.shape, kind: /** @type {'marker'} */ ('marker') })),
  ]
  const rows = [
    ...assets.filter(ok).map((a) => ({ id: `a:${a.label}`, name: a.label, kind: 'Activo', risk: a.risk, ret: a.ret })),
    ...MARKS.filter((m) => ok(markers[m.key])).map((m) => ({ id: m.key, name: m.label, kind: 'Portafolio', risk: markers[m.key].risk, ret: markers[m.key].ret })),
  ]
  const table = empty ? null : {
    rowKey: 'id', rows,
    columns: [
      { key: 'name', header: 'Nombre', sortable: true },
      { key: 'kind', header: 'Tipo' },
      { key: 'risk', header: 'Riesgo (volatilidad)', numeric: true, format: (v) => fmt(v), sortable: true },
      { key: 'ret', header: 'Rendimiento esperado', numeric: true, format: (v) => fmt(v), sortable: true },
    ],
  }
  const autoSummary = summary ?? (empty ? undefined : MARKS.filter((m) => ok(markers[m.key]))
    .map((m) => `${m.label}: riesgo ${fmt(markers[m.key].risk)}, rendimiento ${fmt(markers[m.key].ret)}.`).join(' '))

  const labeled = [
    ...MARKS.filter((m) => ok(markers[m.key])).map((m) => ({ ...markers[m.key], shape: m.shape, color: m.color, text: m.label, strong: true })),
    ...assets.filter(ok).map((a) => ({ ...a, ...ASSET, text: a.label, strong: false })),
  ]
  const spots = empty || width <= 0 ? [] : placeLabels(labeled.map((p) => ({ x: sx(p.risk), y: sy(p.ret), text: p.text, optional: !p.strong })), { x0, x1: width, y0: 0, y1: yBot })
  return (
    <ChartFrame title={title} titleAs={titleAs} description={description} summary={autoSummary} legend={empty ? undefined : legend}
      table={table} status={status} source={source} actions={actions} className={className}>
      <div ref={ref} className="kz-chart__plot" style={{ height }}>
        {empty ? <div className="kz-chart__empty">{emptyText}</div> : width > 0 && (
          <svg className="kz-chart__svg" width={width} height={height} aria-hidden="true" focusable="false">
            <YGrid ticks={yn.ticks} y={sy} x0={x0} x1={x1} format={tickY} />
            <XTicks ticks={xn.ticks.map((t) => ({ value: t, label: tickX(t) }))} x={sx} y={yBot} x0={x0} x1={x1} />
            <text className="kz-chart__tick" x={(x0 + x1) / 2} y={height - 6} textAnchor="middle">Riesgo (volatilidad anual)</text>
            {line && <path className="kz-chart__line" d={line} stroke={FRONTIER} />}
            {labeled.map((p) => <path key={`m${p.text}`} className="kz-chart__marker" d={markerPath(p.shape, sx(p.risk), sy(p.ret), p.strong ? 6 : 4.5)} fill={p.color} />)}
            {labeled.map((p, i) => !spots[i].hidden && (
              <text key={`t${p.text}`} className={`kz-chart__label kz-chart__halo-text${p.strong ? ' kz-chart__label--strong' : ''}`}
                x={spots[i].x} y={spots[i].y} dy="0.32em" textAnchor={spots[i].anchor}>{p.text}</text>
            ))}
          </svg>
        )}
      </div>
    </ChartFrame>
  )
}
