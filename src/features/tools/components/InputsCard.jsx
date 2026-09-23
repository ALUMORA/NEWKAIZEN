// Insumos por emisora: beta contra el IPC (cruda y ajustada), rendimiento esperado con el método
// elegido y volatilidad anual. Así se ve de dónde sale cada cartera.
import { Card, DataTable, Stat } from '../../../components/ui/index.js'
import { MISSING, fmtDate, fmtNumber, fmtPct } from '../../../lib/format.js'
import { OPT_BENCHMARK } from '../optimizer.js'

const pct = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? MISSING : fmtPct(v, { decimals: 1 }))
const num = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? MISSING : fmtNumber(v, { decimals: 2 }))

/**
 * @param {{ assets: string[], betas: any[] | null, mu: number[] | null, vols: number[], muLabel: string,
 *   shrinkage: number | null, periods: number, start: string, end: string, status?: any }} props
 */
export function InputsCard({ assets, betas, mu, vols, muLabel, shrinkage, periods, start, end, status }) {
  const rows = assets.map((symbol, i) => ({
    symbol,
    beta: betas ? betas[i].raw : null,
    adjusted: betas ? betas[i].adjusted : null,
    mu: mu ? mu[i] : null,
    vol: vols[i],
  }))
  const columns = [
    { key: 'symbol', header: 'Emisora', format: (v) => <span className="mono">{v}</span> },
    { key: 'beta', header: 'Beta', numeric: true, sortable: true, format: num, info: { termKey: 'beta', term: 'Beta' } },
    { key: 'adjusted', header: 'Beta ajustada', numeric: true, sortable: true, format: num, info: { termKey: 'beta-ajustada', term: 'Beta ajustada' } },
    { key: 'mu', header: `Rendimiento esperado (${muLabel})`, numeric: true, sortable: true, format: pct },
    { key: 'vol', header: 'Volatilidad anual', numeric: true, sortable: true, format: pct },
  ]
  return (
    <Card
      title="De dónde salen los números"
      status={status}
      description={`Precios semanales en pesos del ${fmtDate(start)} al ${fmtDate(end)}. Betas contra el IPC (${OPT_BENCHMARK}) con rendimientos en exceso sobre CETES.`}
    >
      <div className="kz-tool__stats">
        <Stat size="sm" label="Semanas en común" value={fmtNumber(periods, { decimals: 0 })} />
        <Stat
          size="sm"
          label="Contracción de Ledoit y Wolf"
          value={shrinkage === null ? 'No aplica' : fmtPct(shrinkage, { decimals: 0 })}
          sublabel={shrinkage === null ? 'Estás usando la covarianza muestral.' : 'Qué tanto se acercó la covarianza a una correlación constante. Alto quiere decir pocos datos para tantas emisoras.'}
          info={{ termKey: 'ledoit-wolf', term: 'Ledoit y Wolf' }}
        />
      </div>
      <DataTable caption="Insumos por emisora" captionHidden columns={columns} rows={rows} rowKey="symbol" density="compact" />
    </Card>
  )
}
