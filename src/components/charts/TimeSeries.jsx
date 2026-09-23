// Serie de tiempo: varias líneas, área y bandas opcionales, escala log, base en 0 para
// rendimientos, cruceta y tooltip con puntero y con teclado. Alto fijo (sin saltos de layout),
// ancho por ResizeObserver y puntero a un cálculo por cuadro.
import { useId, useMemo, useState } from 'react'
import { fmtNumber, isNum } from '../../lib/format.js'
import { ChartFrame, Swatch } from './ChartFrame.jsx'
import { XTicks, YGrid } from './axes.jsx'
import { textWidth } from './measure.js'
import { useRafHandler, useWidth } from './hooks.js'
import { fmtAxisDate, linearScale, logScale, nearestIndex, niceTicks, timeScale, timeTicks, valueFormatter } from './scale.js'
import { bandPath, linePaths, prepareTime, yDomainOf } from './timeData.js'

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'])

/**
 * @param {{
 *   series: { id?: string, label: string, points: { date?: any, x?: number, value: number | null }[], color?: string | number, area?: boolean, dash?: boolean }[],
 *   bands?: { id?: string, label: string, points: { date?: any, x?: number, lower: number, upper: number }[], color?: string | number, opacity?: number }[],
 *   format?: 'number' | 'money' | 'pct' | 'pp' | 'bp', currency?: string, decimals?: number,
 *   log?: boolean, area?: boolean, zeroBaseline?: boolean, yDomain?: [number?, number?],
 *   xType?: 'time' | 'number', xFormat?: (x: number) => string, xLabel?: string,
 *   height?: number, emptyText?: string, legend?: boolean, table?: boolean,
 *   title: import('react').ReactNode, titleAs?: 'h2' | 'h3' | 'h4' | 'p', description?: import('react').ReactNode,
 *   summary?: string, status?: any, source?: import('react').ReactNode, actions?: import('react').ReactNode, className?: string,
 * }} props
 */
