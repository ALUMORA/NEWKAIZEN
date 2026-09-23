// /aprender/metodologia/:guia: una guía de docs/metodologia, leída como texto.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../../../components/ui/index.js'
import { PATHS } from '../../../app/paths.js'
import { GUIDES, GUIDE_NAMES, titleOf } from '../guides.js'
import { Markdown } from '../markdown.jsx'
import { PublicPage } from '../PublicPage.jsx'
import '../learn.css'

export default function LearnGuide() {
  const { guia = '' } = useParams()
  const load = GUIDES[guia]
  const [state, setState] = useState(/** @type {{ key: string, text?: string, error?: boolean } | null} */ (null))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!load) return undefined
    let alive = true
    load()
      .then((text) => alive && setState({ key: `${guia}:${attempt}`, text: String(text) }))
      .catch(() => alive && setState({ key: `${guia}:${attempt}`, error: true }))
    return () => {
      alive = false
    }
  }, [load, guia, attempt])

  const crumbs = [{ label: 'Aprender', to: PATHS.learn }]
  const name = GUIDE_NAMES[guia] ?? 'Metodología'
  const current = state?.key === `${guia}:${attempt}` ? state : null

  if (!load) {
    return (
      <PublicPage className="learn-page">
        <PageHeader title="Guía no encontrada" breadcrumbs={[...crumbs, { label: 'No encontrada' }]} />
        <EmptyState title="No tenemos esa guía" text="Revisa la lista de guías en Aprender." action={<Link className="learn-back" to={PATHS.learn}>Ir a Aprender</Link>} />
      </PublicPage>
    )
  }

  return (
    <PublicPage className="learn-page">
      <PageHeader eyebrow="Metodología" title={current?.text ? titleOf(current.text) || name : name} breadcrumbs={[...crumbs, { label: name }]} />
      {!current && (
        <div aria-busy="true">
          <span className="sr-only" role="status">Cargando la guía</span>
          <Skeleton lines={8} />
        </div>
      )}
      {current?.error && <ErrorState message="No pudimos cargar esta guía." onRetry={() => setAttempt((a) => a + 1)} />}
      {current?.text && <Markdown source={current.text} />}
      <p>
        <Link className="learn-back" to={PATHS.learn}>Volver a Aprender</Link>
      </p>
    </PublicPage>
  )
}
