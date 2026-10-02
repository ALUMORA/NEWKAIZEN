// /mercados/calendario: agenda semanal o mensual de Banxico, la Fed, INEGI y el BLS, con dato anterior
// y publicado, cuenta regresiva a las dos decisiones y descarga a un .ics.
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CalendarPlus } from 'lucide-react'
import { ApiNotes, Badge, Button, Card, EmptyState, ErrorState, InfoTip, PageHeader, SegmentedControl, Skeleton, Stat } from '../../../components/ui/index.js'
import { economicCalendarQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { fmtDate, fmtWeekday } from '../../../lib/format.js'
import { PATHS } from '../../../app/paths.js'
import { COUNTRY_LABEL, KIND_LABEL, countdownText, fmtEventValue, groupByDay, parseAnchor, parseCountries, shiftAnchor, todayMx, windowFor, windowText } from '../lib/model.js'
import { downloadIcs } from '../lib/ics.js'
import '../economy.css'

const CONSENSUS_TIP = 'Las fuentes de consenso del mercado son de pago, así que aquí no se muestra. Kaizen no estima un consenso propio.'
const COUNTRY_ITEMS = [
  { value: 'mx,us', label: 'Los dos' },
  { value: 'mx', label: 'México' },
  { value: 'us', label: 'EE. UU.' },
]
const VIEW_ITEMS = [
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
]

/** @param {{ ev: import('../types.js').EconomicEvent }} props */
function EventRow({ ev }) {
  return (
    <li className="econ-event">
      <span className="econ-event__time">{ev.timeLocal ?? 'Sin hora'}</span>
      <div className="econ-event__main">
        <p className="econ-event__title">
          {ev.title}
          {ev.period ? `, ${ev.period}` : ''}
        </p>
        <div className="econ-event__badges">
          <Badge tone={ev.country === 'MX' ? 'accent' : 'info'}>{COUNTRY_LABEL[ev.country]}</Badge>
          <Badge tone={ev.kind === 'decision' ? 'warning' : 'neutral'}>{KIND_LABEL[ev.kind]}</Badge>
        </div>
      </div>
      <dl className="econ-event__values">
        <dt>Anterior</dt>
        <dt>Publicado</dt>
        <dt>Consenso</dt>
        <dd>{fmtEventValue(ev.previous, ev.unit)}</dd>
        <dd>{fmtEventValue(ev.actual, ev.unit)}</dd>
        <dd>
          s/d <InfoTip termKey="consenso" term="Consenso" text={CONSENSUS_TIP} />
        </dd>
      </dl>
    </li>
  )
}

function Countdown({ data, loading }) {
  const bx = data?.nextDecisions?.banxico
  const fed = data?.nextDecisions?.fed
  return (
    <div className="econ-countdown">
      <Stat
        label="Próxima decisión de Banxico"
        value={loading ? undefined : countdownText(bx?.daysLeft)}
        sublabel={bx ? `${fmtDate(bx.date)}, 13:00 hora del centro` : 'Sin fecha publicada'}
        info={{ termKey: 'tasa-objetivo', term: 'Tasa objetivo de Banxico' }}
        loading={loading}
      />
      <Stat
        label="Próxima decisión de la Fed"
        value={loading ? undefined : countdownText(fed?.daysLeft)}
        sublabel={fed ? `${fmtDate(fed.date)}, 12:00 hora del centro` : 'Sin fecha publicada'}
        loading={loading}
      />
    </div>
  )
}

/** Avisos de hasta dónde cubre cada calendario. */
function coverageText(coverage) {
  if (!coverage) return null
  const parts = [
    ['Banxico', coverage.banxicoUntil],
    ['la Fed', coverage.fomcUntil],
    ['INEGI', coverage.inegiUntil],
    ['BLS', coverage.blsUntil],
  ].map(([name, until]) => `${name} hasta el ${until ? fmtDate(until) : 's/d'}`)
  return `Calendarios publicados: ${parts.join(', ')}. Después de esas fechas no se muestra ningún evento.`
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const today = todayMx()
  const view = params.get('vista') === 'mes' ? 'mes' : 'semana'
  const anchor = parseAnchor(params.get('semana'), today)
  const countries = parseCountries(params.get('pais'))
  const win = useMemo(() => windowFor(view, anchor), [view, anchor])
  const feature = useFeature(['calendar.economic'])
  const q = useQuery({ ...economicCalendarQuery({ start: win.start, end: win.end, country: countries }), enabled: feature.enabled })

  /** @param {Record<string, string | null>} patch */
  const update = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }
  const events = q.data?.events ?? []
  const days = groupByDay(events)
  const loading = feature.waiting || (feature.enabled && q.isPending)

  return (
    <div className="econ-page kz-container">
      <PageHeader
        eyebrow="Mercados"
        title="Calendario económico"
        description="Decisiones de Banxico y la Fed, inflación, empleo y crecimiento de México y Estados Unidos, en hora del centro."
        breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Calendario económico' }]}
      />
      <Countdown data={q.data} loading={loading} />
      <div className="econ-toolbar">
        <SegmentedControl label="Vista" items={VIEW_ITEMS} value={view} onChange={(v) => update({ vista: v === 'mes' ? 'mes' : null })} />
        <SegmentedControl label="País" items={COUNTRY_ITEMS} value={countries.join(',')} onChange={(v) => update({ pais: v === 'mx,us' ? null : v })} />
        <div className="econ-toolbar__nav">
          <Button variant="secondary" size="sm" icon={<ChevronLeft size={16} />} onClick={() => update({ semana: shiftAnchor(view, anchor, -1) })}>
            {view === 'mes' ? 'Mes anterior' : 'Semana anterior'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => update({ semana: null })}>
            Hoy
          </Button>
          <Button variant="secondary" size="sm" iconEnd={<ChevronRight size={16} />} onClick={() => update({ semana: shiftAnchor(view, anchor, 1) })}>
            {view === 'mes' ? 'Mes siguiente' : 'Semana siguiente'}
          </Button>
        </div>
      </div>
      <p className="econ-range" aria-live="polite">
        Del {windowText(win)}
      </p>
      <Card
        title="Agenda"
        description={coverageText(q.data?.coverage) ?? 'Cada calendario cubre solo lo que su fuente ya publicó.'}
        status={q.data?.meta}
        actions={
          <Button variant="secondary" size="sm" icon={<CalendarPlus size={16} />} disabled={!events.length} onClick={() => downloadIcs(events, `calendario-economico-${win.start}.ics`)}>
            Agregar a mi calendario
          </Button>
        }
      >
        <div className="econ-agenda-slot">
          {loading ? (
            <div aria-busy="true">
              <span className="sr-only">Cargando</span>
              <Skeleton height={380} />
            </div>
          ) : null}
          {!feature.enabled && !feature.waiting ? <EmptyState title="Calendario no disponible" text={feature.reason} /> : null}
          {q.isError ? <ErrorState message="No pudimos traer el calendario." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
          {q.data && !events.length ? <EmptyState title="Sin eventos en estas fechas" text="Prueba otra semana o revisa hasta dónde cubre cada calendario." /> : null}
          {days.length ? (
            <div className="econ-days">
              {days.map((day) => (
                <section key={day.date} aria-labelledby={`dia-${day.date}`}>
                  <h3 id={`dia-${day.date}`} className="kz-section-title">
                    {fmtWeekday(day.date)} {day.date.slice(0, 4)}
                  </h3>
                  <ul className="econ-events">
                    {day.events.map((ev) => (
                      <EventRow key={ev.id} ev={ev} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
      {q.data ? <ApiNotes meta={q.data.meta} label="Avisos del calendario" /> : null}
    </div>
  )
}
