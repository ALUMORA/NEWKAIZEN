// Botón "Descargar" de datos públicos (fase 5). Provisional del orquestador: hoy no pinta nada, así
// que DataTable y ChartFrame se ven igual con la prop `download`. Lo hereda V5TM, que le pone el
// CSV UTF-8 con BOM y encabezado de procedencia (src/lib/download.js) y lo deshabilita con
// explicación cuando la fuente no permite descargar (por ejemplo, datos de Yahoo).
//
// Props que recibe: { filename: string, columns: { key: string, header: string }[], rows: any[],
//   meta?: { source?: string, asOf?: string | null, notes?: string[] } }

/** @returns {import('react').ReactNode} */
export function DownloadButton() {
  return null
}
