// De dónde sale cada dato de una sección: una línea por fuente con su DataStatus, más los avisos
// que manda el API en meta.notes. Nada de esto se esconde, tampoco un respaldo o un dato viejo.
import { DataStatus } from '../../../components/ui/index.js'

/**
 * @param {{ items: { label: string, meta: any }[], className?: string }} props
 */
export default function DataSources({ items, className }) {
  const shown = items.filter((i) => i.meta)
  if (shown.length === 0) return null
  const notes = [...new Set(shown.flatMap((i) => (Array.isArray(i.meta.notes) ? i.meta.notes : [])))]
  return (
    <div className={['kz-portfolio-sources', className].filter(Boolean).join(' ')}>
      <ul className="kz-portfolio-sources__list" aria-label="Fuentes de los datos">
        {shown.map((i) => (
          <li key={i.label} className="kz-row">
            <span>{i.label}</span>
            <DataStatus {...i.meta} />
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <ul className="kz-portfolio-list kz-portfolio-hint" aria-label="Avisos de los datos">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
