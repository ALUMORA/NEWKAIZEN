// ISR estimado por ventas en pesos (LISR art. 129) con isrOnGains. Es una estimación y así se
// dice arriba, no solo en la letra chica.
import { Card, DataTable, Stat } from '../../../components/ui/index.js'
import { fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'
import { DIVIDEND_WITHHOLDING_RATE } from '../../../lib/finance/tax-mx.js'

/** @param {any} v */
const money = (v) => fmtMoney(v)

const COLUMNS = [
  { key: 'year', header: 'Ejercicio' },
  { key: 'gain', header: 'Ganancia neta', numeric: true, format: money },
  { key: 'lossUsed', header: 'Pérdida que se aplica', numeric: true, format: money },
  { key: 'taxableGain', header: 'Base', numeric: true, format: money },
  { key: 'tax', header: 'ISR estimado', numeric: true, format: money },
  { key: 'lossCarry', header: 'Pérdida pendiente', numeric: true, format: money },
]

/**
 * @param {{ isr: ReturnType<typeof import('../lib/performance-view.js').isrView> }} props
 */
export default function IsrCard({ isr }) {
  const est = isr.estimate
  // Sin serie de INPC la regla general "el costo se actualiza con el INPC" no aplica aquí: se
  // cambia por la explicación de por qué va sin actualizar.
  const notes = (est?.notes ?? []).filter((n) => !n.startsWith('El costo se actualiza con el INPC'))
  notes.push('Todavía no tenemos la serie mensual del INPC, así que el costo va sin actualizar y la ganancia estimada puede salir más alta que la real.')
  if (isr.usdSales > 0) {
    notes.push(`${fmtNumber(isr.usdSales, { decimals: 0 })} ventas en dólares no entran: si las hiciste con una casa de bolsa del extranjero, se declaran distinto.`)
  }
  if (isr.trimmed > 0) {
    notes.push(`${fmtNumber(isr.trimmed, { decimals: 0 })} ventas pedían más títulos de los que había y aquí cuentan solo hasta lo que había. Revísalas en Movimientos.`)
  }
  return (
    <Card
      title="ISR estimado por tus ventas"
      info={{ termKey: 'isr-ganancia-de-capital', term: 'ISR por ganancia de capital' }}
      padding="none"
      description="Estimación del 10 % sobre la ganancia neta anual por vender acciones en la BMV o en el SIC. Sale de tus ventas registradas en pesos."
    >
      <div className="kz-metric-grid kz-portfolio-stats">
        <Stat label="ISR estimado, todos los ejercicios" value={est ? fmtMoney(est.tax) : undefined} />
        <Stat label="Ganancia neta por ventas" value={est ? fmtMoney(est.gain) : undefined} />
        <Stat label="Pérdida pendiente de aplicar" value={est ? fmtMoney(est.lossCarry) : undefined} />
        {isr.dividendsMxn > 0 && (
          <Stat
            label="Retención informativa por dividendos"
            value={fmtMoney(isr.dividendsMxn * DIVIDEND_WITHHOLDING_RATE)}
            sublabel={`${fmtPct(DIVIDEND_WITHHOLDING_RATE, { decimals: 0 })} de ${fmtMoney(isr.dividendsMxn)} en dividendos en pesos`}
            info={{ termKey: 'retencion-por-dividendos', term: 'Retención por dividendos' }}
          />
        )}
      </div>
      <DataTable
        caption="ISR estimado por ejercicio"
        captionHidden
        columns={COLUMNS}
        rows={est?.years ?? []}
        rowKey="year"
        empty={{ title: 'Sin ventas registradas', text: 'Cuando registres una venta en pesos, aquí aparece la estimación de su ejercicio.' }}
      />
      <ul className="kz-portfolio-list kz-portfolio-hint kz-portfolio-notes" aria-label="Cómo se estimó">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Card>
  )
}
