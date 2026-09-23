// Lógica de DataStatus sin React: qué dice la insignia según el meta v2.
import { MISSING, fmtDate, fmtDateTime, fmtInt } from '../../lib/format.js'

/**
 * De dónde viene el dato y qué tan fresco está. Sostiene la promesa de ser
 * honestos con la procedencia: un dato de respaldo o viejo jamás se dibuja como
 * si fuera el bueno y al día, ni en la versión compacta.
 *
 * Toma el bloque `meta` de cualquier respuesta v2 tal cual viene.
 *
 * @typedef {object} DataStatusMeta
 * @property {string} [asOf] instante ISO (o fecha YYYY-MM-DD) del dato
 * @property {string} [source] proveedor ("Yahoo Finance", "Banxico", "FRED"...)
 * @property {number} [delayMinutes] minutos de retraso declarados
 * @property {boolean} [stale] el proveedor no contestó y se sirve lo último bueno
 * @property {boolean} [fallback] viene de una fuente sustituta, no de la principal
 */

/**
 * Cuándo, corto a propósito porque vive en una insignia: la hora si es de hoy
 * (en la Ciudad de México), "19 sep" si es de este año y "19 sep 2025" si no.
 * @returns {{ time: boolean, text: string } | null}
 */
function shortWhen(asOf, now) {
  const date = fmtDate(asOf)
  if (date === MISSING) return null
  const today = fmtDate(now)
  if (date === today && String(asOf).includes('T')) return { time: true, text: fmtDateTime(asOf).split(', ')[1] }
  const year = today.split(' ')[2]
  return { time: false, text: date.endsWith(` ${year}`) ? date.slice(0, -year.length - 1) : date }
}

/**
 * Texto de la insignia, tono y explicación larga. Exportado para las pruebas.
 * @param {DataStatusMeta} meta
 * @param {number} [now]
 */
export function describeStatus({ asOf, source, delayMinutes, stale, fallback }, now = Date.now()) {
  const when = asOf ? shortWhen(asOf, now) : null
  const parts = []
  const notes = []
  let tone = 'live'
  if (fallback) {
    tone = 'stale'
    parts.push(source ? `Respaldo: ${source}` : 'Dato de respaldo')
    notes.push(
      source
        ? `Viene de ${source}, que es la fuente sustituta: la fuente principal no respondió.`
        : 'Viene de una fuente sustituta: la fuente principal no respondió.',
    )
  }
  if (stale) {
    tone = 'stale'
    parts.push(when ? (when.time ? `Dato de las ${when.text}` : `Dato del ${when.text}`) : 'Dato viejo')
    notes.push('No hay dato nuevo: se muestra el último bueno que se tenía.')
  }
  if (!fallback && !stale) {
    if (typeof delayMinutes === 'number' && delayMinutes > 0) {
      tone = 'delayed'
      parts.push(`Retraso ${fmtInt(delayMinutes)} min`)
      notes.push(`La fuente publica con ${fmtInt(delayMinutes)} minutos de retraso: no es precio en tiempo real.`)
    } else if (when) {
      parts.push(when.time ? `A las ${when.text}` : `Al ${when.text}`)
      notes.push('Es el dato más reciente que publica la fuente.')
    } else {
      tone = 'unknown'
      parts.push('Sin fecha')
      notes.push('La fuente no dijo de cuándo es este dato.')
    }
  }
  return { tone, short: parts.join(' · '), long: notes.join(' ') }
}

