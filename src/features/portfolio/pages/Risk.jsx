// /portafolio/riesgo: riesgo del portafolio con los pesos de hoy sobre precios semanales en pesos
// de /v2/panel (tres años). Caída máxima, VaR y CVaR, beta contra IPC y S&P 500 en pesos, número
// efectivo de activos, exposición a dólares y correlaciones. Todo con src/lib/finance.
import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '../../../components/ui/index.js'
import { correlation, covariance, derivePositions, drawdowns, historicalCVaR, historicalVaR, simpleReturns, variance } from '../../../lib/finance/index.js'
import { fmtNumber, fmtPct } from '../../../lib/format.js'
import { panelQuery } from '../../../lib/api/queries.js'
import { useStore } from '../../../lib/storage.js'
import { PATHS } from '../../../app/paths.js'
import '../portfolio.css'

const Heatmap = lazy(() => import('../../../components/charts/Heatmap.jsx').then((m) => ({ default: m.Heatmap })))

const IPC = '^MXX'
const SPX = '^GSPC'
const PANEL_PARAMS = { range: '3y', interval: '1wk', ccy: 'MXN' }

/** @param {any} s */
const selectActive = (s) => s.portfolios.find((/** @type {any} */ p) => p.id === s.activePortfolioId) ?? null

/** @param {number[]} y @param {number[]} x */
function beta(y, x) {
  const v = variance(x)
  const c = covariance(y, x)
  return v && c != null ? c / v : null
}

/**
 * @param {any[]} positions
 * @param {{ dates: string[], prices: Record<string, number[]> } | undefined} panel
 */
function computeRisk(positions, panel) {
  if (!panel || panel.dates.length < 3) return null
  const held = positions.filter((p) => panel.prices[p.symbol]?.length)
  const last = (/** @type {string} */ s) => panel.prices[s][panel.prices[s].length - 1]
  const values = held.map((p) => p.quantity * last(p.symbol))
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null
  const weights = values.map((v) => v / total)
  const returns = held.map((p) => /** @type {number[]} */ (simpleReturns(panel.prices[p.symbol])))
  const n = returns[0]?.length ?? 0
  const port = Array.from({ length: n }, (_, t) => returns.reduce((acc, r, i) => acc + weights[i] * r[t], 0))
  let level = 1
  const path = [1, ...port.map((r) => (level *= 1 + r))]
  const ipc = panel.prices[IPC] ? /** @type {number[]} */ (simpleReturns(panel.prices[IPC])) : null
  const spx = panel.prices[SPX] ? /** @type {number[]} */ (simpleReturns(panel.prices[SPX])) : null
  const symbols = held.map((p) => p.symbol)
  return {
    maxDrawdown: drawdowns(path)?.maxDrawdown ?? null,
    var95: historicalVaR(port, 0.95),
    cvar95: historicalCVaR(port, 0.95),
    betaIpc: ipc ? beta(port, ipc) : null,
    betaSpx: spx ? beta(port, spx) : null,
    effectiveN: 1 / weights.reduce((a, w) => a + w * w, 0),
    usdShare: held.reduce((acc, p, i) => acc + (p.currency === 'USD' ? weights[i] : 0), 0),
    symbols,
    corr: symbols.map((_, i) => symbols.map((__, j) => (i === j ? 1 : correlation(returns[i], returns[j])))),
    weeks: n,
  }
}

export default function Risk() {
  const portfolio = useStore(selectActive)
  const transactions = useMemo(() => portfolio?.transactions ?? [], [portfolio])
  const positions = useMemo(() => derivePositions(transactions), [transactions])
  const symbols = useMemo(() => [...positions.map((p) => p.symbol), IPC, SPX], [positions])
  const panel = useQuery({ ...panelQuery(symbols, PANEL_PARAMS), enabled: positions.length > 0 })
  const risk = useMemo(() => computeRisk(positions, panel.data), [positions, panel.data])

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
          text={portfolio ? 'Registra tus compras en Movimientos para medir el riesgo.' : 'Crea uno en la bienvenida para empezar.'}
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
      {panel.isError ? (
        <ErrorState message="No pudimos traer los precios históricos para medir el riesgo." onRetry={() => panel.refetch()} retrying={panel.isFetching} />
      ) : (
        <>
          <Card title="Medidas de riesgo" status={meta} description={risk ? `${fmtNumber(risk.weeks, { decimals: 0 })} semanas de datos` : undefined}>
            <div className="kz-metric-grid">
              <Stat loading={loading} label="Caída máxima" value={risk ? fmtPct(risk.maxDrawdown) : undefined} info={{ termKey: 'drawdown-maximo', term: 'Caída máxima' }} />
              <Stat loading={loading} label="VaR 95 %, una semana" value={risk ? fmtPct(risk.var95) : undefined} sublabel="Pérdida que solo se superó 1 de cada 20 semanas" info={{ termKey: 'var', term: 'VaR' }} />
              <Stat loading={loading} label="CVaR 95 %, una semana" value={risk ? fmtPct(risk.cvar95) : undefined} sublabel="Pérdida promedio en esas semanas malas" info={{ termKey: 'cvar', term: 'CVaR' }} />
              <Stat loading={loading} label="Beta contra el IPC" value={risk ? fmtNumber(risk.betaIpc) : undefined} info={{ termKey: 'beta', term: 'Beta' }} />
              <Stat loading={loading} label="Beta contra el S&P 500 en pesos" value={risk ? fmtNumber(risk.betaSpx) : undefined} />
              <Stat loading={loading} label="Número efectivo de activos" value={risk ? fmtNumber(risk.effectiveN, { decimals: 1 }) : undefined} info={{ termKey: 'numero-efectivo-de-activos', term: 'Número efectivo de activos' }} />
              <Stat loading={loading} label="Exposición a dólares" value={risk ? fmtPct(risk.usdShare) : undefined} sublabel="Parte de tus posiciones que registraste en dólares; lo del SIC comprado en pesos no entra aquí" />
            </div>
            {dropped.length > 0 && (
              <p className="kz-portfolio-note">Sin historia suficiente, quedaron fuera: {dropped.map((/** @type {any} */ d) => d.symbol).join(', ')}.</p>
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
