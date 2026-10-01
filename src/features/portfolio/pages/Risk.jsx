// /portafolio/riesgo: riesgo del portafolio con los pesos de hoy sobre precios semanales en pesos
// de /v2/panel (tres años). Caída máxima, VaR y CVaR, beta contra NAFTRAC.MX (el IPC con
// dividendos) y SPY en pesos, número efectivo de activos, exposición a dólares, concentración por
// sector (con el sectorKey de /v2/quotes) y correlaciones. Los cálculos están en lib/risk-view.js.
import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, DataTable, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '../../../components/ui/index.js'
import { derivePositions } from '../../../lib/finance/index.js'
import { fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'
import { panelQuery, quotesQuery } from '../../../lib/api/queries.js'
import { useStore } from '../../../lib/storage.js'
import { PATHS } from '../../../app/paths.js'
import '../portfolio.css'
import { lastYears } from '../lib/panel-window.js'
import { computeRisk, panelSymbols, sectorExposure } from '../lib/risk-view.js'
import { todayMx } from '../tx-labels.js'
import { cutAt, futureNotice } from '../lib/book-cut.js'
import FutureNotice from '../components/FutureNotice.jsx'

const Heatmap = lazy(() => import('../../../components/charts/Heatmap.jsx').then((m) => ({ default: m.Heatmap })))

// Tres años de cierres semanales: el contrato no tiene 3y, así que se pide 5y y se recorta.
const PANEL_PARAMS = { range: '5y', interval: '1wk', ccy: 'MXN' }
const WINDOW_YEARS = 3

/** @param {any} s */
const selectActive = (s) => s.portfolios.find((/** @type {any} */ p) => p.id === s.activePortfolioId) ?? null

const SECTOR_COLUMNS = [
  // El peso va junto al sector: a 390 px es lo que se alcanza a ver sin desplazar la tabla.
  { key: 'label', header: 'Sector' },
  { key: 'weight', header: 'Peso', numeric: true, format: (/** @type {any} */ v) => fmtPct(v) },
  { key: 'value', header: 'Valor en pesos', numeric: true, format: (/** @type {any} */ v) => fmtMoney(v) },
  { key: 'symbols', header: 'Emisoras', format: (/** @type {string[]} */ v) => v.join(', ') },
]

export default function Risk() {
  const portfolio = useStore(selectActive)
  const transactions = useMemo(() => portfolio?.transactions ?? [], [portfolio])
  const today = todayMx()
  // Corte en hoy: un movimiento con fecha futura todavía no cuenta, igual que en el resumen, y se dice.
  const { current: book, future: futureCount } = useMemo(() => cutAt(transactions, today), [transactions, today])
  const positions = useMemo(() => derivePositions(book, { asOf: today }), [book, today])
  const symbols = useMemo(() => panelSymbols(positions), [positions])
  const panel = useQuery({ ...panelQuery(symbols, PANEL_PARAMS), enabled: positions.length > 0 })
  const risk = useMemo(() => computeRisk(positions, lastYears(panel.data, WINDOW_YEARS)), [positions, panel.data])
  // La misma lista ordenada que el resumen, así que comparten la caché de /v2/quotes.
  const held = useMemo(() => positions.map((p) => p.symbol).sort(), [positions])
  const quotes = useQuery({ ...quotesQuery(held), enabled: held.length > 0 })
  const sectors = useMemo(() => (risk ? sectorExposure(risk.values, quotes.data?.quotes) : null), [risk, quotes.data])

  const header = (
    <PageHeader
      title="Riesgo"
      eyebrow={portfolio?.name}
      description="Qué tanto se mueve tu portafolio con los pesos de hoy, medido con precios semanales en pesos de los últimos tres años. Cuenta solo tus posiciones, sin el efectivo."
    />
  )

  if (!portfolio || positions.length === 0) {
    return (
      <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
        {header}
        <EmptyState
          title={portfolio ? 'Aún no hay posiciones' : 'Todavía no tienes un portafolio'}
          text={portfolio ? (futureNotice(futureCount, 'al riesgo') ?? 'Registra tus compras en Movimientos para medir el riesgo.') : 'Crea uno en la bienvenida para empezar.'}
          action={
            <Link className="kz-button" data-variant="primary" data-size="md" to={portfolio ? PATHS.portfolioTransactions : PATHS.onboarding}>
              {portfolio ? 'Ir a Movimientos' : 'Ir a la bienvenida'}
            </Link>
          }
        />
      </div>
    )
  }

  const meta = panel.data?.meta
  const loading = panel.isLoading
  const dropped = panel.data?.dropped ?? []

  return (
    <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
      {header}
      <FutureNotice count={futureCount} where="al riesgo" />
      {panel.isError ? (
        <ErrorState message="No pudimos traer los precios históricos para medir el riesgo." onRetry={() => panel.refetch()} retrying={panel.isFetching} />
      ) : (
        <>
          <Card title="Medidas de riesgo" status={meta} description={risk ? `${fmtNumber(risk.weeks, { decimals: 0 })} semanas de datos` : undefined}>
            <div className="kz-metric-grid">
              <Stat loading={loading} label="Caída máxima" value={risk ? fmtPct(risk.maxDrawdown) : undefined} info={{ termKey: 'drawdown-maximo', term: 'Caída máxima' }} />
              <Stat loading={loading} label="VaR 95%, una semana" value={risk ? fmtPct(risk.var95) : undefined} sublabel="Pérdida que solo se superó 1 de cada 20 semanas" info={{ termKey: 'var', term: 'VaR' }} />
              <Stat loading={loading} label="CVaR 95%, una semana" value={risk ? fmtPct(risk.cvar95) : undefined} sublabel="Pérdida promedio en esas semanas malas" info={{ termKey: 'cvar', term: 'CVaR' }} />
              <Stat loading={loading} label="Beta contra el IPC (NAFTRAC)" value={risk ? fmtNumber(risk.betaIpc) : undefined} info={{ termKey: 'beta', term: 'Beta' }} />
              <Stat loading={loading} label="Beta contra el S&P 500 (SPY, en pesos)" value={risk ? fmtNumber(risk.betaSpx) : undefined} />
              <Stat loading={loading} label="Número efectivo de activos" value={risk ? fmtNumber(risk.effectiveN, { decimals: 1 }) : undefined} info={{ termKey: 'numero-efectivo-de-activos', term: 'Número efectivo de activos' }} />
              <Stat loading={loading} label="Exposición a dólares" value={risk ? fmtPct(risk.usdShare) : undefined} sublabel="Parte de tus posiciones que registraste en dólares; lo del SIC comprado en pesos no entra aquí" />
            </div>
            {dropped.length > 0 && (
              <p className="kz-portfolio-note">Sin historia suficiente, quedaron fuera: {dropped.map((/** @type {any} */ d) => d.symbol).join(', ')}.</p>
            )}
          </Card>

          <Card
            title="Concentración por sector"
            padding="none"
            status={quotes.data?.meta}
            description="Peso de cada sector con los mismos valores en pesos de las medidas de riesgo. Los fondos y ETF van juntos: reparten su dinero entre muchos sectores."
          >
            {quotes.isError ? (
              <ErrorState message="No pudimos traer los sectores de tus emisoras. Las medidas de riesgo no cambian." onRetry={() => quotes.refetch()} retrying={quotes.isFetching} size="sm" />
            ) : (
              <>
                <div className="kz-metric-grid kz-portfolio-stats">
                  <Stat
                    loading={loading || quotes.isLoading}
                    label="Número efectivo de sectores"
                    value={sectors ? fmtNumber(sectors.effectiveN, { decimals: 1 }) : undefined}
                    sublabel={
                      !sectors
                        ? undefined
                        : sectors.effectiveN != null
                          ? `Sobre el ${fmtPct(sectors.coverage, { decimals: 0 })} del valor de tus posiciones, la parte que tiene sector`
                          : 'Ninguna de tus posiciones trae sector; los fondos no cuentan'
                    }
                    info={{ termKey: 'numero-efectivo-de-activos', term: 'Número efectivo de activos' }}
                  />
                  <Stat loading={loading || quotes.isLoading} label="HHI por sector" value={sectors ? fmtNumber(sectors.hhi, { decimals: 2 }) : undefined} sublabel="De 1 entre el número de sectores (parejo) a 1 (todo en uno)" />
                </div>
                <DataTable
                  caption="Peso por sector"
                  captionHidden
                  columns={SECTOR_COLUMNS}
                  rows={sectors?.groups ?? []}
                  rowKey={(/** @type {any} */ r) => r.key ?? 'sd'}
                  loading={loading || quotes.isLoading}
                  defaultSort={{ key: 'value', direction: 'descending' }}
                  empty={{ title: 'Sin sectores que mostrar', text: 'Hace falta el precio histórico de tus posiciones.' }}
                />
              </>
            )}
          </Card>

          {loading ? (
            <Skeleton height={240} />
          ) : (
            risk &&
            risk.symbols.length > 1 && (
              <Suspense fallback={<Skeleton height={240} />}>
                <Heatmap
                  title="Correlaciones entre tus emisoras"
                  titleAs="h2"
                  description="1 quiere decir que se mueven igual; cerca de 0, que se mueven por su lado."
                  rows={risk.symbols}
                  columns={risk.symbols}
                  values={risk.corr}
                  max={1}
                  status={meta}
                  source="Precios semanales en pesos, tres años"
                />
              </Suspense>
            )
          )}
        </>
      )}
    </div>
  )
}
