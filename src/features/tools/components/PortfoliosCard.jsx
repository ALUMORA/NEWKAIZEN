// Las tres carteras del optimizador lado a lado: su rendimiento esperado, volatilidad y Sharpe, y
// los pesos por emisora. Si no hay máximo Sharpe se dice por qué, en vez de dejar un hueco.
import { Card, DataTable, InfoTip, Stat } from '../../../components/ui/index.js'
import { MISSING, fmtNumber, fmtPct } from '../../../lib/format.js'

const PORTFOLIOS = [
  { key: 'minVariance', label: 'Mínima varianza', termKey: 'minima-varianza', text: 'La que menos se mueve. No usa rendimientos esperados.' },
  { key: 'riskParity', label: 'Paridad de riesgo', termKey: 'paridad-de-riesgo', text: 'Cada emisora aporta la misma parte del riesgo.' },
  { key: 'maxSharpe', label: 'Máximo Sharpe', termKey: 'portafolio-tangente', text: 'La de mayor rendimiento esperado por unidad de riesgo.' },
]

const pct = (/** @type {number | null | undefined} */ v, decimals = 1) => (v === null || v === undefined ? MISSING : fmtPct(v, { decimals }))

/**
 * @param {{ assets: string[], solve: any, rfAnnual: number, status?: any, description?: import('react').ReactNode }} props
 */
export function PortfoliosCard({ assets, solve, rfAnnual, status, description }) {
  const hasCurrent = Boolean(solve.current)
  const rows = assets.map((symbol, i) => ({
    symbol,
    minVariance: solve.minVariance.weights[i],
    riskParity: solve.riskParity ? solve.riskParity.weights[i] : null,
    maxSharpe: solve.maxSharpe ? solve.maxSharpe.weights[i] : null,
    current: hasCurrent ? solve.current.weights[i] : null,
  }))
  const columns = [
    { key: 'symbol', header: 'Emisora', format: (v) => <span className="mono">{v}</span> },
    ...PORTFOLIOS.map((p) => ({ key: p.key, header: p.label, numeric: true, sortable: true, format: (v) => pct(v) })),
    ...(hasCurrent ? [{ key: 'current', header: 'Tu cartera hoy', numeric: true, sortable: true, format: (v) => pct(v) }] : []),
  ]
  const notConverged = PORTFOLIOS.filter((p) => solve[p.key] && solve[p.key].converged === false).map((p) => p.label)

  return (
    <Card title="Tres carteras con los mismos supuestos" description={description} status={status}>
      <div className="kz-tool__portfolios">
        {PORTFOLIOS.map((p) => {
          const r = solve[p.key]
          return (
            <section key={p.key} className="kz-tool__portfolio" aria-labelledby={`opt-p-${p.key}`}>
              <div className="kz-tool__portfolio-head">
                <h3 id={`opt-p-${p.key}`} className="kz-tool__portfolio-title">{p.label}</h3>
                <InfoTip termKey={p.termKey} term={p.label} />
              </div>
              <p className="kz-tool__hint">{p.text}</p>
              {r ? (
                <div className="kz-tool__portfolio-stats">
                  <Stat size="sm" label="Rendimiento esperado" value={pct(r.ret)} />
                  <Stat size="sm" label="Volatilidad" value={pct(r.vol)} info={{ termKey: 'volatilidad', term: 'Volatilidad' }} />
                  <Stat size="sm" label="Sharpe" value={r.sharpe === null ? MISSING : fmtNumber(r.sharpe, { decimals: 2 })} info={{ termKey: 'sharpe', term: 'Sharpe' }} />
                </div>
              ) : (
                <p className="kz-tool__notice" role="note">
                  {p.key === 'maxSharpe'
                    ? `Ninguna cartera permitida rinde más que la tasa libre de riesgo de ${fmtPct(rfAnnual)}, así que no hay cartera de máximo Sharpe. Con estos supuestos, la tasa sin riesgo rinde más que cualquier mezcla de estas emisoras.`
                    : 'Alguna emisora no tiene variación en el periodo, así que esta cartera no se puede calcular.'}
                </p>
              )}
            </section>
          )
        })}
      </div>
      {notConverged.length > 0 && (
        <p className="kz-tool__notice" role="note">
          {notConverged.join(' y ')}: el cálculo no convergió del todo, así que los pesos son aproximados.
        </p>
      )}
      <div className="kz-tool__stack">
        <DataTable
          caption="Pesos por cartera"
          columns={columns}
          rows={rows}
          rowKey="symbol"
          density="compact"
          empty={{ title: 'Sin emisoras' }}
        />
        {solve.riskParity && <p className="kz-tool__hint">La paridad de riesgo no usa la caja de pesos: su solución ya reparte el riesgo por igual.</p>}
      </div>
    </Card>
  )
}
