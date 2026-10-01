// Aviso visible con las notas del API (meta.notes) y el respaldo (meta.fallback), para que nunca
// queden escondidos. Nació en Mercados (F2) y se mudó al sistema de diseño en la fase 5 para que
// lo usen todas las páginas; src/features/markets/pages/ApiNotes.jsx lo reexporta.

/**
 * @param {{ meta?: { notes?: string[], fallback?: boolean, source?: string } | null, label?: string }} props
 */
export function ApiNotes({ meta, label = 'Avisos de la fuente' }) {
  const notes = meta?.notes ?? []
  if (!notes.length && !meta?.fallback) return null
  return (
    <div className="kz-api-notes" role="note" aria-label={label}>
      <p className="kz-api-notes__title">{label}</p>
      <ul>
        {meta?.fallback ? <li>Este dato viene de una fuente de respaldo ({meta.source}), no de la fuente principal.</li> : null}
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}
