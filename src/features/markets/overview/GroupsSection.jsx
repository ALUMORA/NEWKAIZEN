// Tablas del panorama por grupo (México, Estados Unidos, resto del mundo, divisas, materias primas y
// cripto), sin duplicados: el VIX va en su medidor y cada símbolo sale una sola vez.
import { useQuery } from '@tanstack/react-query'
import { Card, DataTable, Delta, EmptyState, ErrorState, SectionHeading, Skeleton } from '../../../components/ui/index.js'
import { marketsOverviewQuery } from '../../../lib/api/queries.js'
import { MISSING } from '../../../lib/format.js'
import { EXCHANGES, dedupeMarkets, fmtItemPrice, fmtSessionDay, fxHint, isFxLike } from '../pages/overview-model.js'
import { useFeature } from './useFeature.js'

const DESCRIPTIONS = {
  mx: 'El índice de la Bolsa Mexicana de Valores, en puntos.',
  us: 'Índices de Nueva York en puntos. El VIX tiene su propio medidor más abajo.',
  global: 'Índices de otras bolsas en su moneda local; cada una tiene su propio horario.',
  fx: 'Un tipo de cambio que sube no es bueno ni malo: la pista dice qué moneda se debilitó.',
  commodities: 'Futuros del mes más cercano, en dólares.',
  crypto: 'Operan todos los días, a toda hora.',
}

const TZ_BY_GROUP = { mx: EXCHANGES.bmv.tz, us: EXCHANGES.nyse.tz }

function columnsFor(groupId) {
  return [
    {
      key: 'label',
      header: 'Instrumento',
      format: (v, row) => (
        <span className="markets-instrument">
          <span>{v}</span>
          <span className="markets-instrument__symbol mono">{row.symbol}</span>
        </span>
      ),
    },
    { key: 'price', header: 'Último', numeric: true, format: (_, row) => fmtItemPrice(row, groupId) },
    {
      key: 'change',
      header: 'Cambio',
      numeric: true,
      format: (v, row) =>
        v == null ? (
          <span className="kz-missing">{MISSING}</span>
        ) : (
          <Delta value={v} kind="number" decimals={isFxLike(row, groupId) && row.symbol !== 'DX-Y.NYB' ? 4 : 2} direction={isFxLike(row, groupId) ? 'neutral' : 'auto'} />
        ),
    },
    {
      key: 'changePct',
      header: 'Cambio %',
      numeric: true,
      format: (v, row) =>
        v == null ? (
          <span className="kz-missing">{MISSING}</span>
        ) : (
          <Delta value={v} kind="pct" direction={isFxLike(row, groupId) ? 'neutral' : 'auto'} hint={isFxLike(row, groupId) ? fxHint(row.symbol, v) : undefined} />
        ),
    },
    { key: 'asOf', header: 'Dato del', format: (v) => (v ? fmtSessionDay(String(v), TZ_BY_GROUP[groupId]) : <span className="kz-missing">{MISSING}</span>) },
  ]
}

export function GroupsSection() {
  const feature = useFeature(['markets.overview'])
  const q = useQuery({ ...marketsOverviewQuery(), enabled: feature.enabled })
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const groups = q.data ? dedupeMarkets({ overview: q.data }).groups : []
  return (
    <section className="kz-col" aria-labelledby="markets-groups-title">
      <SectionHeading id="markets-groups-title" title="Panorama" description="Último precio y cambio contra el cierre anterior. Cada símbolo aparece una sola vez." />
      {loading ? (
        <div className="markets-groups" aria-busy="true">
          <span className="sr-only">Cargando</span>
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      ) : null}
      {!loading && !feature.enabled ? <EmptyState title="Sin panorama por ahora" text={feature.reason} /> : null}
      {q.isError ? <ErrorState message="No pudimos traer el panorama de mercados." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {q.data && !groups.length ? <EmptyState title="Sin cifras por ahora" text="El servidor no trajo precios en esta actualización." /> : null}
      {groups.length ? (
        <div className="markets-groups">
          {groups.map((g) => (
            <Card key={g.id} title={g.label} titleAs="h3" description={DESCRIPTIONS[g.id]} status={q.data?.meta} padding="none">
              <DataTable columns={columnsFor(g.id)} rows={g.items} rowKey="symbol" caption={`Panorama: ${g.label}`} captionHidden density="compact" />
            </Card>
          ))}
        </div>
      ) : null}
    </section>
  )
}
