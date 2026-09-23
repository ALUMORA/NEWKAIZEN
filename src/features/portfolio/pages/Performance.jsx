// /portafolio/rendimiento: valor del portafolio en el tiempo desde el libro, TWR y XIRR, contra
// la referencia de settings.benchmark, P&L en efecto precio y efecto tipo de cambio, e ISR
// estimado. Los precios salen de /v2/panel dos veces: ccy=MXN (pesos, y la referencia) y ccy=USD
// (lo que cotiza en dólares, en su moneda); el tipo de cambio, del FIX de /v2/fx/history.
// Las fórmulas son las de src/lib/finance y las de docs/metodologia/portafolio.md.
import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, Delta, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '../../../components/ui/index.js'
import { fmtDate, fmtMoney, fmtNumber, fmtPct, fmtPp } from '../../../lib/format.js'
import { fxHistoryQuery, panelQuery } from '../../../lib/api/queries.js'
import { DEFAULT_BENCHMARK, useStore } from '../../../lib/storage.js'
import { PATHS } from '../../../app/paths.js'
import { minusDays, todayMx } from '../tx-labels.js'
import { computePerformance, isrView, nativePriceTable, pickWindow, pnlByPosition, splitAdjusted, zipTable } from '../lib/performance-view.js'
import DataSources from '../components/DataSources.jsx'
import PnlCard from '../components/PnlCard.jsx'
import IsrCard from '../components/IsrCard.jsx'
import HowToRead from '../components/HowToRead.jsx'
import '../portfolio.css'

const TimeSeries = lazy(() => import('../../../components/charts/TimeSeries.jsx').then((m) => ({ default: m.TimeSeries })))

/** @param {any} s */
const selectActive = (s) => s.portfolios.find((/** @type {any} */ p) => p.id === s.activePortfolioId) ?? null
/** @param {any} s */
const selectBenchmark = (s) => s.settings?.benchmark || DEFAULT_BENCHMARK

const TRADES = new Set(['buy', 'sell', 'split'])

