// /herramientas/optimizador: mínima varianza, paridad de riesgo y máximo Sharpe sobre una covarianza
// de Ledoit y Wolf, con la frontera eficiente, la validación walk forward y los supuestos a la
// vista. Precios semanales en pesos de /v2/panel; todo el cálculo es de src/lib/finance.
import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Card, EmptyState, ErrorState, InfoTip, PageHeader, Skeleton, SrOnly } from '../../../components/ui/index.js'
import { derivePositions } from '../../../lib/finance/index.js'
import { fmtPct } from '../../../lib/format.js'
import { useStore } from '../../../lib/storage.js'
import { DEFAULT_ASSUMPTIONS } from '../assumptions.js'
import { AssumptionsForm } from '../components/AssumptionsForm.jsx'
import { InputsCard } from '../components/InputsCard.jsx'
import { PortfoliosCard } from '../components/PortfoliosCard.jsx'
import { SymbolPicker } from '../components/SymbolPicker.jsx'
import { ValidationCard } from '../components/ValidationCard.jsx'
import { MAX_ASSETS, MIN_PERIODS, droppedSymbols } from '../optimizer.js'
import { parseSymbols } from '../selection.js'
import { useOptimizer } from '../useOptimizer.js'
import '../tools.css'

const FrontierChart = lazy(() => import('../../../components/charts/FrontierChart.jsx').then((m) => ({ default: m.FrontierChart })))

const METHODOLOGY = '/aprender/metodologia/optimizador'
const MU_LABEL = { capm: 'CAPM', jamesStein: 'James y Stein', historical: 'promedio histórico' }

/** @param {any} s */
const selectActive = (s) => s.portfolios.find((/** @type {any} */ p) => p.id === s.activePortfolioId) ?? null

/** @param {{ title?: string, children: import('react').ReactNode }} props */
function ResultCard({ title = 'Resultado', children }) {
  return <Card title={title}>{children}</Card>
}

