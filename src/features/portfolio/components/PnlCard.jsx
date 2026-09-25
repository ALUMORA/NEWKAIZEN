// Resultado no realizado de cada posición, partido en efecto precio y efecto tipo de cambio
// (positionPnl de src/lib/finance). Todo en pesos; precio y costo en la moneda de la emisora.
import { Card, DataTable, Delta, Stat } from '../../../components/ui/index.js'
import { fmtMoney, fmtNumber } from '../../../lib/format.js'

/** @param {any} v */
const fmtQty = (v) => fmtNumber(v, { decimals: Number.isInteger(v) ? 0 : 4 })
/** @param {any} v */
const fmtFx = (v) => (v == null ? '' : fmtNumber(v, { decimals: 4 }))
/** @param {any} v */
const signedMxn = (v) => <Delta value={v} kind="money" currency="MXN" />

const COLUMNS = [
  { key: 'symbol', header: 'Clave', sortable: true },
  { key: 'quantity', header: 'Títulos', numeric: true, format: fmtQty },
  { key: 'avgCost', header: 'Costo promedio', numeric: true, format: (/** @type {any} */ v, /** @type {any} */ r) => fmtMoney(v, r.currency), info: { termKey: 'costo-promedio', term: 'Costo promedio' } },
  { key: 'price', header: 'Precio al cierre', numeric: true, format: (/** @type {any} */ v, /** @type {any} */ r) => fmtMoney(v, r.currency) },
  { key: 'fx0', header: 'Tipo de cambio de compra', numeric: true, format: fmtFx },
  { key: 'fx1', header: 'Tipo de cambio al cierre', numeric: true, format: fmtFx },
  { key: 'priceEffect', header: 'Efecto precio', numeric: true, format: signedMxn, sortable: true },
  { key: 'fxEffect', header: 'Efecto tipo de cambio', numeric: true, format: signedMxn, sortable: true },
  { key: 'total', header: 'Total en pesos', numeric: true, format: signedMxn, sortable: true },
]

/**
 * @param {{ pnl: ReturnType<typeof import('../lib/performance-view.js').pnlByPosition> | null, loading: boolean, status?: any, footer?: import('react').ReactNode }} props
 */
export default function PnlCard({ pnl, loading, status, footer }) {
  return (
    <Card
      title="Resultado por posición: precio y tipo de cambio"
      info={{ termKey: 'efecto-precio-efecto-fx', term: 'Efecto precio y efecto tipo de cambio' }}
      padding="none"
      status={status}
      description="Cuánto de lo que ganas o pierdes hoy viene del precio de la emisora y cuánto del peso frente al dólar. Las dos partes suman el total."
      footer={footer}
    >
      <div className="kz-metric-grid kz-portfolio-stats">
        <Stat loading={loading} label="Efecto precio" value={pnl ? signedMxn(pnl.priceEffect) : undefined} />
        <Stat loading={loading} label="Efecto tipo de cambio" value={pnl ? signedMxn(pnl.fxEffect) : undefined} sublabel="Solo lo que registraste en dólares; lo del SIC comprado en pesos va todo en precio" />
        <Stat loading={loading} label="Resultado no realizado" value={pnl ? signedMxn(pnl.total) : undefined} sublabel="De las posiciones abiertas" />
      </div>
      <DataTable
        caption="Resultado por posición"
        captionHidden
        columns={COLUMNS}
        rows={pnl?.rows ?? []}
        rowKey="symbol"
        loading={loading}
        defaultSort={{ key: 'symbol', direction: 'ascending' }}
        empty={{ title: 'Sin posiciones abiertas', text: 'Cuando tengas posiciones, aquí ves de dónde sale su resultado.' }}
      />
      {pnl && pnl.incomplete > 0 && (
        <p className="kz-portfolio-note">
          {pnl.incomplete === 1
            ? '1 posición no se puede separar (sale s/d): le falta el tipo de cambio de compra o el precio. Si es en dólares, captura el tipo de cambio en su movimiento.'
            : `${fmtNumber(pnl.incomplete, { decimals: 0 })} posiciones no se pueden separar (salen s/d): les falta el tipo de cambio de compra o el precio. Si son en dólares, captura el tipo de cambio en sus movimientos.`}
        </p>
      )}
    </Card>
  )
}