export default function Performance() {
  const portfolio = useStore(selectActive)
  const benchmark = useStore(selectBenchmark)
  const today = todayMx()
  const raw = useMemo(() => /** @type {any[]} */ (portfolio?.transactions ?? []), [portfolio])
  const txs = useMemo(() => splitAdjusted(raw), [raw])
  const win = useMemo(() => pickWindow(raw, today), [raw, today])

  // Emisoras que el libro tuvo alguna vez y la moneda en que se capturaron.
  const { symbols, usdSymbols } = useMemo(() => {
    /** @type {Map<string, string>} */
    const ccy = new Map()
    for (const t of raw) if (TRADES.has(t.type) && t.symbol && !ccy.has(t.symbol)) ccy.set(t.symbol, t.currency)
    const list = [...ccy.keys()].sort()
    return { symbols: list, usdSymbols: new Set(list.filter((s) => ccy.get(s) === 'USD')) }
  }, [raw])
  const usdList = useMemo(() => symbols.filter((s) => usdSymbols.has(s)), [symbols, usdSymbols])
  const needsFx = usdList.length > 0 || raw.some((t) => t.currency === 'USD')

  const params = { range: win.range, interval: win.interval }
  const panelMxn = useQuery({ ...panelQuery([...new Set([...symbols, benchmark])], { ...params, ccy: 'MXN' }), enabled: symbols.length > 0 })
  const panelUsd = useQuery({ ...panelQuery(usdList, { ...params, ccy: 'USD' }), enabled: usdList.length > 0 })
  const dates = panelMxn.data?.dates ?? []
  const fxHist = useQuery({
    ...fxHistoryQuery({ start: dates[0] ? minusDays(dates[0], 10) : undefined, end: dates[dates.length - 1] }),
    enabled: needsFx && dates.length > 0,
  })

  const isr = useMemo(() => isrView(raw), [raw])
  const ready = Boolean(panelMxn.data) && (usdList.length === 0 || Boolean(panelUsd.data)) && (!needsFx || Boolean(fxHist.data))
  const failed = panelMxn.isError || panelUsd.isError || fxHist.isError
  const view = useMemo(() => {
    if (!ready || !panelMxn.data) return null
    const prices = nativePriceTable(panelMxn.data, panelUsd.data, usdSymbols)
    const fx = zipTable(fxHist.data?.dates, fxHist.data?.values)
    const bench = panelMxn.data.prices[benchmark] ? zipTable(panelMxn.data.dates, panelMxn.data.prices[benchmark]) : null
    const perf = computePerformance({ transactions: txs, prices, fx, dates: panelMxn.data.dates, benchmark: bench })
    const at = perf.ok ? perf.windowDates[perf.windowDates.length - 1] : panelMxn.data.dates[panelMxn.data.dates.length - 1]
    return { perf, pnl: at ? pnlByPosition(txs, prices, fx, at) : null }
  }, [ready, panelMxn.data, panelUsd.data, fxHist.data, usdSymbols, benchmark, txs])

  const header = (
    <PageHeader
      title="Rendimiento"
      eyebrow={portfolio?.name}
      description="Cómo le ha ido a tu portafolio en pesos, medido por tiempo (TWR) y por dinero (XIRR), contra tu referencia."
      actions={portfolio ? <Link className="kz-button" data-variant="secondary" data-size="md" to="/aprender/metodologia/portafolio">Cómo se calcula</Link> : undefined}
    />
  )

  if (!portfolio || symbols.length === 0) {
    return (
      <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
        {header}
        <EmptyState
          title={portfolio ? 'Aún no hay compras en tu libro' : 'Todavía no tienes un portafolio'}
          text={portfolio ? 'Registra tus compras en Movimientos para medir su rendimiento.' : 'Crea uno en la bienvenida para empezar.'}
          action={
            <Link className="kz-button" data-variant="primary" data-size="md" to={portfolio ? PATHS.portfolioTransactions : PATHS.onboarding}>
              {portfolio ? 'Ir a Movimientos' : 'Ir a la bienvenida'}
            </Link>
          }
        />
      </div>
    )
  }

  const perf = view?.perf
  const ok = perf?.ok ? perf : null
  const loading = !failed && !view
  const meta = panelMxn.data?.meta
  const retry = () => {
    if (panelMxn.isError) panelMxn.refetch()
    if (panelUsd.isError) panelUsd.refetch()
    if (fxHist.isError) fxHist.refetch()
  }
  const sources = (
    <DataSources
      items={[
        { label: 'Precios en pesos', meta },
        { label: 'Precios en dólares', meta: panelUsd.data?.meta },
        { label: 'Tipo de cambio FIX', meta: fxHist.data?.meta },
      ]}
    />
  )
  const dropped = [...(panelMxn.data?.dropped ?? []), ...(panelUsd.data?.dropped ?? [])]
  const period = ok ? `Del ${fmtDate(ok.windowDates[0])} al ${fmtDate(ok.windowDates[ok.windowDates.length - 1])}, ${fmtNumber(ok.windowDates.length, { decimals: 0 })} cierres ${(panelMxn.data?.interval ?? win.interval) === '1d' ? 'diarios' : 'semanales'}` : undefined
  const chartPoints = (/** @type {(number | null)[]} */ arr) => (ok ? ok.windowDates.map((date, i) => ({ date, value: arr[i] == null ? null : /** @type {number} */ (arr[i]) * 100 })) : [])

  return (
    <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
      {header}

      {failed ? (
        <ErrorState message="No pudimos traer los precios o el tipo de cambio para medir tu rendimiento." onRetry={retry} retrying={panelMxn.isFetching || panelUsd.isFetching || fxHist.isFetching} />
      ) : (
        <>
          <Card title="Resumen del periodo" status={meta} description={period} footer={sources}>
            {view && !ok ? (
              <EmptyState
                size="sm"
                title="Todavía no se puede medir"
                text={perf?.missing?.[0]?.reason ?? 'Hace falta al menos un cierre después de tu primera compra.'}
              />
            ) : (
              <div className="kz-metric-grid">
                <Stat loading={loading} label="Valor al último cierre" value={ok ? fmtMoney(ok.endValue) : undefined} sublabel="Posiciones más efectivo, en pesos" />
                <Stat loading={loading} label="Ganancia en el periodo" value={ok ? <Delta value={ok.gain} kind="money" currency="MXN" /> : undefined} sublabel="Valor final, menos el inicial y lo que aportaste" />
                <Stat
                  loading={loading}
                  label="TWR del periodo"
                  info={{ termKey: 'twr', term: 'TWR' }}
                  value={ok ? <Delta value={ok.twr} /> : undefined}
                  sublabel={ok ? (ok.twrAnnual != null ? `${fmtPct(ok.twrAnnual, { sign: true })} al año` : 'Menos de un año: no se anualiza') : undefined}
                />
                <Stat
                  loading={loading}
                  label="XIRR anual"
                  info={{ termKey: 'xirr', term: 'XIRR' }}
                  value={ok ? <Delta value={ok.xirr} /> : undefined}
                  sublabel={ok ? (ok.years < 1 ? 'Anualizado: con menos de un año exagera' : 'Rendimiento de tu dinero, con sus fechas') : undefined}
                />
                <Stat loading={loading} label={`Referencia: ${benchmark}`} value={ok ? <Delta value={ok.benchReturn} /> : undefined} sublabel="Mismo periodo, en pesos" />
                <Stat
                  loading={loading}
                  label="TWR menos la referencia"
                  value={ok && ok.twr != null && ok.benchReturn != null ? fmtPp(ok.twr - ok.benchReturn) : undefined}
                  sublabel="En puntos porcentuales"
                />
              </div>
            )}
            {dropped.length > 0 && (
              <p className="kz-portfolio-hint">{`Sin historia suficiente, quedaron fuera: ${dropped.map((d) => d.symbol).join(', ')}.`}</p>
            )}
          </Card>

          {loading ? (
            <Skeleton height={320} />
          ) : (
            ok && (
              <Suspense fallback={<Skeleton height={320} />}>
                <TimeSeries
                  title={`Tu portafolio contra ${benchmark}`}
                  titleAs="h2"
                  description="Crecimiento de 100 pesos con el TWR, que quita el efecto de cuándo metiste dinero, contra la referencia en pesos."
                  series={[
                    { id: 'twr', label: 'Tu portafolio (TWR)', points: chartPoints(ok.index) },
                    { id: 'ref', label: `Referencia: ${benchmark}`, points: chartPoints(ok.benchIndex), dash: true },
                  ]}
                  decimals={1}
                  status={meta}
                  source="Cierres ajustados en pesos y tu libro de movimientos"
                />
              </Suspense>
            )
          )}

          {!loading && ok && (
            <Suspense fallback={<Skeleton height={280} />}>
              <TimeSeries
                title="Valor del portafolio en pesos"
                titleAs="h2"
                description="Posiciones más efectivo en cada cierre. Sube también cuando aportas; para comparar usa el TWR."
                series={[{ id: 'value', label: 'Valor', points: ok.windowDates.map((date, i) => ({ date, value: ok.values[i] })), area: true }]}
                format="money"
                decimals={0}
                status={meta}
                source="Cierres ajustados, FIX de Banxico y tu libro de movimientos"
              />
            </Suspense>
          )}

          <PnlCard pnl={view?.pnl ?? null} loading={loading} status={meta} footer={sources} />
        </>
      )}

      <IsrCard isr={isr} />
      <HowToRead transactions={raw} perf={ok} />
    </div>
  )
}
