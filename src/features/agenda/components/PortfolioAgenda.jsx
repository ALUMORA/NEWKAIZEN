// Pestaña "Mi portafolio y lista" de la agenda: los símbolos salen de las posiciones del libro
// (cortado en hoy) más la lista. Calendario por mes, tabla de los próximos 90 días con filtro y la
// proyección de dividendos por mes (src/features/agenda/lib/projection.js).
import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiNotes, Badge, Card, DataTable, EmptyState, ErrorState, InlineLink, SectionHeading, SegmentedControl, Skeleton, Stat } from '../../../components/ui/index.js'
import { eventsQuery, fxQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { derivePositions } from '../../../lib/finance/ledger.js'
import { usePortfolios } from '../../../lib/portfolio/usePortfolios.js'
import { useStore } from '../../../lib/storage.js'
import { fmtDate, fmtMoney, fmtNumber } from '../../../lib/format.js'
import { PATHS, pathInstrument } from '../../../app/paths.js'
import { todayMx } from '../../portfolio/tx-labels.js'
import { EVENT_LABELS, groupByMonth, monthTitle, originMap, projectDividends, upcomingEvents } from '../lib/projection.js'

const Bars = lazy(() => import('../../../components/charts/Bars.jsx').then((m) => ({ default: m.Bars })))

/** Tope de /v2/events por llamada. */
const MAX_SYMBOLS = 50
const WINDOW_DAYS = 90
const EMPTY = /** @type {any[]} */ ([])

const TONES = /** @type {const} */ ({ earnings: 'info', exDividend: 'accent', dividendPay: 'positive' })
const ORIGIN_LABEL = { portafolio: 'Portafolio', lista: 'Lista', ambos: 'Portafolio y lista' }
const FILTERS = [
  { value: 'ambos', label: 'Ambos' },
  { value: 'portafolio', label: 'Portafolio' },
  { value: 'lista', label: 'Lista' },
]
const FREQ_LABEL = { mensual: 'Mensual', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual', irregular: 'Irregular' }
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** @param {number | null | undefined} v @param {string | null | undefined} currency */
const fmtEstimate = (v, currency) => (v == null ? 's/d' : currency ? fmtMoney(v, currency, { decimals: 2 }) : fmtNumber(v, { decimals: 2 }))

/** Monto de un evento: el estimado de UPA en reportes; en dividendos el monto futuro no se conoce. */
function eventDetail(/** @type {any} */ e) {
  if (e.type === 'earnings') {
    const range = e.estimateLow != null && e.estimateHigh != null ? ` (${fmtEstimate(e.estimateLow, e.currency)} a ${fmtEstimate(e.estimateHigh, e.currency)})` : ''
    return e.estimate != null ? `UPA estimada ${fmtEstimate(e.estimate, e.currency)}${range}` : 'UPA estimada s/d'
  }
  return 'Monto por anunciar'
}

const COLUMNS = [
  { key: 'date', header: 'Fecha', sortable: true, format: (/** @type {any} */ v) => fmtDate(v) },
  { key: 'symbol', header: 'Emisora', sortable: true, format: (/** @type {any} */ v) => <InlineLink to={pathInstrument(v)}>{v}</InlineLink> },
  { key: 'type', header: 'Evento', sortable: true, format: (/** @type {any} */ v) => <Badge tone={TONES[/** @type {keyof typeof TONES} */ (v)] ?? 'neutral'}>{EVENT_LABELS[/** @type {keyof typeof EVENT_LABELS} */ (v)] ?? v}</Badge> },
  { key: 'estimate', header: 'Detalle', format: (/** @type {any} */ _v, /** @type {any} */ r) => eventDetail(r) },
  { key: 'origin', header: 'Está en', sortable: true, format: (/** @type {any} */ v) => ORIGIN_LABEL[/** @type {keyof typeof ORIGIN_LABEL} */ (v)] ?? v },
]

const PROJECTION_COLUMNS = [
  { key: 'symbol', header: 'Emisora', sortable: true, format: (/** @type {any} */ v) => <InlineLink to={pathInstrument(v)}>{v}</InlineLink> },
  { key: 'quantity', header: 'Títulos', numeric: true, format: (/** @type {any} */ v) => fmtNumber(v, { decimals: Number.isInteger(v) ? 0 : 4 }) },
  { key: 'perPayment', header: 'Último pagado por título', numeric: true, format: (/** @type {any} */ v, /** @type {any} */ r) => (r.missing ? 's/d' : fmtMoney(v, r.currency ?? 'MXN', { decimals: 2 })) },
  { key: 'frequency', header: 'Frecuencia', format: (/** @type {any} */ v, /** @type {any} */ r) => (r.missing ? 's/d' : FREQ_LABEL[/** @type {keyof typeof FREQ_LABEL} */ (v)] ?? 's/d') },
  { key: 'paidMonths', header: 'Meses de pago', format: (/** @type {any} */ v, /** @type {any} */ r) => (r.missing || !v.length ? 's/d' : v.map((/** @type {number} */ m) => MONTH_SHORT[m - 1]).join(', ')) },
  { key: 'annualGross', header: 'Al año, bruto', numeric: true, sortable: true, format: (/** @type {any} */ v, /** @type {any} */ r) => (r.missing || r.fxMissing ? 's/d' : fmtMoney(v)) },
  { key: 'annualNet', header: 'Al año, neto', numeric: true, sortable: true, format: (/** @type {any} */ v, /** @type {any} */ r) => (r.missing || r.fxMissing ? 's/d' : fmtMoney(v)) },
]

function LoadingBlock({ height = 220 }) {
  return (
    <div className="agenda-skeleton" aria-busy="true">
      <span className="sr-only">Cargando</span>
      <Skeleton height={height} />
    </div>
  )
}

export default function PortfolioAgenda() {
  const [filter, setFilter] = useState(/** @type {'ambos' | 'portafolio' | 'lista'} */ ('ambos'))
  const { active } = usePortfolios()
  const watchlists = useStore((/** @type {any} */ s) => s.watchlists) ?? EMPTY
  const today = todayMx()
  const transactions = /** @type {any[]} */ (active?.transactions ?? EMPTY)
  const positions = useMemo(
    () => derivePositions(transactions.filter((t) => !(typeof t?.date === 'string' && t.date > today)), { asOf: today }),
    [transactions, today],
  )
  const portfolioSymbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const listSymbols = useMemo(() => [...new Set(watchlists.flatMap((/** @type {any} */ w) => (Array.isArray(w?.symbols) ? w.symbols : [])))].map(String), [watchlists])
  const origins = useMemo(() => originMap(portfolioSymbols, listSymbols), [portfolioSymbols, listSymbols])
  const allSymbols = useMemo(() => [...origins.keys()].sort(), [origins])
  const symbols = allSymbols.slice(0, MAX_SYMBOLS)

  const feature = useFeature(['events'])
  const dividendsFeature = useFeature(['events.dividends'])
  const q = useQuery({ ...eventsQuery(symbols), enabled: feature.enabled && symbols.length > 0 })
  const summaries = /** @type {any[] | null} */ (q.data?.dividendSummary ?? null)
  const needsFx = (summaries ?? []).some((s) => s?.currency === 'USD' && s?.lastPaidAmount != null && origins.get(String(s.symbol).toUpperCase()) !== 'lista')
  const fx = useQuery({ ...fxQuery(), enabled: needsFx })

  const events = useMemo(() => upcomingEvents(q.data?.items, { today, days: WINDOW_DAYS, origins, filter }), [q.data, today, origins, filter])
  const months = useMemo(() => groupByMonth(events), [events])
  const projection = useMemo(
    () => projectDividends({ positions: positions.map((p) => ({ symbol: p.symbol, quantity: p.quantity })), summaries, usdmxn: fx.data?.rate ?? null, today }),
    [positions, summaries, fx.data, today],
  )

  if (!allSymbols.length) {
    return (
      <EmptyState
        headingAs="h2"
        title="Todavía no hay emisoras que seguir"
        text="La agenda junta los reportes y dividendos de lo que tienes en tu portafolio y en tu lista. Registra una compra o agrega emisoras a tu lista."
        action={
          <span className="agenda-controls">
            <InlineLink to={PATHS.portfolioTransactions}>Ir a Movimientos</InlineLink>
            <InlineLink to={PATHS.watchlist}>Ir a Mi lista</InlineLink>
          </span>
        }
      />
    )
  }

  const loading = feature.waiting || (feature.enabled && q.isPending)
  const meta = q.data?.meta
  const truncated = allSymbols.length > MAX_SYMBOLS

  return (
    <div className="kz-col" data-gap="6">
      <div className="agenda-controls">
        <SegmentedControl label="Mostrar eventos de" items={FILTERS} value={filter} onChange={(v) => setFilter(/** @type {any} */ (v))} />
      </div>
      {truncated ? <p className="agenda-note">Tienes {allSymbols.length} emisoras entre portafolio y lista; la agenda consulta las primeras {MAX_SYMBOLS} en orden alfabético.</p> : null}

      {!loading && !feature.enabled ? <EmptyState size="sm" title="Agenda no disponible" text={feature.reason} /> : null}
      {q.isError ? <ErrorState size="sm" message="No pudimos traer la agenda de tus emisoras." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}

      <section className="kz-col" data-gap="4" aria-labelledby="agenda-calendario">
        <SectionHeading id="agenda-calendario" title={`Calendario de los próximos ${WINDOW_DAYS} días`} />
        {loading ? <LoadingBlock /> : null}
        {q.data && !months.length ? (
          <EmptyState size="sm" title="Sin eventos en los próximos 90 días" text="Ninguna de tus emisoras tiene reporte, ex dividendo ni pago anunciado en la ventana." />
        ) : null}
        {months.length ? (
          <div className="agenda-months">
            {months.map((m) => (
              <Card key={m.key} title={monthTitle(m.key)} titleAs="h3" status={meta}>
                <ul className="agenda-events">
                  {m.events.map((e) => (
                    <li key={`${e.symbol}-${e.type}-${e.date}`} className="agenda-event">
                      <span className="agenda-event__date num">{fmtDate(e.date)}</span>
                      <Badge tone={TONES[e.type] ?? 'neutral'}>{EVENT_LABELS[e.type] ?? e.type}</Badge>
                      <InlineLink to={pathInstrument(e.symbol)}>{e.symbol}</InlineLink>
                      <span className="agenda-event__extra">{eventDetail(e)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        ) : null}
        {q.data || loading ? (
          <DataTable
            caption="Próximos 90 días"
            columns={COLUMNS}
            rows={events}
            rowKey={(/** @type {any} */ r) => `${r.symbol}-${r.type}-${r.date}`}
            defaultSort={{ key: 'date', direction: 'ascending' }}
            loading={loading}
            empty={{ title: 'Sin eventos en la ventana', text: 'Cambia el filtro o agrega emisoras a tu lista.' }}
          />
        ) : null}
      </section>

      <section className="kz-col" data-gap="4" aria-labelledby="agenda-dividendos">
        <SectionHeading id="agenda-dividendos" title="Dividendos proyectados de tu portafolio" />
        <p className="agenda-note">
          Cada mes suma títulos por el último dividendo pagado, en los meses en que la emisora acostumbra pagar. El monto futuro no se conoce:
          es una proyección con el último pagado, no un anuncio. El neto resta la retención informativa de 10% sobre dividendos (LISR art. 140); los dividendos del
          extranjero siguen otras reglas y aquí se les aplica la misma tasa solo como referencia.
        </p>
        {loading ? <LoadingBlock height={280} /> : null}
        {q.data && !dividendsFeature.enabled ? (
          <EmptyState size="sm" title="Proyección no disponible" text="El servidor todavía no manda el historial de dividendos. Cuando lo tenga, aparecerá aquí." />
        ) : null}
        {q.data && dividendsFeature.enabled && !positions.length ? (
          <EmptyState size="sm" title="Sin posiciones" text="La proyección usa lo que tienes en tu portafolio; tu lista no cuenta." />
        ) : null}
        {q.data && dividendsFeature.enabled && positions.length ? (
          <>
            <div className="kz-metric-grid">
              <Stat label="Dividendos al año, bruto" value={fmtMoney(projection.totalGross)} sublabel="Con el último pagado" />
              <Stat label="Dividendos al año, neto" value={fmtMoney(projection.totalNet)} sublabel="Después de la retención de 10%" info={{ termKey: 'retencion-por-dividendos', term: 'Retención por dividendos' }} />
            </div>
            {projection.fxMissing ? (
              <p className="agenda-note" role="status">
                No tenemos el tipo de cambio ahora: los dividendos en dólares quedan fuera de la suma (s/d) hasta que llegue.
              </p>
            ) : null}
            {fx.data?.rate ? <p className="agenda-note">Dividendos en dólares convertidos a {fmtMoney(fx.data.rate, 'MXN', { decimals: 4 })} por dólar, el tipo de cambio de hoy.</p> : null}
            <Suspense fallback={<LoadingBlock height={280} />}>
              <Bars
                title="Dividendos proyectados por mes, último pagado"
                description="Próximos 12 meses, en pesos y antes de la retención."
                orientation="vertical"
                format="money"
                height={240}
                data={projection.months.map((m) => ({ label: m.label, value: m.gross }))}
                categoryLabel="Mes"
                valueLabel="Bruto en pesos"
                status={meta}
              />
            </Suspense>
            <DataTable
              caption="Proyección por emisora"
              columns={PROJECTION_COLUMNS}
              rows={projection.rows}
              rowKey="symbol"
              defaultSort={{ key: 'annualGross', direction: 'descending' }}
            />
          </>
        ) : null}
      </section>
      {q.data ? <ApiNotes meta={meta} label="Avisos de la agenda" /> : null}
    </div>
  )
}
