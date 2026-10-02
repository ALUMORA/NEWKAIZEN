// Pestaña "Temporada de reportes": fechas de reporte de una muestra curada de emisoras de México o
// EE. UU. (/v2/events/season), con el estimado de utilidad por acción y su rango, y las emisoras que
// no se pudieron consultar con su motivo.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiNotes, Card, DataTable, EmptyState, ErrorState, InlineLink, SectionHeading, SegmentedControl } from '../../../components/ui/index.js'
import { eventsSeasonQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { fmtDate, fmtMoney, fmtNumber } from '../../../lib/format.js'
import { pathInstrument } from '../../../app/paths.js'

const UNIVERSES = [
  { value: 'mx', label: 'México' },
  { value: 'us', label: 'EE. UU.' },
]
const WINDOWS = [
  { value: '30', label: '30 días' },
  { value: '60', label: '60 días' },
  { value: '90', label: '90 días' },
]

/** @param {number | null | undefined} v @param {string | null | undefined} currency */
const fmtEps = (v, currency) => (v == null ? 's/d' : currency ? fmtMoney(v, currency, { decimals: 2 }) : fmtNumber(v, { decimals: 2 }))

const COLUMNS = [
  { key: 'date', header: 'Fecha', sortable: true, format: (/** @type {any} */ v) => fmtDate(v) },
  { key: 'symbol', header: 'Emisora', sortable: true, format: (/** @type {any} */ v) => <InlineLink to={pathInstrument(v)}>{v}</InlineLink> },
  { key: 'name', header: 'Nombre', sortable: true, format: (/** @type {any} */ v) => v ?? 's/d', minWidth: 160 },
  {
    key: 'estimateAvg',
    header: 'UPA estimada',
    numeric: true,
    sortable: true,
    format: (/** @type {any} */ v, /** @type {any} */ r) => fmtEps(v, r.currency),
    info: { termKey: 'estimado-de-upa', term: 'Estimado de UPA' },
  },
  {
    key: 'estimateLow',
    header: 'Rango de estimados',
    numeric: true,
    format: (/** @type {any} */ _v, /** @type {any} */ r) => (r.estimateLow == null || r.estimateHigh == null ? 's/d' : `${fmtEps(r.estimateLow, r.currency)} a ${fmtEps(r.estimateHigh, r.currency)}`),
  },
]

/**
 * @param {{ universe: 'mx' | 'us', onUniverseChange: (u: 'mx' | 'us') => void }} props
 */
export default function SeasonAgenda({ universe, onUniverseChange }) {
  const [days, setDays] = useState(/** @type {30 | 60 | 90} */ (90))
  const feature = useFeature(['events.season'])
  const q = useQuery({ ...eventsSeasonQuery({ universe, days }), enabled: feature.enabled })
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const data = /** @type {import('../types.js').SeasonResponse | undefined} */ (q.data)
  const meta = data?.meta
  const where = universe === 'us' ? 'Estados Unidos' : 'México'

  return (
    <div className="kz-col" data-gap="6">
      <SectionHeading
        title={`Temporada de reportes de ${where}`}
        description="Cuándo reporta cada emisora de una muestra curada y qué utilidad por acción esperan los analistas. En la BMV el consenso suele salir de pocos analistas."
        info={{ termKey: 'temporada-de-reportes', term: 'Temporada de reportes' }}
      />
      <div className="agenda-controls">
        <SegmentedControl label="Mercado" items={UNIVERSES} value={universe} onChange={(v) => onUniverseChange(v === 'us' ? 'us' : 'mx')} />
        <SegmentedControl label="Ventana" items={WINDOWS} value={String(days)} onChange={(v) => setDays(/** @type {30 | 60 | 90} */ (Number(v)))} />
      </div>
      {!loading && !feature.enabled ? <EmptyState size="sm" title="Temporada no disponible" text={feature.reason} /> : null}
      {q.isError ? <ErrorState size="sm" message="No pudimos traer la temporada de reportes." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {loading || data ? (
        <Card
          title={`Reportes en los próximos ${days} días`}
          description={data ? `Muestra de ${fmtNumber(data.universeSize, { decimals: 0 })} emisoras de ${where}, no todo el mercado: ${fmtNumber(data.events.length, { decimals: 0 })} con fecha en la ventana.` : 'Cargando la muestra.'}
          status={meta}
          padding="none"
        >
          <DataTable
            caption={`Temporada de reportes de ${where}`}
            captionHidden
            columns={COLUMNS}
            rows={data?.events ?? []}
            rowKey={(/** @type {any} */ r) => `${r.symbol}-${r.date}`}
            defaultSort={{ key: 'date', direction: 'ascending' }}
            loading={loading}
            empty={{ title: 'Sin reportes en la ventana', text: `Ninguna emisora de la muestra tiene fecha de reporte en los próximos ${days} días. Prueba con una ventana más larga.` }}
          />
        </Card>
      ) : null}
      {data && data.missing?.length ? (
        <Card title="Emisoras sin dato" titleAs="h3" description="No se pudieron consultar en esta actualización; no cuentan en la tabla.">
          <ul className="agenda-missing">
            {data.missing.map((m) => (
              <li key={m.symbol}>
                <InlineLink to={pathInstrument(m.symbol)}>{m.symbol}</InlineLink>: {m.reason}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data ? <ApiNotes meta={meta} label="Avisos de la temporada" /> : null}
    </div>
  )
}
