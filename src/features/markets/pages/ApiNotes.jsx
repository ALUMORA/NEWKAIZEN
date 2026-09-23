// Aviso visible con las notas del API y el respaldo, para que nunca queden escondidos.

/** Lista las notas del API (series sin verificar, respaldos) para que nunca queden escondidas. */
export function ApiNotes({ meta, label = 'Avisos de la fuente' }) {
  const notes = meta?.notes ?? []
  if (!notes.length && !meta?.fallback) return null
  return (
    <div className="markets-notes" role="note" aria-label={label}>
      <p className="markets-notes__title">{label}</p>
      <ul>
        {meta?.fallback ? <li>Este dato viene de una fuente de respaldo ({meta.source}), no de la fuente principal.</li> : null}
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}
