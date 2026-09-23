// Tasas de EE. UU. de /v2/macro/us con sus cambios en puntos base. El VIX va en su medidor y el DXY
// en Divisas (si el panorama lo trae), así que aquí no se repiten.
import { useQuery } from '@tanstack/react-query'
import { Card, Delta, EmptyState, ErrorState, Stat } from '../../../components/ui/index.js'
import { macroUsQuery, marketsOverviewQuery } from '../../../lib/api/queries.js'
import { dedupeMarkets } from '../pages/overview-model.js'
import { fmtByUnit, itemStatus, termFor } from '../pages/shared.js'
import { ApiNotes } from '../pages/ApiNotes.jsx'
import { useFeature } from './useFeature.js'

function RateDelta({ item }) {
  if (item.changeBp != null) return <Delta value={item.changeBp} kind="bp" direction="neutral" />
  if (item.change != null) return <Delta value={item.change} kind="number" direction="neutral" />
  return null
}

export function UsRatesCard() {
  const feature = useFeature(['macro.us'])
  const overviewFeature = useFeature(['markets.overview'])
  const q = useQuery({ ...macroUsQuery(), enabled: feature.enabled })
  const overview = useQuery({ ...marketsOverviewQuery(), enabled: overviewFeature.enabled })
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const items = q.data ? dedupeMarkets({ overview: overview.data, macro: q.data }).usRates : []
  const meta = q.data?.meta
  return (
    <Card
      title="Tasas de EE. UU."
      description="Bonos del Tesoro y diferenciales. El cambio es contra el dato anterior, en puntos base (pb): 100 pb son un punto porcentual."
      info={{ termKey: 'puntos-base', term: 'Puntos base' }}
      status={meta}
    >
      {loading ? (
        <div className="markets-grid" aria-busy="true">
          <span className="sr-only">Cargando</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Stat key={i} label="Cargando" loading />
          ))}
        </div>
      ) : null}
      {!loading && !feature.enabled ? <EmptyState size="sm" title="Sin tasas de EE. UU." text={feature.reason} /> : null}
      {q.isError ? <ErrorState size="sm" message="No pudimos traer las tasas de EE. UU." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {q.data && !items.length ? <EmptyState size="sm" title="Sin tasas de EE. UU. por ahora" text="La fuente no devolvió series en esta actualización." /> : null}
      {items.length ? (
        <div className="markets-grid">
          {items.map((item) => (
            <Stat
              key={item.id}
              label={item.label}
              value={fmtByUnit(item.value, item.unit, item.id)}
              delta={<RateDelta item={item} />}
              info={termFor(item.id) ? { termKey: termFor(item.id), term: item.label } : undefined}
              status={itemStatus(item, meta)}
            />
          ))}
        </div>
      ) : null}
      {q.data ? <ApiNotes meta={meta} label="Avisos de las tasas" /> : null}
    </Card>
  )
}
