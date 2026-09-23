// /herramientas/backtest: comprar y mantener (por omisión) o mezcla constante sobre precios
// semanales en pesos de /v2/panel, contra el IPC, el S&P 500 en pesos o una mezcla. CAGR,
// volatilidad, caída máxima y sus gráficas, todo con src/lib/finance. Cuando se prueban los pesos
// de hoy sobre la historia, la página lo dice antes que cualquier número.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, SrOnly } from '../../../components/ui/index.js'
import { derivePositions } from '../../../lib/finance/index.js'
import { fmtDate } from '../../../lib/format.js'
import { useStore } from '../../../lib/storage.js'
import { benchmarkLabel, benchmarkShort } from '../backtester.js'
import { BacktestForm } from '../components/BacktestForm.jsx'
import { BacktestResults } from '../components/BacktestResults.jsx'
import { equalPercents, parseSymbols } from '../selection.js'
import { useBacktest } from '../useBacktest.js'
import '../tools.css'

const METHODOLOGY = '/aprender/metodologia/backtest'

/** @param {any} s */
const selectActive = (s) => s.portfolios.find((/** @type {any} */ p) => p.id === s.activePortfolioId) ?? null

/** @param {{ children: import('react').ReactNode }} props */
function ResultCard({ children }) {
  return <Card title="Resultado">{children}</Card>
}

