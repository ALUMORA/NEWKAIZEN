// /portafolio/rebalanceo: metas por emisora y plan en títulos enteros (wholeShareRebalance de
// src/lib/finance). Todo se valúa en pesos: lo que cotiza en dólares se convierte con el tipo de
// cambio del día. Registrar el plan escribe los movimientos al libro y se puede deshacer.
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Button, Card, ConfirmDialog, DataStatus, DataTable, EmptyState, ErrorState, Input, NumberInput, PageHeader, Stat, useToast,
} from '../../../components/ui/index.js'
import { cashBalances, derivePositions, wholeShareRebalance } from '../../../lib/finance/index.js'
import { fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'
import { fxQuery, quotesQuery } from '../../../lib/api/queries.js'
import { isReadOnly, newId, normalizeSymbol, update, useStore } from '../../../lib/storage.js'
import { PATHS } from '../../../app/paths.js'
import { todayMx } from '../tx-labels.js'
import '../portfolio.css'

/** @param {any} s */
const selectActive = (s) => s.portfolios.find((/** @type {any} */ p) => p.id === s.activePortfolioId) ?? null

/** Distancia a las metas: suma de diferencias absolutas, en puntos porcentuales y sin signo. @param {number} v */
const fmtDistance = (v) => `${fmtNumber(v * 100, { decimals: 2 })} pp`

/** @param {string} id @param {(p: any) => any} fn */
function editPortfolio(id, fn) {
  update((s) => ({ ...s, portfolios: s.portfolios.map((p) => (p.id === id ? fn(p) : p)) }))
}

export default function Rebalance() {
  const portfolio = useStore(selectActive)
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState({ symbol: '', pct: /** @type {number | null} */ (null) })
  const [draftErrors, setDraftErrors] = useState(/** @type {{ symbol?: string, pct?: string }} */ ({}))
  const readOnly = isReadOnly()

  const transactions = useMemo(() => portfolio?.transactions ?? [], [portfolio])
  const targets = useMemo(() => /** @type {Record<string, number>} */ (portfolio?.targets ?? {}), [portfolio])
  const positions = useMemo(() => derivePositions(transactions), [transactions])
  const cash = useMemo(() => cashBalances(transactions), [transactions])
  const symbols = useMemo(
    () => [...new Set([...positions.map((p) => p.symbol), ...Object.keys(targets)])].sort(),
    [positions, targets],
  )

  const quotes = useQuery({ ...quotesQuery(symbols), enabled: symbols.length > 0 })
  // El tipo de cambio solo se pide si algo del portafolio está en dólares.
  const needsFx =
    positions.some((p) => p.currency === 'USD') || (cash.USD ?? 0) !== 0 || (quotes.data?.quotes ?? []).some((/** @type {any} */ q) => q.currency === 'USD')
  const fx = useQuery({ ...fxQuery(), enabled: needsFx })
  const usdRate = fx.data?.rate ?? null

  /** Precio en pesos por símbolo, y la cotización original. */
  const priced = useMemo(() => {
    /** @type {Record<string, { mxn: number | null, price: number, currency: string }>} */
    const out = {}
    for (const q of quotes.data?.quotes ?? []) {
      const mxn = q.currency === 'USD' ? (usdRate != null ? q.price * usdRate : null) : q.price
      out[q.symbol] = { mxn, price: q.price, currency: q.currency }
    }
    return out
  }, [quotes.data, usdRate])

  const holdings = useMemo(() => Object.fromEntries(positions.map((p) => [p.symbol, p.quantity])), [positions])
  const cashMxn = (cash.MXN ?? 0) + (usdRate != null ? (cash.USD ?? 0) * usdRate : 0)
  const targetSum = Object.values(targets).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  const targetsOk = Math.abs(targetSum - 1) < 0.0001

  const prices = useMemo(
    () => Object.fromEntries(Object.entries(priced).filter(([, v]) => v.mxn != null).map(([k, v]) => [k, /** @type {number} */ (v.mxn)])),
    [priced],
  )
  const plan = useMemo(
    () => (targetsOk && quotes.data ? wholeShareRebalance({ holdings, prices, targets, cash: cashMxn, allowSell: true }) : null),
    [targetsOk, quotes.data, holdings, prices, targets, cashMxn],
  )
  const totalValue = Object.entries(holdings).reduce((a, [s, q]) => a + (prices[s] ?? 0) * q, 0) + cashMxn

  if (!portfolio) {
    return (
      <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
        <PageHeader title="Rebalanceo" description="Qué tan lejos está tu portafolio de los pesos objetivo que definiste." />
        <EmptyState
          title="Todavía no tienes un portafolio"
          text="Crea uno en la bienvenida y aquí vas a poder definir tus metas."
          action={<Link className="kz-button" data-variant="primary" data-size="md" to={PATHS.onboarding}>Ir a la bienvenida</Link>}
        />
      </div>
    )
  }
  const portfolioId = portfolio.id

  /** @param {string} symbol @param {number | null} pct */
  function setTarget(symbol, pct) {
    editPortfolio(portfolioId, (p) => {
      const next = { ...p.targets }
      if (pct == null || pct <= 0) delete next[symbol]
      else next[symbol] = pct / 100
      return { ...p, targets: next }
    })
  }

  /** @param {import('react').FormEvent} event */
  function addSymbol(event) {
    event.preventDefault()
    const symbol = normalizeSymbol(draft.symbol)
    /** @type {{ symbol?: string, pct?: string }} */
    const errors = {}
    if (!symbol) errors.symbol = 'Esa clave no es válida. Usa la clave de pizarra, por ejemplo AMXB.MX o AAPL.'
    else if (symbols.includes(symbol)) errors.symbol = `${symbol} ya está en tus metas: cambia su meta en la tabla.`
    if (draft.pct == null || !(draft.pct > 0) || draft.pct > 100) errors.pct = 'La meta va de 0 a 100 %.'
    setDraftErrors(errors)
    if (errors.symbol || errors.pct || !symbol) return
    setTarget(symbol, draft.pct)
    setDraft({ symbol: '', pct: null })
    toast.show({ title: 'Emisora agregada a tus metas', description: `${symbol} con meta de ${fmtPct((draft.pct ?? 0) / 100)}`, tone: 'positive' })
  }

  function register() {
    setConfirming(false)
    if (!plan) return
    const date = todayMx()
    const txs = plan.trades.map((t) => {
      const q = priced[t.symbol]
      const usd = q?.currency === 'USD'
      return {
        id: newId('tx'), type: t.side === 'venta' ? 'sell' : 'buy', date, symbol: t.symbol, quantity: t.quantity,
        price: usd ? q.price : t.price, currency: usd ? 'USD' : 'MXN', fxRate: usd ? usdRate : null,
        fees: 0, amount: null, ratio: null, note: 'Rebalanceo',
      }
    })
    const ids = new Set(txs.map((t) => t.id))
    editPortfolio(portfolioId, (p) => ({ ...p, transactions: [...p.transactions, ...txs] }))
    toast.show({
      title: 'Movimientos registrados',
      description: `${fmtNumber(txs.length, { decimals: 0 })} movimientos del rebalanceo en tu libro`,
      tone: 'positive',
      action: {
        label: 'Deshacer',
        onClick: () => editPortfolio(portfolioId, (p) => ({ ...p, transactions: p.transactions.filter((/** @type {any} */ t) => !ids.has(t.id)) })),
      },
    })
  }

  const rows = symbols.map((symbol) => {
    const qty = holdings[symbol] ?? 0
    const mxn = prices[symbol] ?? null
    return { symbol, qty, mxn, weight: mxn != null && totalValue > 0 ? (qty * mxn) / totalValue : null, target: targets[symbol] ?? null }
  })

  const targetColumns = [
    { key: 'symbol', header: 'Clave', sortable: true },
    { key: 'qty', header: 'Títulos', numeric: true, format: (/** @type {any} */ v) => fmtNumber(v, { decimals: Number.isInteger(v) ? 0 : 4 }) },
    { key: 'mxn', header: 'Precio en pesos', numeric: true, format: (/** @type {any} */ v) => fmtMoney(v) },
    { key: 'weight', header: 'Peso actual', numeric: true, format: (/** @type {any} */ v) => fmtPct(v) },
    {
      key: 'target',
      header: 'Meta',
      align: /** @type {const} */ ('right'),
      minWidth: 140,
      format: (/** @type {any} */ v, /** @type {any} */ row) => (
        <NumberInput
          aria-label={`Meta de ${row.symbol} en porcentaje`}
          suffix="%"
          value={v == null ? null : Math.round(v * 10000) / 100}
          onChange={(n) => setTarget(row.symbol, n)}
          decimals={2}
          disabled={readOnly}
        />
      ),
    },
  ]

  const tradeColumns = [
    { key: 'symbol', header: 'Clave' },
    { key: 'side', header: 'Movimiento', format: (/** @type {string} */ v) => (v === 'venta' ? 'Reducir' : 'Aumentar') },
    { key: 'quantity', header: 'Títulos', numeric: true, format: (/** @type {any} */ v) => fmtNumber(v, { decimals: 0 }) },
    { key: 'price', header: 'Precio en pesos', numeric: true, format: (/** @type {any} */ v) => fmtMoney(v) },
    { key: 'amount', header: 'Monto', numeric: true, format: (/** @type {any} */ v) => fmtMoney(v) },
  ]

  const quotesStatus = quotes.data?.meta
  const missing = /** @type {string[]} */ (quotes.data?.missing ?? []).filter((m) => symbols.includes(m))
  return (
    <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
      <PageHeader
        title="Rebalanceo"
        eyebrow={portfolio.name}
        description="Define qué peso quieres para cada emisora y mira qué tan lejos estás. El plan es un cálculo, no una recomendación."
      />

      <Card
        title="Metas por emisora"
        padding="none"
        status={quotesStatus}
        description={`Suman ${fmtPct(targetSum)}. ${targetsOk ? 'Listo para calcular.' : 'Ajusta las metas hasta que sumen 100%.'}`}
      >
        {quotes.isError ? (
          <ErrorState message="No pudimos traer los precios para valuar tu portafolio." onRetry={() => quotes.refetch()} retrying={quotes.isFetching} />
        ) : (
          <DataTable
            caption="Metas y pesos actuales"
            captionHidden
            columns={targetColumns}
            rows={rows}
            rowKey="symbol"
            loading={quotes.isLoading}
            empty={{ title: 'Sin emisoras', text: 'Registra compras en Movimientos para poder definir metas.', action: <Link to={PATHS.portfolioTransactions}>Ir a Movimientos</Link> }}
          />
        )}
      </Card>
      <Card title="Agregar una emisora" titleAs="h2" description="Suma a tus metas una emisora que todavía no tienes. El plan la toma en cuenta en cuanto haya precio.">
        <form className="kz-portfolio-add" onSubmit={addSymbol} noValidate>
          <Input
            label="Clave de la emisora"
            value={draft.symbol}
            onChange={(e) => { setDraft((d) => ({ ...d, symbol: e.target.value.toUpperCase() })); setDraftErrors((x) => ({ ...x, symbol: undefined })) }}
            error={draftErrors.symbol}
            autoComplete="off"
            spellCheck={false}
            disabled={readOnly}
          />
          <NumberInput
            label="Meta"
            suffix="%"
            value={draft.pct}
            onChange={(n) => { setDraft((d) => ({ ...d, pct: n })); setDraftErrors((x) => ({ ...x, pct: undefined })) }}
            error={draftErrors.pct}
            decimals={2}
            disabled={readOnly}
          />
          <Button type="submit" variant="secondary" disabled={readOnly}>Agregar a las metas</Button>
        </form>
        {missing.length > 0 && (
          <p className="kz-portfolio-hint">
            {`Sin cotización para ${missing.join(', ')}: mientras no haya precio, su meta se reparte entre las demás.`}
          </p>
        )}
      </Card>

      {fx.data?.meta && (
        <div className="kz-row">
          <span>Tipo de cambio para valuar en pesos: {fmtNumber(usdRate, { decimals: 4 })}</span>
          <DataStatus {...fx.data.meta} />
        </div>
      )}

      {plan && (
        <Card
          title="Plan en títulos enteros"
          padding="none"
          actions={
            <Button onClick={() => setConfirming(true)} disabled={readOnly || plan.trades.length === 0}>
              Registrar en el libro
            </Button>
          }
        >
          <div className="kz-metric-grid kz-portfolio-stats">
            <Stat label="Distancia a tus metas hoy" value={fmtDistance(plan.deviation.before)} info={{ termKey: 'rebalanceo', term: 'Rebalanceo' }} />
            <Stat label="Distancia después del plan" value={fmtDistance(plan.deviation.after)} />
            <Stat label="Efectivo después" value={fmtMoney(plan.after.cash)} />
          </div>
          <DataTable
            caption="Movimientos del plan"
            captionHidden
            columns={tradeColumns}
            rows={plan.trades}
            rowKey="symbol"
            empty={{ title: 'Ya estás en tus metas', text: 'Con títulos enteros no hace falta ningún movimiento.' }}
          />
          {plan.notes.map((note) => (
            <p key={note} className="kz-portfolio-note">{note}</p>
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={confirming}
        title="¿Registrar el plan en tu libro?"
        message={plan ? `Se agregan ${fmtNumber(plan.trades.length, { decimals: 0 })} movimientos con fecha de hoy. Podrás deshacerlo unos segundos después.` : ''}
        confirmLabel="Registrar"
        onConfirm={register}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
