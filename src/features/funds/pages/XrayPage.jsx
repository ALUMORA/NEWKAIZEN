// /portafolio/rayos-x (V5PF): exposición real del portafolio por sector y por emisora, sumando las
// acciones directas y lo que hay dentro de cada ETF (src/features/funds/lib/lookthrough.js), con la
// cobertura a la vista y el traslape entre ETF. Pesos por valor de mercado en pesos con las
// cotizaciones de hoy (como el resumen del portafolio); sin precio, por costo, y se dice.
import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ApiNotes, Card, DataTable, EmptyState, ErrorState, InlineLink, PageHeader, SectionHeading, Skeleton, Stat } from '../../../components/ui/index.js'
import { fundQuery, fxQuery, quotesQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { usePortfolios } from '../../../lib/portfolio/usePortfolios.js'
import { fmtPct } from '../../../lib/format.js'
import { PATHS, pathInstrument } from '../../../app/paths.js'
import { todayMx } from '../../portfolio/tx-labels.js'
import { summarize } from '../../portfolio/lib/summary-view.js'
import { isBmvEtfWithoutData, isFundType, lookthrough, overlapMatrix } from '../lib/lookthrough.js'
import '../funds.css'

const Bars = lazy(() => import('../../../components/charts/Bars.jsx').then((m) => ({ default: m.Bars })))
const Heatmap = lazy(() => import('../../../components/charts/Heatmap.jsx').then((m) => ({ default: m.Heatmap })))

const EMPTY = /** @type {any[]} */ ([])
const MAX_ISSUERS = 25

const ISSUER_COLUMNS = [
  {
    key: 'symbol',
    header: 'Emisora',
    sortable: true,
    format: (/** @type {any} */ v, /** @type {any} */ r) => (v ? <InlineLink to={pathInstrument(v)}>{v}</InlineLink> : r.name ?? 's/d'),
  },
  { key: 'name', header: 'Nombre', format: (/** @type {any} */ v) => v ?? 's/d', minWidth: 140 },
  { key: 'weight', header: 'Exposición total', numeric: true, sortable: true, format: (/** @type {any} */ v) => fmtPct(v) },
  { key: 'direct', header: 'Directa', numeric: true, sortable: true, format: (/** @type {any} */ v) => (v ? fmtPct(v) : '0.00%') },
  { key: 'viaFunds', header: 'Dentro de ETF', numeric: true, sortable: true, format: (/** @type {any} */ v) => (v ? fmtPct(v) : '0.00%') },
  { key: 'funds', header: 'Por medio de', format: (/** @type {any} */ v) => (v?.length ? v.join(', ') : 'Directa') },
]

const HOLDING_COLUMNS = [
  { key: 'symbol', header: 'Posición', sortable: true, format: (/** @type {any} */ v) => <InlineLink to={pathInstrument(v)}>{v}</InlineLink> },
  { key: 'kindLabel', header: 'Tipo', sortable: true },
  { key: 'weight', header: 'Peso', numeric: true, sortable: true, format: (/** @type {any} */ v) => fmtPct(v) },
  { key: 'basisLabel', header: 'Pesado por' },
  { key: 'status', header: 'Composición' },
]

function Loading() {
  return (
    <div className="funds-skeleton" aria-busy="true">
      <span className="sr-only">Cargando los rayos X</span>
      <div className="kz-metric-grid">
        <Stat label="Cobertura por sector" loading />
        <Stat label="Cobertura por emisora" loading />
      </div>
      <Skeleton height={360} />
    </div>
  )
}

export default function XrayPage() {
  const { active } = usePortfolios()
  const today = todayMx()
  const transactions = /** @type {any[]} */ (active?.transactions ?? EMPTY)
  const prelim = useMemo(() => summarize({ transactions, quotes: [], usdmxn: null, today }), [transactions, today])
  const symbols = useMemo(() => prelim.rows.map((r) => r.symbol).sort(), [prelim])
  const quotes = useQuery({ ...quotesQuery(symbols), enabled: symbols.length > 0 })
  const quoteList = /** @type {any[]} */ (quotes.data?.quotes ?? EMPTY)
  const needsFx = transactions.some((t) => t?.currency === 'USD') || quoteList.some((q) => q.currency === 'USD')
  const fx = useQuery({ ...fxQuery(), enabled: needsFx })
  const view = useMemo(() => summarize({ transactions, quotes: quoteList, usdmxn: fx.data?.rate ?? null, today }), [transactions, quoteList, fx.data, today])

  const bySymbol = useMemo(() => new Map(quoteList.map((q) => [q.symbol, q])), [quoteList])
  const base = useMemo(() => {
    const rows = view.rows.map((r) => {
      const value = r.value ?? r.costMxn ?? null
      const q = bySymbol.get(r.symbol)
      return { symbol: r.symbol, name: r.name, value, basis: r.value != null ? 'mercado' : r.costMxn != null ? 'costo' : null, kind: isFundType(q?.type) ? 'fund' : 'direct', sector: q?.sector ?? null }
    })
    const total = rows.reduce((a, r) => a + (r.value ?? 0), 0)
    return rows.map((r) => ({ ...r, weight: r.value != null && total > 0 ? r.value / total : 0 }))
  }, [view, bySymbol])

  const feature = useFeature(['funds'])
  const fundSymbols = useMemo(() => base.filter((r) => r.kind === 'fund' && !isBmvEtfWithoutData(r.symbol)).map((r) => r.symbol), [base])
  const fundQueries = useQueries({ queries: fundSymbols.map((s) => ({ ...fundQuery(s), enabled: feature.enabled })) })
  const fundsLoading = feature.waiting || (feature.enabled && fundQueries.some((q) => q.isPending))
  /** @type {Record<string, any>} */
  const funds = {}
  fundSymbols.forEach((s, i) => {
    funds[s] = fundQueries[i]?.data ?? null
  })
  const fundErrors = fundSymbols.filter((_, i) => fundQueries[i]?.isError && /** @type {any} */ (fundQueries[i]?.error)?.status !== 404)

  // Cálculo barato (decenas de renglones): se rehace en cada render, sin memo.
  const result = lookthrough(base, funds)
  const matrix = overlapMatrix(fundSymbols.map((s) => ({ symbol: s, fund: funds[s] })))
  const firstMeta = fundSymbols.map((s) => funds[s]?.meta).find(Boolean)

  const header = (
    <PageHeader
      title="Rayos X del portafolio"
      description="Exposición por sector y por emisora sumando tus acciones directas y lo que hay dentro de cada ETF, con la cobertura visible."
      eyebrow="Mi portafolio"
      breadcrumbs={[{ label: 'Mi portafolio', to: PATHS.portfolio }, { label: 'Rayos X del portafolio' }]}
    />
  )

  if (!symbols.length) {
    return (
      <div className="kz-page kz-col funds-page" data-gap="6">
        {header}
        <EmptyState
          headingAs="h2"
          title="Aún no hay posiciones"
          text="Los rayos X abren cada ETF de tu portafolio y suman lo que tiene adentro a tus acciones directas. Registra tus compras en Movimientos."
          action={<Link className="kz-button" data-variant="primary" data-size="md" to={PATHS.portfolioTransactions}>Ir a Movimientos</Link>}
        />
      </div>
    )
  }

  const loading = quotes.isPending || (needsFx && fx.isPending) || fundsLoading
  const uncovered = result.coverage.uncoveredFunds
  const byCost = base.filter((r) => r.basis === 'costo').map((r) => r.symbol)
  const unvalued = base.filter((r) => r.basis === null).map((r) => r.symbol)
  const holdingRows = base.map((r) => ({
    ...r,
    kindLabel: r.kind === 'fund' ? 'ETF o fondo' : 'Acción directa',
    basisLabel: r.basis === 'mercado' ? 'Valor de mercado' : r.basis === 'costo' ? 'Costo' : 's/d',
    status: r.kind === 'direct' ? (r.sector ? `Sector: ${r.sector}` : 'Sin sector publicado') : funds[r.symbol] ? 'Con composición' : 'Sin datos de composición',
  }))

  return (
    <div className="kz-page kz-col funds-page" data-gap="6">
      {header}
      {quotes.isError ? <ErrorState size="sm" message="No pudimos traer las cotizaciones del portafolio." onRetry={() => quotes.refetch()} retrying={quotes.isFetching} /> : null}
      {!feature.enabled && !feature.waiting ? <EmptyState size="sm" title="Composición de ETF no disponible" text={feature.reason} /> : null}
      {loading ? <Loading /> : (
        <>
          <section className="kz-col" data-gap="4" aria-labelledby="rayos-cobertura">
            <SectionHeading
              id="rayos-cobertura"
              title="Cobertura"
              description="Qué parte del portafolio pudimos ver por dentro. Lo que no se ve no se reparte en sectores ni en emisoras."
              info={{ termKey: 'exposicion-por-transparencia', term: 'Exposición por transparencia' }}
            />
            <div className="kz-metric-grid">
              <Stat label="Cobertura por sector" value={fmtPct(result.coverage.sectors, { decimals: 0 })} sublabel={`Cubre ${fmtPct(result.coverage.sectors, { decimals: 0 })} del portafolio`} />
              <Stat label="Cobertura por emisora" value={fmtPct(result.coverage.issuers, { decimals: 0 })} sublabel="Acciones directas más las 10 principales de cada ETF" />
            </div>
            <p className="funds-note">
              Pesos por valor de mercado en pesos con las cotizaciones de hoy, sobre lo invertido (sin efectivo).
              {byCost.length ? ` Sin precio, ${byCost.join(', ')} se pesa por su costo.` : ''}
              {unvalued.length ? ` ${unvalued.join(', ')} no tiene precio ni costo en pesos y queda fuera.` : ''}
            </p>
            {uncovered.length ? <p className="funds-note">Sin datos de composición: {uncovered.join(', ')}. Yahoo no publica qué tienen adentro.</p> : null}
            {fundErrors.length ? <p className="funds-note" role="status">No pudimos traer la composición de {fundErrors.join(', ')}; cuentan como sin datos.</p> : null}
          </section>

          <Suspense fallback={<Skeleton height={320} />}>
            <Bars
              title="Exposición por sector"
              description="Acciones directas más el reparto por sector de cada ETF, como fracción del portafolio."
              data={result.sectors.map((s) => ({ label: s.sector, value: s.weight }))}
              format="pct"
              decimals={1}
              categoryLabel="Sector"
              valueLabel="Peso en el portafolio"
              status={firstMeta}
            />
          </Suspense>

          <Card title="Exposición por emisora" description="Cota inferior: de cada ETF solo se conocen sus 10 principales." status={firstMeta} padding="none">
            <DataTable
              caption="Exposición por emisora"
              captionHidden
              columns={ISSUER_COLUMNS}
              rows={result.issuers.slice(0, MAX_ISSUERS)}
              rowKey="key"
              defaultSort={{ key: 'weight', direction: 'descending' }}
              empty={{ title: 'Sin emisoras que mostrar', text: 'Ninguna posición se pudo ver por dentro.' }}
            />
          </Card>

          {matrix.labels.length >= 2 ? (
            <Suspense fallback={<Skeleton height={240} />}>
              <Heatmap
                title="Traslape entre tus ETF"
                description="Suma de los pesos que dos fondos comparten entre sus 10 principales, tomando el menor de cada par. Es una cota inferior: el traslape real puede ser mayor."
                rows={matrix.labels}
                columns={matrix.labels}
                values={matrix.values}
                max={1}
                format="pct"
                decimals={1}
                status={firstMeta}
              />
            </Suspense>
          ) : (
            <p className="funds-note">El traslape entre ETF aparece cuando tienes dos o más ETF con composición publicada.</p>
          )}

          <Card title="Posiciones" titleAs="h2" padding="none">
            <DataTable caption="Posiciones y su composición" captionHidden columns={HOLDING_COLUMNS} rows={holdingRows} rowKey="symbol" defaultSort={{ key: 'weight', direction: 'descending' }} />
          </Card>
          {firstMeta ? <ApiNotes meta={firstMeta} label="Avisos de la composición de los ETF" /> : null}
        </>
      )}
    </div>
  )
}
