// Resultado walk forward: cada método fuera de muestra al lado de lo que habría dado con los pesos
// de toda la historia, con las notas de convergencia de cada corte.
import { Card, DataTable, EmptyState, SrOnly } from '../../../components/ui/index.js'
import { MISSING, fmtDate, fmtPct, fmtPp } from '../../../lib/format.js'
import { ESTIMATION_WINDOW, HOLD_PERIODS } from '../validation.js'

const pct = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? MISSING : fmtPct(v, { decimals: 1 }))

const COLUMNS = [
  { key: 'label', header: 'Método' },
  { key: 'oosRet', header: <>Rendimiento<SrOnly> anual fuera de muestra</SrOnly></>, numeric: true, sortable: true, format: pct },
  { key: 'oosVol', header: <>Volatilidad<SrOnly> fuera de muestra</SrOnly></>, numeric: true, sortable: true, format: pct },
  { key: 'oosMdd', header: <>Caída máxima<SrOnly> fuera de muestra</SrOnly></>, numeric: true, sortable: true, format: pct },
  { key: 'insRet', header: <>Con toda la historia<SrOnly>, rendimiento anual</SrOnly></>, numeric: true, sortable: true, format: pct },
  { key: 'gap', header: 'Brecha', numeric: true, sortable: true, format: (v) => (v === null ? MISSING : fmtPp(v, { decimals: 1 })) },
]

/**
 * Agrupa notas repetidas: "El optimizador no convergió…" en 3 cortes es una sola línea.
 * @param {{ method: string, date: string, note: string }[]} notes
 */
function groupNotes(notes) {
  /** @type {Map<string, { method: string, note: string, dates: string[] }>} */
  const out = new Map()
  for (const n of notes) {
    const key = `${n.method}|${n.note}`
    if (!out.has(key)) out.set(key, { method: n.method, note: n.note, dates: [] })
    out.get(key).dates.push(n.date)
  }
  return [...out.values()]
}

/** @param {{ result: ReturnType<typeof import('../validation.js').runValidation>, periods: number, status?: any }} props */
export function ValidationCard({ result, periods, status }) {
  const title = 'Validación fuera de muestra (walk forward)'
  const info = { termKey: 'walk-forward', term: 'Walk forward' }
  if (!result) {
    return (
      <Card title={title} info={info} status={status}>
        <EmptyState
          size="sm"
          title="No alcanza la historia para validar"
          text={`Hacen falta más de ${ESTIMATION_WINDOW} semanas en común entre todas las emisoras y hay ${periods}. Quita la emisora con menos historia o prueba con otras.`}
        />
      </Card>
    )
  }
  const rows = result.rows.map((r) => ({
    id: r.id,
    label: r.label,
    oosRet: r.oos.ret,
    oosVol: r.oos.vol,
    oosMdd: r.oos.maxDrawdown,
    insRet: r.inSample?.ret ?? null,
    gap: r.inSample && r.inSample.ret !== null && r.oos.ret !== null ? r.inSample.ret - r.oos.ret : null,
  }))
  const groups = groupNotes(result.notes)
  return (
    <Card
      title={title}
      info={info}
      status={status}
      description={`${result.folds} cortes de ${HOLD_PERIODS} semanas, del ${fmtDate(result.start)} al ${fmtDate(result.end)}. Cada corte estima con las ${ESTIMATION_WINDOW} semanas anteriores y se mide en las siguientes.`}
    >
      <div className="kz-tool__stack">
        <p className="kz-tool__hint">Rendimiento anual compuesto, volatilidad y caída máxima medidos fuera de muestra, junto al rendimiento que habrían dado los pesos calculados con toda la historia.</p>
        <DataTable caption="Walk forward contra toda la historia" captionHidden columns={COLUMNS} rows={rows} rowKey="id" density="compact" />
      </div>
      <ul className="kz-tool__notes">
        <li>La columna con toda la historia usa pesos calculados sabiendo el futuro, en las mismas fechas. La brecha es cuánto del resultado era ajuste al pasado.</li>
        <li>Aquí el máximo Sharpe usa el promedio histórico de cada ventana, no el CAPM de arriba: mide la versión más ruidosa.</li>
        <li>Sin comisiones ni impuestos. Los rendimientos pasados no garantizan los futuros.</li>
      </ul>
      <div className="kz-tool__subsection">
        <h3 className="kz-tool__subtitle">Notas de convergencia</h3>
        {groups.length === 0 ? (
          <p className="kz-tool__hint">Todos los cortes convergieron y ninguno necesitó un respaldo.</p>
        ) : (
          <ul className="kz-tool__notes">
            {groups.map((g) => (
              <li key={`${g.method}-${g.note}`}>
                <strong>{g.method}</strong>, {g.dates.length === 1 ? (g.dates[0] === 'Toda la historia' ? 'con toda la historia' : `corte del ${fmtDate(g.dates[0])}`) : `${g.dates.length} cortes`}: {g.note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
