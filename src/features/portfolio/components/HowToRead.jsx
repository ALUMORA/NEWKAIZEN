// Explicación de TWR y XIRR y los límites que aplican a ESTE libro. Dice lo mismo que
// docs/metodologia/portafolio.md, en corto, y liga a la guía completa.
import { Link } from 'react-router'
import { Card } from '../../../components/ui/index.js'
import { fmtNumber } from '../../../lib/format.js'

/**
 * @param {{ transactions: any[], perf: any }} props
 */
export default function HowToRead({ transactions, perf }) {
  const undated = transactions.filter((t) => t.date == null && (t.type === 'buy' || t.type === 'deposit')).length
  const dividends = transactions.filter((t) => t.type === 'dividend').length
  /** @type {string[]} */
  const caveats = []
  if (undated > 0) {
    caveats.push('Tienes saldos migrados sin fecha de compra: el rendimiento se mide desde el primer cierre del periodo, como si ese día los hubieras aportado.')
  }
  if (dividends > 0) {
    caveats.push(
      `Registraste ${fmtNumber(dividends, { decimals: 0 })} ${dividends === 1 ? 'dividendo' : 'dividendos'}. Los cierres históricos ya vienen ajustados por dividendos, así que el TWR y el XIRR pueden salir algo más altos de lo real, a lo mucho por lo que suman esos dividendos.`,
    )
  }
  if (perf?.xirrAmbiguous) {
    caveats.push('Tus flujos alternan aportaciones y retiros, y en ese caso el XIRR puede tener más de una solución. Tómalo como aproximado.')
  }
  if (perf?.unconverted > 0) {
    caveats.push(`${fmtNumber(perf.unconverted, { decimals: 0 })} flujos en dólares no tienen tipo de cambio y no entran al XIRR.`)
  }
  return (
    <Card title="Cómo leer estos números">
      <div className="kz-col kz-portfolio-prose" data-gap="3">
        <p>
          <strong>TWR</strong> parte el periodo en tramos entre cierres y los encadena. No le importa cuándo metiste o sacaste dinero, por eso es el que se
          compara contra la referencia.
        </p>
        <p>
          <strong>XIRR</strong> es la tasa anual que hace cuadrar tus aportaciones y retiros, con sus fechas, contra el valor de hoy. Si sale mucho más bajo
          que el TWR, tus aportaciones llegaron en malos momentos; si sale más alto, en buenos. Ninguno es el correcto: contestan preguntas distintas.
        </p>
        <p>
          Con cierres semanales, un depósito a media semana se cuenta al cierre de esa semana. Los precios son de cierre y con retraso, no una valuación en
          vivo.
        </p>
        {caveats.length > 0 && (
          <ul className="kz-portfolio-list" aria-label="Límites que aplican a tu portafolio">
            {caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        <p>
          <Link to="/aprender/metodologia/portafolio">Metodología completa del portafolio</Link>
        </p>
      </div>
    </Card>
  )
}