export function TimeSeries({
  series, bands = [], format = 'number', currency = 'MXN', decimals, log = false, area = false, zeroBaseline = false, yDomain,
  xType = 'time', xFormat, xLabel, height = 280, emptyText = 'Sin datos para este periodo', legend, table = true,
  title, titleAs, description, summary, status, source, actions, className,
}) {
  const [ref, width] = useWidth()
  const [active, setActive] = useState(/** @type {number | null} */ (null))
  const [viaKeyboard, setViaKeyboard] = useState(false)
  const liveId = useId()

  const data = useMemo(() => prepareTime(series, bands, xType), [series, bands, xType])
  const { xs } = data
  const n = xs.length
  const fmtX = useMemo(() => xFormat ?? (xType === 'time' ? fmtAxisDate : (v) => fmtNumber(v, { decimals: 0 })), [xFormat, xType])
  const yTickCount = Math.max(3, Math.round(height / 60))
  const yInfo = useMemo(() => yDomainOf(data, { log, zeroBaseline, yDomain, count: yTickCount }), [data, log, zeroBaseline, yDomain, yTickCount])
  const maxAbs = yInfo ? Math.max(Math.abs(yInfo.domain[0]), Math.abs(yInfo.domain[1])) : 0
  const fmtTick = useMemo(() => valueFormatter(format, { currency, step: yInfo?.step ?? (log ? maxAbs / 10 : undefined) }), [format, currency, yInfo, log, maxAbs])
  const fmtValue = useMemo(() => valueFormatter(format, { currency, decimals: decimals ?? (format === 'bp' ? 0 : 2), compact: maxAbs >= 1e7 }), [format, currency, decimals, maxAbs])

  const empty = n === 0 || !yInfo
  const tickLabels = empty ? [] : yInfo.ticks.map(fmtTick)
  const margin = { top: 10, right: 14, bottom: 30, left: Math.max(36, Math.ceil(Math.max(0, ...tickLabels.map(textWidth))) + 14) }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = Math.max(0, height - margin.top - margin.bottom)
  const x0 = margin.left
  const x1 = margin.left + innerW
  const yTop = margin.top
  const yBot = margin.top + innerH

  const geo = useMemo(() => {
    if (empty || innerW <= 0) return null
    const single = n === 1
    const xDomain = single ? [xs[0] - 1, xs[0] + 1] : [xs[0], xs[n - 1]]
    const sx = single ? () => (x0 + x1) / 2 : xType === 'time' ? timeScale(xDomain, [x0, x1]) : linearScale(xDomain, [x0, x1])
    const sy = log ? logScale(yInfo.domain, [yBot, yTop]) : linearScale(yInfo.domain, [yBot, yTop])
    const zeroIn = !log && yInfo.domain[0] <= 0 && yInfo.domain[1] >= 0
    const baseY = zeroIn ? sy(0) : yBot
    const xTicks = single
      ? [{ value: xs[0], label: xType === 'time' ? fmtAxisDate(xs[0]) : fmtX(xs[0]) }]
      : xType === 'time'
        ? timeTicks(xDomain[0], xDomain[1], Math.max(3, Math.floor(innerW / 75)))
        : niceTicks(xDomain[0], xDomain[1], Math.max(2, Math.floor(innerW / 80))).ticks.filter((t) => t >= xDomain[0] && t <= xDomain[1]).map((t) => ({ value: t, label: fmtX(t) }))
    const px = xs.map((x) => sx(x))
    const lines = data.series.map((s) => ({ s, ...linePaths(xs, s.map, sx, sy, (s.area ?? area) ? baseY : null) }))
    const bandShapes = data.bands.map((b) => ({ b, d: bandPath(xs, b.map, sx, sy) }))
    return { sx, sy, zeroIn, xTicks, px, lines, bandShapes }
  }, [empty, innerW, n, xs, x0, x1, xType, log, yInfo, yBot, yTop, data, area, fmtX])

  const onPointer = useRafHandler((clientX) => {
    const el = ref.current
    if (!el || !geo) return
    const rect = el.getBoundingClientRect()
    const i = nearestIndex(geo.px, clientX - rect.left)
    setViaKeyboard(false)
    setActive(i < 0 ? null : i)
  })

  function onKeyDown(e) {
    if (!KEYS.has(e.key) || n === 0) return
    e.preventDefault()
    if (e.key === 'Escape') { setActive(null); return }
    const cur = active ?? n - 1
    const page = Math.max(1, Math.round(n / 10))
    const next = {
      ArrowLeft: cur - 1, ArrowDown: cur - 1, ArrowRight: cur + 1, ArrowUp: cur + 1,
      Home: 0, End: n - 1, PageUp: cur + page, PageDown: cur - page,
    }[e.key]
    setViaKeyboard(true)
    setActive(Math.min(n - 1, Math.max(0, next)))
  }

  const activeX = active !== null && active < n ? xs[active] : null
  const rows = activeX === null ? [] : [
    ...data.series.map((s) => ({ key: s.id, label: s.label, color: s.color, kind: s.dash ? 'dash' : 'line', text: fmtValue(s.map.get(activeX)) })),
    ...data.bands.filter((b) => b.map.has(activeX)).map((b) => ({ key: b.id, label: b.label, color: b.color, kind: 'band', opacity: bandOpacity(b, data.bands.indexOf(b)), text: `${fmtValue(b.map.get(activeX)[0])} a ${fmtValue(b.map.get(activeX)[1])}` })),
  ]
  const activeLabel = activeX === null ? '' : fmtX(activeX)
  const liveText = viaKeyboard && activeX !== null ? `${activeLabel}. ${rows.map((r) => `${r.label}: ${r.text}`).join('. ')}` : ''

  const legendItems = (legend ?? (data.series.length + data.bands.length > 1)) ? [
    ...data.series.map((s) => ({ label: s.label, color: s.color, kind: /** @type {'line' | 'dash'} */ (s.dash ? 'dash' : 'line') })),
    ...data.bands.map((b, i) => ({ label: b.label, color: b.color, kind: /** @type {'band'} */ ('band'), opacity: bandOpacity(b, i) })),
  ] : undefined

  const tableData = table ? {
    rowKey: 'x',
    rows: xs.map((x) => {
      const row = { x }
      for (const s of data.series) row[`s:${s.id}`] = s.map.get(x) ?? null
      for (const b of data.bands) { const v = b.map.get(x); row[`l:${b.id}`] = v?.[0] ?? null; row[`u:${b.id}`] = v?.[1] ?? null }
      return row
    }),
    columns: [
      { key: 'x', header: xLabel ?? (xType === 'time' ? 'Fecha' : 'Periodo'), format: (v) => fmtX(v), sortable: true, sortValue: (r) => r.x },
      ...data.series.map((s) => ({ key: `s:${s.id}`, header: s.label, numeric: true, format: (v) => fmtValue(v), sortable: true })),
      ...data.bands.flatMap((b) => [
        { key: `l:${b.id}`, header: `${b.label}, inferior`, numeric: true, format: (v) => fmtValue(v) },
        { key: `u:${b.id}`, header: `${b.label}, superior`, numeric: true, format: (v) => fmtValue(v) },
      ]),
    ],
  } : null

  const autoSummary = summary ?? (empty ? undefined : describeSeries(data, xs, fmtX, fmtValue))
  const tipLeft = geo && activeX !== null ? geo.px[active] : 0
  const flip = tipLeft > width * 0.55

  return (
    <ChartFrame title={title} titleAs={titleAs} description={description} summary={autoSummary} legend={legendItems}
      table={empty ? null : tableData} status={status} source={source} actions={actions} className={className}>
      <div
        ref={ref}
        className="kz-chart__plot"
        style={{ height }}
        tabIndex={empty ? undefined : 0}
        role={empty ? undefined : 'group'}
        aria-roledescription={empty ? undefined : 'gráfica'}
        aria-label={empty ? undefined : 'Gráfica interactiva. Las flechas izquierda y derecha recorren los datos; Inicio y Fin van a los extremos.'}
        aria-describedby={empty ? undefined : liveId}
        onPointerMove={empty ? undefined : (e) => onPointer(e.clientX)}
        onPointerDown={empty ? undefined : (e) => onPointer(e.clientX)}
        onPointerLeave={() => { if (!viaKeyboard) setActive(null) }}
        onKeyDown={onKeyDown}
        onFocus={() => { if (active === null && n > 0) { setViaKeyboard(true); setActive(n - 1) } }}
        onBlur={() => { setActive(null); setViaKeyboard(false) }}
      >
        {empty ? (
          <div className="kz-chart__empty">{emptyText}</div>
        ) : (
          <svg className="kz-chart__svg" width={width || undefined} height={height} aria-hidden="true" focusable="false">
            {geo && (
              <>
                <YGrid ticks={yInfo.ticks} y={geo.sy} x0={x0} x1={x1} format={fmtTick} />
                {geo.zeroIn && zeroBaseline && <line className="kz-chart__zero" x1={x0} x2={x1} y1={Math.round(geo.sy(0)) + 0.5} y2={Math.round(geo.sy(0)) + 0.5} />}
                <XTicks ticks={geo.xTicks} x={geo.sx} y={yBot} x0={x0} x1={x1} />
                {geo.bandShapes.map(({ b, d }, i) => d && <path key={b.id} className="kz-chart__band" d={d} fill={b.color} opacity={bandOpacity(b, i)} />)}
                {geo.lines.map(({ s, area: a }) => a && <path key={`a${s.id}`} className="kz-chart__area" d={a} fill={s.color} />)}
                {geo.lines.map(({ s, line }) => line && <path key={`l${s.id}`} className="kz-chart__line" d={line} stroke={s.color} strokeDasharray={s.dash ? '5 4' : undefined} />)}
                {geo.lines.flatMap(({ s, singles }) => singles.map(([cx, cy]) => <circle key={`p${s.id}${cx}`} className="kz-chart__dot" cx={cx} cy={cy} r={4} fill={s.color} />))}
                {activeX !== null && (
                  <g>
                    <line className="kz-chart__crosshair" x1={geo.px[active]} x2={geo.px[active]} y1={yTop} y2={yBot} />
                    {data.series.map((s) => {
                      const v = s.map.get(activeX)
                      const cy = isNum(v) ? geo.sy(v) : NaN
                      return isNum(cy) ? <circle key={s.id} className="kz-chart__dot" cx={geo.px[active]} cy={cy} r={4.5} fill={s.color} /> : null
                    })}
                  </g>
                )}
              </>
            )}
          </svg>
        )}
        {!empty && activeX !== null && geo && (
          <div className="kz-chart__tooltip" aria-hidden="true"
            style={{ transform: flip ? `translate(calc(${Math.round(tipLeft - 12)}px - 100%), ${yTop}px)` : `translate(${Math.round(tipLeft + 12)}px, ${yTop}px)` }}>
            <p className="kz-chart__tooltip-title num">{activeLabel}</p>
            {rows.map((r) => (
              <div key={r.key} className="kz-chart__tooltip-row">
                <span className="kz-chart__tooltip-name"><Swatch color={r.color} kind={r.kind} opacity={r.opacity} />{r.label}</span>
                <span className="kz-chart__tooltip-value">{r.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p id={liveId} className="sr-only" aria-live="polite">{liveText}</p>
    </ChartFrame>
  )
}

/** Opacidad de una banda: la exterior más tenue que la interior. */
function bandOpacity(b, i) {
  return b.opacity ?? (i === 0 ? 0.24 : 0.45)
}

/** Resumen para lector de pantalla: primer y último valor de cada serie, con mínimo y máximo. */
function describeSeries(data, xs, fmtX, fmtValue) {
  return data.series.map((s) => {
    const pts = xs.filter((x) => isNum(s.map.get(x)))
    if (!pts.length) return `${s.label}: sin datos.`
    const first = pts[0]
    const last = pts.at(-1)
    let lo = first
    let hi = first
    for (const x of pts) { if (s.map.get(x) < s.map.get(lo)) lo = x; if (s.map.get(x) > s.map.get(hi)) hi = x }
    if (pts.length === 1) return `${s.label}: ${fmtValue(s.map.get(first))} el ${fmtX(first)}.`
    return `${s.label}: de ${fmtValue(s.map.get(first))} el ${fmtX(first)} a ${fmtValue(s.map.get(last))} el ${fmtX(last)}; máximo ${fmtValue(s.map.get(hi))}, mínimo ${fmtValue(s.map.get(lo))}.`
  }).join(' ')
}
