// "Agregar a mi calendario": arma un .ics (RFC 5545) en el navegador con los eventos que se ven.
// Los eventos con hora usan su instante UTC (datetimeUtc), así el calendario de quien lo baja los
// pone a su hora local sin que la app adivine zonas; los que no traen hora van como día completo.
import { downloadBlob } from '../../../lib/csv.js'

const CRLF = '\r\n'

/** @param {string} text */
export function escapeText(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** "2026-11-05T19:00:00Z" a "20261105T190000Z". @param {string} iso */
export function icsInstant(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

/** "2026-11-05" a "20261105". @param {string} date */
function icsDate(date) {
  return date.replace(/-/g, '')
}

/** Día siguiente de una fecha YYYY-MM-DD, para el fin exclusivo de un evento de día completo. */
function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** RFC 5545 pide líneas de hasta 75 octetos; se doblan con un espacio al inicio. */
function fold(line) {
  if (line.length <= 74) return line
  const parts = []
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73))
  return parts.join(CRLF)
}

/**
 * @param {import('../types.js').EconomicEvent[]} events
 * @param {{ now?: Date }} [options]
 * @returns {string}
 */
export function buildIcs(events, { now = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kaizen//Calendario economico//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  const stamp = icsInstant(now.toISOString())
  for (const ev of events) {
    const title = ev.period ? `${ev.title} (${ev.period})` : ev.title
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@kaizen`, `DTSTAMP:${stamp}`)
    if (ev.datetimeUtc) {
      const start = new Date(ev.datetimeUtc)
      lines.push(`DTSTART:${icsInstant(ev.datetimeUtc)}`, `DTEND:${icsInstant(new Date(start.getTime() + 30 * 60000).toISOString())}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(ev.date))}`)
    }
    const origin = ev.country === 'MX' ? 'México' : 'Estados Unidos'
    lines.push(`SUMMARY:${escapeText(title)}`, `DESCRIPTION:${escapeText(`${origin}. Fuente: ${ev.source === 'bls' ? 'BLS' : 'calendario oficial'}.`)}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join(CRLF) + CRLF
}

/**
 * Baja el .ics con downloadBlob de src/lib/csv.js.
 * @param {import('../types.js').EconomicEvent[]} events
 * @param {string} filename
 */
export function downloadIcs(events, filename = 'calendario-economico.ics') {
  downloadBlob(filename, buildIcs(events), 'text/calendar;charset=utf-8')
}