export default function BacktestPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('symbols')
  const portfolio = useStore(selectActive)
  const transactions = useMemo(() => portfolio?.transactions ?? [], [portfolio])
  const positions = useMemo(() => derivePositions(transactions).filter((p) => p.quantity > 0), [transactions])
  const portfolioSymbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const symbols = useMemo(() => parseSymbols(raw), [raw])
  const hasPortfolio = positions.length > 0

  const [form, setForm] = useState(() => ({
    mode: /** @type {'portfolio' | 'manual'} */ (raw === null && hasPortfolio ? 'portfolio' : 'manual'),
    percents: /** @type {Record<string, number | null>} */ (equalPercents(symbols)),
    strategy: /** @type {'buyAndHold' | 'constantMix'} */ ('buyAndHold'),
    rebalance: /** @type {'weekly' | 'monthly' | 'quarterly' | 'annual'} */ ('monthly'),
    benchmark: /** @type {'ipc' | 'spx' | 'blend'} */ ('ipc'),
    blendIpcPct: /** @type {number | null} */ (50),
    range: '5y',
  }))
  const mode = form.mode === 'portfolio' && !hasPortfolio ? 'manual' : form.mode
  const set = (/** @type {Partial<typeof form>} */ patch) => setForm((prev) => ({ ...prev, ...patch }))
  const onSymbols = (/** @type {string[]} */ next) => {
    set({ percents: equalPercents(next) })
    setParams((p) => {
      const out = new URLSearchParams(p)
      out.set('symbols', next.join(','))
      return out
    }, { replace: true })
  }

  const bt = useBacktest({ symbols, mode, percents: form.percents, positions, strategy: form.strategy, rebalance: form.rebalance, benchmark: form.benchmark, blendIpcPct: form.blendIpcPct, range: form.range })
  const benchLabel = benchmarkLabel(form.benchmark, (form.blendIpcPct ?? 50) / 100)
  const meta = bt.panel.data?.meta
  const r = bt.result
  const dropped = [...new Set([...(bt.panel.data?.dropped ?? []).map((/** @type {any} */ d) => d.symbol), ...(r?.missing ?? [])])]

  let results
  if (!bt.enabled) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="Elige qué probar" text="Agrega al menos una emisora con su peso, o usa los pesos de tu cartera de hoy." />
      </ResultCard>
    )
  } else if (bt.panel.isPending) {
    results = (
      <ResultCard>
        <div aria-busy="true">
          <SrOnly>Cargando precios históricos</SrOnly>
          <Skeleton lines={6} />
        </div>
      </ResultCard>
    )
  } else if (bt.panel.isError) {
    results = (
      <ResultCard>
        <ErrorState message={bt.panel.error instanceof Error ? bt.panel.error.message : 'No pudimos traer los precios históricos.'} onRetry={() => bt.panel.refetch()} retrying={bt.panel.isFetching} />
      </ResultCard>
    )
  } else if (mode === 'manual' && (Object.keys(bt.manual.errors).length > 0 || bt.manual.sumError)) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="Revisa los pesos" text="Cuando cada peso sea válido y sumen 100 %, corremos la prueba." />
      </ResultCard>
    )
  } else if (bt.blendError) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="Revisa la mezcla del referente" text={bt.blendError} />
      </ResultCard>
    )
  } else if (!r || r.error) {
    results = (
      <ResultCard>
        <EmptyState headingAs="h3" title="No hay con qué correr la prueba" text={r?.error ?? 'Ninguna emisora tiene precios en este periodo.'} />
      </ResultCard>
    )
  } else {
    results = (
      <>
        {dropped.length > 0 && (
          <p className="kz-tool__notice" role="note">
            Sin historia en todo el periodo, quedaron fuera: {dropped.join(', ')}. Los demás pesos se reescalaron para sumar 100 %.
          </p>
        )}
        <BacktestResults result={r} benchLabel={benchLabel} benchShort={benchmarkShort(form.benchmark)} mineLabel={mode === 'portfolio' ? 'Tu cartera' : 'Tu mezcla'} status={meta} rf={{ meta: bt.rf.data?.meta, isError: bt.rf.isError, refetch: bt.rf.refetch }} />
      </>
    )
  }

  return (
    <div className="kz-container kz-col kz-tool" data-gap="6">
      <PageHeader
        eyebrow="Herramientas"
        title="Backtest"
        description="Cómo le habría ido a una mezcla de emisoras en el pasado, en pesos y contra un referente en la misma moneda."
      />
      <div className="kz-tool__layout">
        <div className="kz-tool__side">
          <Card title="Qué quieres probar" description="Precios semanales ajustados por dividendos y splits, en pesos.">
            <BacktestForm
              state={{ ...form, mode, symbols }}
              set={set}
              hasPortfolio={hasPortfolio}
              portfolioSymbols={portfolioSymbols}
              onSymbols={onSymbols}
              manual={bt.manual}
              blendError={bt.blendError}
              onEqual={() => set({ percents: equalPercents(symbols) })}
            />
          </Card>
        </div>
        <div className="kz-tool__results">
          <section className="kz-tool__caveats" aria-labelledby="bt-caveats">
            <h2 id="bt-caveats" className="kz-tool__subtitle">Antes de ver los números</h2>
            {mode === 'portfolio' && (
              <p className="kz-tool__notice" role="note">
                <strong>Pesos de hoy sobre historia anterior.</strong> Esta prueba reparte tu cartera como está hoy
                {r && !r.error ? ` desde el ${fmtDate(r.start)}` : ' desde el inicio del periodo'}. Nadie tenía esos pesos entonces, y las
                emisoras que hoy tienes las elegiste después: el resultado puede verse mejor de lo que habría sido.
              </p>
            )}
            <p className="kz-tool__hint">No incluye comisiones, diferencial de compra y venta, impuestos ni problemas de liquidez. Describe el pasado; no es una promesa ni una recomendación.</p>
          </section>
          {results}
          <Card title="Qué sesgos no quita ninguna herramienta">
            <ul className="kz-tool__notes">
              <li>Supervivencia: solo entran emisoras que hoy existen; las que quebraron ya no están en la muestra.</li>
              <li>Sobreajuste: entre más combinaciones pruebes, más fácil es que una se vea bien por casualidad. Cambia el periodo y vuelve a correrlo.</li>
              <li>El CAGR es el rendimiento compuesto, no el promedio de las semanas por 52, que exagera.</li>
            </ul>
            <p className="kz-tool__more">
              <Link to={METHODOLOGY}>Lee la metodología del backtest</Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
