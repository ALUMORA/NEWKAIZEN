// Sección "Qué tiene adentro" de la ficha de un ETF (V5PF), con /v2/funds/{symbol}: comisión,
// activos y rotación, clases de activo, sectores y las 10 principales. La ficha solo la monta si el
// instrumento es ETF y el servidor anuncia 'funds', dentro de Suspense y ErrorBoundary propios.
// Los ETF de la BMV que Yahoo no cubre no se piden (responderían 404 por contrato); un 404 de otro
// fondo se muestra como el mismo aviso, sin error.
import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiNotes, DataTable, EmptyState, ErrorState, InlineLink, SectionHeading, Skeleton, Stat } from '../../../components/ui/index.js'
import { fundQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { fmtMoney, fmtPct } from '../../../lib/format.js'
import { pathInstrument } from '../../../app/paths.js'
import { isBmvEtfWithoutData } from '../lib/lookthrough.js'
import '../funds.css'

const Donut = lazy(() => import('../../../components/charts/Donut.jsx').then((m) => ({ default: m.Donut })))
const Bars = lazy(() => import('../../../components/charts/Bars.jsx').then((m) => ({ default: m.Bars })))

const NO_DATA_TEXT = 'Yahoo no publica la composición de este fondo, así que no podemos mostrar qué tiene adentro.'

const ASSET_LABELS = /** @type {const} */ ([
  ['stock', 'Acciones'],
  ['bond', 'Bonos'],
  ['cash', 'Efectivo'],
  ['other', 'Otros'],
])

const TOP_COLUMNS = [
  {
    key: 'symbol',
    header: 'Emisora',
    format: (/** @type {any} */ v, /** @type {any} */ r) => (v ? <InlineLink to={pathInstrument(v)}>{v}</InlineLink> : r.name ?? 's/d'),
  },
  { key: 'name', header: 'Nombre', format: (/** @type {any} */ v) => v ?? 's/d', minWidth: 160 },
  { key: 'weight', header: 'Peso en el fondo', numeric: true, sortable: true, format: (/** @type {any} */ v) => fmtPct(v) },
]

/** Activos del fondo: el contrato los manda en millones de dólares; sin unidad verificada, s/d. */
function fmtAssets(/** @type {any} */ fund) {
  if (fund?.totalNetAssets == null || fund?.totalNetAssetsUnit !== 'usdMillions') return 's/d'
  return fmtMoney(fund.totalNetAssets * 1e6, 'USD', { compact: true })
}

/** Alto reservado mientras carga, para que la ficha no salte. */
function Loading() {
  return (
    <div className="funds-skeleton" aria-busy="true">
      <span className="sr-only">Cargando la composición del fondo</span>
      <div className="kz-metric-grid">
        <Stat label="Comisión del fondo" loading />
        <Stat label="Activos del fondo" loading />
        <Stat label="Rotación del fondo" loading />
      </div>
      <Skeleton height={320} />
    </div>
  )
}

/**
 * @param {{ symbol: string, instrument?: import('../../../lib/api/types.js').InstrumentResponse }} props
 */
export default function FundSection({ symbol }) {
  const noData = isBmvEtfWithoutData(symbol)
  const feature = useFeature(['funds'])
  const q = useQuery({ ...fundQuery(symbol), enabled: feature.enabled && !noData })
  const fund = /** @type {import('../types.js').FundResponse | undefined} */ (q.data)
  const notFound = noData || (q.isError && /** @type {any} */ (q.error)?.status === 404)
  const loading = !noData && (feature.waiting || (feature.enabled && q.isPending))

  const heading = (
    <SectionHeading
      id="fondo-adentro"
      title="Qué tiene adentro"
      description={
        fund?.mappedFrom
          ? `Composición de ${fund.symbol}, el ETF que replica ${fund.mappedFrom}. La tomamos de ese fondo porque Yahoo no la publica para la clave de la BMV.`
          : 'Clases de activo, sectores y las 10 posiciones principales del fondo.'
      }
      info={{ termKey: 'exposicion-por-transparencia', term: 'Exposición por transparencia' }}
    />
  )

  let body = null
  if (notFound) body = <EmptyState size="sm" title="Sin composición publicada" text={NO_DATA_TEXT} />
  else if (loading) body = <Loading />
  else if (!feature.enabled) body = <EmptyState size="sm" title="Composición no disponible" text={feature.reason} />
  else if (q.isError) body = <ErrorState size="sm" message="No pudimos traer la composición del fondo." onRetry={() => q.refetch()} retrying={q.isFetching} />
  else if (fund) {
    const assetData = fund.assetClasses
      ? ASSET_LABELS.map(([key, label]) => ({ label, value: fund.assetClasses?.[key] ?? null })).filter((d) => d.value != null && d.value > 0)
      : []
    const sectorData = (fund.sectors ?? []).map((s) => ({ label: s.sector, value: s.weight }))
    const top = (fund.topHoldings ?? []).slice(0, 10).map((t, i) => ({ ...t, key: `${t.symbol ?? t.name ?? 'x'}-${i}` }))
    const topWeight = fund.coverage?.topHoldingsWeight
    body = (
      <>
        <div className="kz-metric-grid">
          <Stat label="Comisión del fondo" value={fmtPct(fund.expenseRatio)} sublabel="Al año, sobre lo invertido" info={{ termKey: 'comision-del-fondo', term: 'Comisión del fondo' }} status={fund.meta} />
          <Stat label="Activos del fondo" value={fmtAssets(fund)} sublabel="En dólares" />
          <Stat label="Rotación del fondo" value={fmtPct(fund.turnover)} sublabel="Del portafolio, al año" info={{ termKey: 'rotacion-del-fondo', term: 'Rotación del fondo' }} />
        </div>
        <Suspense fallback={<Skeleton height={320} />}>
          <div className="funds-grid" data-cols="2">
            <Donut title="Clases de activo" data={assetData} format="pct" decimals={1} centerLabel="Del fondo" status={fund.meta} emptyText="Yahoo no reparte este fondo por clase de activo" />
            <Bars title="Sectores" data={sectorData} format="pct" decimals={1} categoryLabel="Sector" valueLabel="Peso en el fondo" status={fund.meta} emptyText="Yahoo no reparte este fondo por sector" />
          </div>
        </Suspense>
        <DataTable
          caption="Las 10 posiciones principales"
          columns={TOP_COLUMNS}
          rows={top}
          rowKey="key"
          defaultSort={{ key: 'weight', direction: 'descending' }}
          empty={{ title: 'Sin posiciones publicadas', text: 'Yahoo no publica las posiciones principales de este fondo.' }}
        />
        <p className="funds-note">
          {topWeight != null
            ? `Las 10 principales suman ${fmtPct(topWeight, { decimals: 1 })} del fondo; el resto no se publica posición por posición.`
            : 'No sabemos cuánto del fondo suman las 10 principales.'}
        </p>
        <ApiNotes meta={fund.meta} label="Avisos de la composición" />
      </>
    )
  }

  return (
    <section className="kz-col" data-gap="4" aria-labelledby="fondo-adentro">
      {heading}
      {body}
    </section>
  )
}
