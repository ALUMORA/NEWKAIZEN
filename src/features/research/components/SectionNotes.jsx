// Avisos del servidor (meta.notes) dentro de una sección de Investigar. Explican cifras que sin
// ellos parecen un error: el rendimiento pagado contra el que publica Yahoo, un recorte del P/VL
// justificado, una referencia sin dato. Nunca se esconden.

/** @param {{ notes?: string[] | null, label: string }} props */
export function SectionNotes({ notes, label }) {
  const list = (notes ?? []).filter((n) => typeof n === 'string' && n.trim())
  if (!list.length) return null
  return (
    <div role="note" aria-label={label} className="kz-research-notes">
      <ul>
        {list.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}
