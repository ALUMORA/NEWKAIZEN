// "Qué mide cada factor": el glosario del screener en texto llano, con InfoTip y liga a la
// metodología completa. Los textos siguen a docs/metodologia/screener-de-factores.md.
import { Link } from 'react-router'
import { Card, InfoTip } from '../../../components/ui/index.js'
import { COMPOSITE_TEXT, COVERAGE_TEXT, FACTORS, Z_TEXT } from '../screener-model.js'

const METHODOLOGY = '/aprender/metodologia/screener-de-factores'

const ITEMS = [
  { id: 'z', label: 'Puntaje z relativo al sector', termKey: 'z-score-sectorial', text: Z_TEXT },
  ...FACTORS.map((f) => ({ id: f.key, label: f.label, termKey: 'termKey' in f ? f.termKey : undefined, text: f.text })),
  { id: 'composite', label: 'Compuesto', termKey: undefined, text: COMPOSITE_TEXT },
  { id: 'coverage', label: 'Cobertura', termKey: undefined, text: COVERAGE_TEXT },
]

/** @param {{ method?: string | null }} props */
export function FactorGuide({ method }) {
  return (
    <Card
      title="Qué mide cada factor"
      description="Un puntaje positivo quiere decir que la emisora sale arriba de la mediana de su sector en ese criterio; no dice si conviene tenerla."
    >
      <div className="kz-col" data-gap="4">
        <dl className="kz-screener-guide">
          {ITEMS.map((item) => (
            <div key={item.id}>
              <dt>
                {item.label}
                {item.termKey ? <InfoTip termKey={item.termKey} term={item.label} /> : null}
              </dt>
              <dd>{item.text}</dd>
            </div>
          ))}
        </dl>
        {method ? (
          <p className="kz-research-muted">
            <strong>Cómo lo calcula el servidor:</strong> {method}
          </p>
        ) : null}
        <p className="kz-research-muted">
          <Link className="kz-screener-more" to={METHODOLOGY}>
            Metodología completa del screener
          </Link>
          , con sus supuestos, límites y fuentes.
        </p>
      </div>
    </Card>
  )
}
