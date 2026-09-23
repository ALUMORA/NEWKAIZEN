// /portafolio/movimientos: el libro del portafolio activo (storage v2). Alta con Dialog, borrado
// con ConfirmDialog y Deshacer en un aviso. Las posiciones salen del ledger de src/lib/finance,
// que integra compras repetidas a costo promedio.
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, PageHeader, useToast } from '../../../components/ui/index.js'
import { derivePositions } from '../../../lib/finance/index.js'
import { fmtDate, fmtMoney, fmtNumber } from '../../../lib/format.js'
import { getStorageError, isReadOnly, update, useStore } from '../../../lib/storage.js'
import { PATHS } from '../../../app/paths.js'
import TransactionDialog from '../TransactionDialog.jsx'
import { findOversells } from '../lib/oversells.js'
import '../portfolio.css'
import { TX_LABELS } from '../tx-labels.js'

/** @param {any} s */
const selectActive = (s) => s.portfolios.find((/** @type {any} */ p) => p.id === s.activePortfolioId) ?? null

/**
 * @param {string} portfolioId
 * @param {(txs: any[]) => any[]} fn
 */
function editTransactions(portfolioId, fn) {
  update((s) => ({
    ...s,
    portfolios: s.portfolios.map((p) => (p.id === portfolioId ? { ...p, transactions: fn(p.transactions) } : p)),
  }))
}

/** Títulos: enteros sin decimales, fracciones con hasta 4. @param {any} v */
const fmtQty = (v) => fmtNumber(v, { decimals: Number.isInteger(v) ? 0 : 4 })

/** @param {any} tx */
function describeTx(tx) {
  return [TX_LABELS[tx.type] ?? tx.type, tx.symbol, tx.date ? fmtDate(tx.date) : null].filter(Boolean).join(' ')
}

