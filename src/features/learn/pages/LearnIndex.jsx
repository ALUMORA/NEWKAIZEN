// /aprender: el glosario completo, con buscador y agrupado por letra inicial.
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Disclaimer, EmptyState, Input, PageHeader } from '../../../components/ui/index.js'
import { glossaryCount, glossarySearch, glossaryTerms } from '../../../content/glossary.js'
import { pathLearnTerm } from '../../../app/paths.js'
import { PublicPage } from '../PublicPage.jsx'
import '../learn.css'

function initial(titulo) {
  const letter = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase()
  return /[A-Z]/.test(letter) ? letter : '#'
}

function groupByLetter(terms) {
  /** @type {Map<string, typeof terms[number][]>} */
  const groups = new Map()
  for (const term of terms) {
    const key = initial(term.titulo)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(term)
  }
  return [...groups.entries()]
}

function TermList({ terms }) {
  return (
    <ul className="learn-list">
      {terms.map((term) => (
        <li key={term.slug} className="learn-item">
          <Link to={pathLearnTerm(term.slug)}>
            <strong>{term.titulo}</strong>
            <span>{term.corto}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function LearnIndex() {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const results = useMemo(() => (trimmed ? glossarySearch(trimmed, { limit: 200 }) : null), [trimmed])
  const groups = useMemo(() => groupByLetter(glossaryTerms), [])

  return (
    <PublicPage className="learn-page">
      <PageHeader
        eyebrow="Aprender"
        title="Glosario"
        description={`${glossaryCount} conceptos explicados en corto: qué mide cada número, cómo leerlo y de dónde sale.`}
      />
      <div className="learn-search">
        <Input
          type="search"
          label="Buscar un concepto"
          hint="Por nombre, sigla o palabra, por ejemplo Sharpe, CETES o volatilidad."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      {results ? (
        <section aria-labelledby="learn-results" className="learn-group">
          <h2 id="learn-results">Resultados</h2>
          <p className="learn-count" role="status">
            {results.length === 1 ? '1 concepto encontrado' : `${results.length} conceptos encontrados`}
          </p>
          {results.length ? (
            <TermList terms={results} />
          ) : (
            <EmptyState title="No encontramos ese concepto" text="Prueba con otra palabra o revisa la lista completa." size="sm" />
          )}
        </section>
      ) : (
        <>
          <nav aria-label="Letras del glosario">
            <ul className="learn-letters">
              {groups.map(([letter]) => (
                <li key={letter}>
                  <a href={`#letra-${letter}`}>{letter}</a>
                </li>
              ))}
            </ul>
          </nav>
          {groups.map(([letter, terms]) => (
            <section key={letter} id={`letra-${letter}`} aria-labelledby={`h-letra-${letter}`} className="learn-group">
              <h2 id={`h-letra-${letter}`}>{letter}</h2>
              <TermList terms={terms} />
            </section>
          ))}
        </>
      )}
      <Disclaimer />
    </PublicPage>
  )
}
