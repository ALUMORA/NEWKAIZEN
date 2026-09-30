// /mercados/noticias: solo titular, fuente, fecha y liga a la nota original. Sin resúmenes
// inventados ni etiquetas de ánimo.
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Card, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton } from '../../../components/ui/index.js'
import { newsQuery } from '../../../lib/api/queries.js'
import { MISSING, fmtDateTime } from '../../../lib/format.js'
import { ApiNotes } from './ApiNotes.jsx'
import '../markets.css'

const LANGS = [
  { value: 'all', label: 'Todas' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
]

/** Solo ligas http(s): una URL rara del proveedor no se vuelve un enlace. */
function safeUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

function Headline({ item }) {
  const href = safeUrl(item.url)
  return (
    <li>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {item.title}
          <span className="sr-only"> (abre en otra pestaña)</span>
        </a>
      ) : (
        <span>{item.title}</span>
      )}
      <p className="markets-news__meta">
        {item.source || 'Fuente sin nombre'} · {item.publishedAt ? fmtDateTime(item.publishedAt) : MISSING}
        {item.lang === 'en' ? ' · en inglés' : ''}
      </p>
    </li>
  )
}

/** Anchos del renglón de título del esqueleto, para que no parezca una sola barra repetida. */
const SKELETON_WIDTHS = ['92%', '78%', '86%', '70%', '95%', '82%', '74%', '88%']

/**
 * Esqueleto con el tamaño de ocho titulares reales (título y línea de fuente y fecha). El hueco de
 * la lista (.markets-news-slot) mide lo mismo aunque lleguen menos: así el pie no sube al llegar.
 */
function NewsSkeleton() {
  return (
    <>
      <span className="sr-only">Cargando titulares</span>
      <ul className="markets-news markets-news__skeleton" aria-hidden="true">
        {SKELETON_WIDTHS.map((w, i) => (
          <li key={i}>
            <Skeleton width={w} height={16} className="markets-news__sk-title" />
            <Skeleton width="55%" height={16} className="markets-news__sk-title markets-news__sk-title--wrap" />
            <Skeleton width="40%" height={12} className="markets-news__sk-meta" />
          </li>
        ))}
      </ul>
    </>
  )
}

export default function NewsPage() {
  const [lang, setLang] = useState('all')
  // Al cambiar de idioma se conserva la lista anterior (marcada como ocupada) hasta que llega la
  // nueva, en vez de volver al esqueleto y sacudir la página.
  const q = useQuery({ ...newsQuery({ lang, limit: 30 }), placeholderData: keepPreviousData })
  const items = q.data?.items ?? []
  const busy = q.isPending || q.isPlaceholderData
  return (
    <div className="markets-page kz-container">
      <PageHeader
        eyebrow="Mercados"
        title="Noticias"
        description="Titulares de mercados de México y Estados Unidos con enlace a la fuente original. Aquí no resumimos ni calificamos las notas."
        breadcrumbs={[{ label: 'Mercados', to: '/mercados' }, { label: 'Noticias' }]}
      />
      <Card
        title="Titulares"
        status={q.data?.meta}
        actions={<SegmentedControl label="Idioma" hideLabel items={LANGS} value={lang} onChange={setLang} name="idioma-noticias" />}
      >
        <div className="markets-news-slot" aria-busy={busy ? 'true' : undefined}>
          {q.isPending ? <NewsSkeleton /> : null}
          {q.isError ? <ErrorState message="No pudimos traer los titulares." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
          {q.data ? (
            items.length ? (
              <div className="kz-col">
                <ul className="markets-news">
                  {items.map((item) => (
                    <Headline key={item.id} item={item} />
                  ))}
                </ul>
                <ApiNotes meta={q.data.meta} label="Avisos de la fuente" />
              </div>
            ) : (
              <EmptyState title="Sin titulares por ahora" text={lang === 'all' ? 'Intenta más tarde.' : 'Prueba con otro idioma.'} />
            )
          ) : null}
        </div>
      </Card>
    </div>
  )
}