export default function Transactions() {
  const portfolio = useStore(selectActive)
  const storageError = useStore(() => getStorageError())
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const [pending, setPending] = useState(/** @type {any} */ (null))
  const readOnly = isReadOnly()

  const transactions = useMemo(() => portfolio?.transactions ?? [], [portfolio])
  const positions = useMemo(() => derivePositions(transactions), [transactions])
  const oversells = useMemo(() => findOversells(transactions), [transactions])
  const oversold = useMemo(() => new Set(oversells.map((o) => o.id)), [oversells])

  if (!portfolio) {
    return (
      <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
        <PageHeader title="Movimientos" description="Compras, ventas, dividendos, depósitos y retiros de tu portafolio." />
        <EmptyState
          title="Todavía no tienes un portafolio"
          text="Crea uno en la bienvenida y aquí vas a poder registrar tus movimientos."
          action={<Link className="kz-button" data-variant="primary" data-size="md" to={PATHS.onboarding}>Ir a la bienvenida</Link>}
        />
      </div>
    )
  }

  function openAdd() {
    setDialogKey((k) => k + 1)
    setAdding(true)
  }

  /** @param {any} tx */
  function handleSave(tx) {
    editTransactions(portfolio.id, (txs) => [...txs, tx])
    setAdding(false)
    toast.show({ title: 'Movimiento guardado', description: describeTx(tx), tone: 'positive' })
  }

  function confirmDelete() {
    const tx = pending
    setPending(null)
    if (!tx) return
    const index = transactions.findIndex((t) => t.id === tx.id)
    const portfolioId = portfolio.id
    editTransactions(portfolioId, (txs) => txs.filter((t) => t.id !== tx.id))
    toast.show({
      title: 'Movimiento borrado',
      description: describeTx(tx),
      action: {
        label: 'Deshacer',
        onClick: () =>
          editTransactions(portfolioId, (txs) => {
            if (txs.some((t) => t.id === tx.id)) return txs
            const next = [...txs]
            next.splice(Math.max(0, Math.min(index, next.length)), 0, tx)
            return next
          }),
      },
    })
  }

  /** @param {number | null} v @param {any} row */
  const money = (v, row) => fmtMoney(v, row.currency)

  const txColumns = [
    { key: 'date', header: 'Fecha', format: (/** @type {any} */ v) => fmtDate(v), sortable: true, minWidth: 110 },
    {
      key: 'type',
      header: 'Tipo',
      sortable: true,
      format: (/** @type {string} */ v, /** @type {any} */ row) =>
        oversold.has(row.id) ? (
          <span className="kz-portfolio-type">
            {TX_LABELS[v] ?? v} <Badge tone="warning">Recortada</Badge>
          </span>
        ) : (
          (TX_LABELS[v] ?? v)
        ),
    },
    { key: 'symbol', header: 'Clave', format: (/** @type {any} */ v) => v ?? '', sortable: true },
    { key: 'quantity', header: 'Títulos', numeric: true, format: fmtQty },
    { key: 'price', header: 'Precio', numeric: true, format: money },
    { key: 'amount', header: 'Monto', numeric: true, format: money },
    { key: 'fees', header: 'Comisión', numeric: true, format: (/** @type {any} */ v, /** @type {any} */ row) => (row.type === 'buy' || row.type === 'sell' ? money(v, row) : '') },
    { key: 'currency', header: 'Moneda' },
    { key: 'fxRate', header: 'Tipo de cambio', numeric: true, format: (/** @type {any} */ v) => fmtNumber(v, { decimals: 4 }) },
    {
      key: 'actions',
      header: 'Acciones',
      align: /** @type {const} */ ('right'),
      format: (/** @type {any} */ _v, /** @type {any} */ row) => (
        <Button size="sm" variant="ghost" disabled={readOnly} aria-label={`Borrar ${describeTx(row)}`} onClick={() => setPending(row)}>
          Borrar
        </Button>
      ),
    },
  ]

  const posColumns = [
    { key: 'symbol', header: 'Clave', sortable: true },
    { key: 'quantity', header: 'Títulos', numeric: true, format: fmtQty },
    {
      key: 'avgCost',
      header: 'Costo promedio',
      numeric: true,
      format: money,
      info: { termKey: 'costo-promedio', term: 'Costo promedio' },
    },
    { key: 'costBasis', header: 'Costo total', numeric: true, format: money },
    { key: 'currency', header: 'Moneda' },
  ]

  return (
    <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
      <PageHeader
        title="Movimientos"
        eyebrow={portfolio.name}
        description="Compras, ventas, dividendos, depósitos y retiros de tu portafolio. Se guardan solo en este navegador."
        actions={
          <Button onClick={() => openAdd()} disabled={readOnly}>
            Agregar movimiento
          </Button>
        }
      />

      {storageError && <ErrorState title="Aviso sobre tus datos" message={storageError.message} size="sm" headingAs="p" />}

      {oversells.length > 0 && (
        <Card
          title="Ventas por más títulos de los que tenías"
          actions={<Badge tone="warning">Revisa</Badge>}
          description="El libro solo cuenta lo que había a esa fecha, así que tus posiciones y tu resultado usan la cantidad recortada. Corrige la venta o agrega la compra que falta."
        >
          <ul className="kz-portfolio-list">
            {oversells.map((o) => (
              <li key={o.id}>
                {`Venta de ${fmtQty(o.asked)} ${o.symbol}${o.date ? ` el ${fmtDate(o.date)}` : ' sin fecha'}: `}
                {o.held > 0 ? `tenías ${fmtQty(o.held)}, así que solo cuentan ${fmtQty(o.held)}.` : 'no tenías títulos, así que no cuenta.'}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Libro de movimientos" padding="none" description={`${fmtNumber(transactions.length, { decimals: 0 })} movimientos registrados`}>
        <DataTable
          caption="Movimientos del portafolio"
          captionHidden
          columns={txColumns}
          rows={transactions}
          rowKey="id"
          defaultSort={{ key: 'date', direction: 'descending' }}
          empty={{
            title: 'Aún no hay movimientos',
            text: 'Agrega tu primera compra o depósito para empezar a ver tus posiciones.',
            action: !readOnly && <Button onClick={() => openAdd()}>Agregar movimiento</Button>,
          }}
        />
      </Card>

      <Card
        title="Posiciones que resultan"
        padding="none"
        description="Si compraste la misma emisora varias veces, se integra a costo promedio."
      >
        <DataTable
          caption="Posiciones abiertas según el libro"
          captionHidden
          columns={posColumns}
          rows={positions}
          rowKey={(/** @type {any} */ r) => `${r.symbol}-${r.currency}`}
          defaultSort={{ key: 'symbol', direction: 'ascending' }}
          empty={{ title: 'Sin posiciones abiertas', text: 'Cuando registres una compra, aquí aparece la posición.' }}
        />
      </Card>

      <TransactionDialog key={dialogKey} open={adding} onClose={() => setAdding(false)} onSave={handleSave} />
      <ConfirmDialog
        open={pending != null}
        title="¿Borrar este movimiento?"
        message={pending ? `${describeTx(pending)}. Podrás deshacerlo unos segundos después.` : ''}
        confirmLabel="Borrar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
