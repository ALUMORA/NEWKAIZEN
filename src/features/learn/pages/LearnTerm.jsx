// /aprender/:termino: la ficha completa de un concepto del glosario.
import { Link, useParams } from 'react-router'
import { Card, Disclaimer, EmptyState, PageHeader } from '../../../components/ui/index.js'
import { getTerm, relatedTerms } from '../../../content/glossary.js'
import { PATHS, pathLearnTerm } from '../../../app/paths.js'
import '../learn.css'

export default function LearnTerm() {
  const { termino = '' } = useParams()
  const term = getTerm(termino)
  const crumbs = [{ label: 'Aprender', to: PATHS.learn }]

  if (!term) {
    return (
      <div className="learn-page">
        <PageHeader title="Concepto no encontrado" breadcrumbs={[...crumbs, { label: 'No encontrado' }]} />
        <EmptyState
          title="No tenemos ese concepto en el glosario"
          text="Puede que el enlace tenga un error. En la lista completa están todos los conceptos."
          action={<Link className="learn-back" to={PATHS.learn}>Ver el glosario completo</Link>}
        />
      </div>
    )
  }

  const related = relatedTerms(term.slug)

  return (
    <div className="learn-page learn-term">
      <PageHeader eyebrow="Glosario" title={term.titulo} description={term.corto} breadcrumbs={[...crumbs, { label: term.titulo }]} />
      <div className="learn-prose">
        {term.largo.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <Card title="Fórmula">
        <pre className="learn-formula">{term.formula}</pre>
      </Card>
      <Card title="Para usarlo">
        <dl className="learn-dl">
          <div>
            <dt>Cómo leerlo</dt>
            <dd>{term.comoLeer}</dd>
          </div>
          <div>
            <dt>Ejemplo</dt>
            <dd>{term.ejemplo}</dd>
          </div>
          <div>
            <dt>Fuente</dt>
            <dd>{term.fuente}</dd>
          </div>
        </dl>
      </Card>
      {related.length > 0 && (
        <section aria-labelledby="learn-related" className="learn-group">
          <h2 id="learn-related">Conceptos relacionados</h2>
          <ul className="learn-related">
            {related.map((item) => (
              <li key={item.slug}>
                <Link to={pathLearnTerm(item.slug)}>{item.titulo}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p>
        <Link className="learn-back" to={PATHS.learn}>Volver al glosario completo</Link>
      </p>
      <Disclaimer />
    </div>
  )
}