export default function OptimizerPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('symbols')
  const portfolio = useStore(selectActive)
  const transactions = useMemo(() => portfolio?.transactions ?? [], [portfolio])
  const positions = useMemo(() => derivePositions(transactions).filter((p) => p.quantity > 0), [transactions])
  const portfolioSymbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  // Sin ?symbols en la URL se arranca con las emisoras del portafolio activo.
  const symbols = useMemo(() => (raw === null ? portfolioSymbols.slice(0, MAX_ASSETS) : parseSymbols(raw)), [raw, portfolioSymbols])
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS)
  const m = useOptimizer(symbols, assumptions, positions)

  const setSymbols = (/** @type {string[]} */ next) => setParams((p) => {
    const out = new URLSearchParams(p)
    out.set('symbols', next.join(','))
    return out
  }, { replace: true })

  const meta = m.panel.data?.meta
  const dropped = droppedSymbols(m.panel.data, m.prep, symbols)

  let results
  if (symbols.length < 2) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="Elige al menos dos emisoras" text="Agrégalas con la búsqueda o usa las de tu portafolio. Con una sola no hay nada que repartir." />
      </ResultCard>
    )
  } else if (m.panel.isPending) {
    results = (
      <ResultCard>
        <div aria-busy="true">
          <SrOnly>Cargando precios históricos</SrOnly>
          <Skeleton lines={6} />
        </div>
      </ResultCard>
    )
  } else if (m.panel.isError) {
    results = (
      <ResultCard>
        <ErrorState
          message={m.panel.error instanceof Error ? m.panel.error.message : 'No pudimos traer los precios históricos.'}
          onRetry={() => m.panel.refetch()}
          retrying={m.panel.isFetching}
        />
      </ResultCard>
    )
  } else if (!m.usable) {
    results = (
      <ResultCard>
        <EmptyState
          headingAs="h3"
          title="No alcanzan los datos para optimizar"
          text={`Hacen falta al menos dos emisoras con ${MIN_PERIODS} semanas de precios en común${m.prep ? ` y hay ${m.prep.periods}` : ''}. Solo cuentan las fechas que todas tienen, así que una emisora reciente recorta la historia de las demás: quítala para ver si alcanza. ${dropped.length ? `Quedaron fuera: ${dropped.join(', ')}.` : ''}`}
        />
      </ResultCard>
    )
  } else if (!m.valid) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="Revisa los supuestos marcados" text="Cuando todos tengan un valor válido, calculamos de nuevo." />
      </ResultCard>
    )
  } else if (!m.exp?.mu) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="Sin rendimientos esperados" text={`${m.exp?.reason ?? ''} Prueba con James y Stein.`} />
      </ResultCard>
    )
  } else if (!m.solve || m.solve.error) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="Estas restricciones no tienen solución" text={m.solve?.error ?? 'Revisa la caja de pesos.'} />
      </ResultCard>
    )
  } else {
    const { prep, solve, exp } = m
    const assetPoints = prep.assets.map((label, i) => ({ label, risk: m.vols[i], ret: exp.mu[i] }))
    const markers = {
      minVar: { risk: solve.minVariance.vol, ret: solve.minVariance.ret },
      ...(solve.maxSharpe ? { tangency: { risk: solve.maxSharpe.vol, ret: solve.maxSharpe.ret } } : {}),
      ...(solve.current ? { current: { risk: solve.current.vol, ret: solve.current.ret } } : {}),
    }
    results = (
      <>
        {dropped.length > 0 && (
          <p className="kz-tool__notice" role="note">
            Sin historia suficiente en estas fechas, quedaron fuera: {dropped.join(', ')}.
          </p>
        )}
        <PortfoliosCard
          assets={prep.assets}
          solve={solve}
          rfAnnual={/** @type {number} */ (m.rfAnnual)}
          status={meta}
          description={`Rendimientos esperados por ${MU_LABEL[assumptions.muMethod]}, tasa libre de riesgo de ${fmtPct(/** @type {number} */ (m.rfAnnual))} y pesos por emisora entre ${fmtPct((assumptions.minPct ?? 0) / 100, { decimals: 0 })} y ${fmtPct((assumptions.maxPct ?? 100) / 100, { decimals: 0 })}.`}
        />
        <Card>
          <Suspense fallback={<Skeleton height={380} />}>
            <FrontierChart
              title="Frontera eficiente"
              titleAs="h2"
              description="Riesgo contra rendimiento esperado, anual. Cada punto de la curva es la cartera de menor volatilidad para ese rendimiento. La paridad de riesgo no vive en la curva; sus números están arriba."
              actions={<InfoTip termKey="frontera-eficiente" term="Frontera eficiente" />}
              assets={assetPoints}
              frontier={solve.frontier}
              markers={markers}
              status={meta}
              source="Kaizen con precios semanales en pesos."
            />
          </Suspense>
        </Card>
        <ValidationCard result={m.validation} periods={prep.periods} status={meta} />
        <InputsCard
          assets={prep.assets}
          betas={m.betas}
          mu={exp.mu}
          vols={m.vols}
          muLabel={MU_LABEL[assumptions.muMethod]}
          shrinkage={m.cov.shrinkage}
          periods={prep.periods}
          start={prep.priceDates[0]}
          end={prep.priceDates[prep.priceDates.length - 1]}
          status={meta}
        />
      </>
    )
  }

  return (
    <div className="kz-container kz-col kz-tool" data-gap="6">
      <PageHeader
        eyebrow="Herramientas"
        title="Optimizador de portafolio"
        description="Tres maneras de repartir entre las emisoras que elijas, con los supuestos a la vista y su prueba fuera de muestra."
      />
      <div className="kz-tool__layout">
        <div className="kz-tool__side">
          <Card title="Emisoras" description={`De 2 a ${MAX_ASSETS}. Usamos precios semanales en pesos de los últimos cinco años.`}>
            <SymbolPicker id="opt-symbols" selected={symbols} onChange={setSymbols} max={MAX_ASSETS} portfolioSymbols={portfolioSymbols} />
          </Card>
          <Card title="Supuestos" status={m.rf.data?.meta}>
            {m.rf.isError && (
              <ErrorState size="sm" title="No pudimos traer la tasa de CETES" message="Puedes escribir una tasa para seguir." onRetry={() => m.rf.refetch()} retrying={m.rf.isFetching} />
            )}
            <AssumptionsForm value={assumptions} errors={m.errors} onChange={(patch) => setAssumptions((prev) => ({ ...prev, ...patch }))} apiRf={m.apiRf} rfLoading={m.rf.isFetching} apiErp={m.apiErp} />
          </Card>
        </div>
        <div className="kz-tool__results">
          {results}
          <Card title="Qué supone este optimizador">
            <ul className="kz-tool__notes">
              <li>Solo largo: sin ventas en corto ni apalancamiento. Los pesos de cada cartera suman 100 %.</li>
              <li>Covarianzas y betas salen del pasado; en las crisis las correlaciones cambian.</li>
              <li>No incluye comisiones ni impuestos. Mover tu portafolio hacia una de estas carteras tiene un costo real.</li>
              <li>Las carteras dependen de los supuestos. Por eso ves tres y la frontera, no una sola respuesta.</li>
              <li>Es una herramienta de análisis, no una recomendación de inversión.</li>
            </ul>
            <p className="kz-tool__more">
              <Link to={METHODOLOGY}>Lee la metodología del optimizador</Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
