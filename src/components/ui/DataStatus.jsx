import { MISSING, fmtDateTime, fmtInt } from '../../lib/format.js'
import { describeStatus } from './status.js'
import { cn } from '../../cn.js'
import { Popover } from './Popover.jsx'

/** @typedef {import('./status.js').DataStatusMeta} DataStatusMeta */

/**
 * Insignia compacta con el estado del dato; al tocarla (o con Enter) abre el
 * detalle: fuente, fecha y hora, retraso y qué significa.
 *
 * @param {DataStatusMeta & { className?: string, now?: number }} props
 *   now solo para pruebas y galería (por omisión Date.now()).
 */
export function DataStatus({ asOf, source, delayMinutes, stale, fallback, className, now }) {
  const { tone, short, long } = describeStatus({ asOf, source, delayMinutes, stale, fallback }, now)
  const when = asOf ? fmtDateTime(asOf) : MISSING
  return (
    <Popover
      label="Estado del dato"
      trigger={(t) => (
        <button {...t} type="button" className={cn('kz-status', className)} data-tone={tone}>
          <span className="kz-status__dot" aria-hidden="true" />
          {short}
          <span className="sr-only">. Ver fuente y fecha del dato</span>
        </button>
      )}
    >
      <p className="kz-popover__title">Estado del dato</p>
      <div className="kz-popover__body">
        <dl className="kz-status__facts">
          <dt>Fuente</dt>
          <dd>{source ?? MISSING}</dd>
          <dt>Actualizado</dt>
          <dd className="num">{when}</dd>
          <dt>Retraso</dt>
          <dd className="num">{typeof delayMinutes === 'number' ? `${fmtInt(delayMinutes)} min` : MISSING}</dd>
          {(fallback || stale) && (
            <>
              <dt>Aviso</dt>
              <dd>{[fallback && 'fuente de respaldo', stale && 'dato viejo'].filter(Boolean).join(', ')}</dd>
            </>
          )}
        </dl>
        <p className="kz-status__note">{long}</p>
      </div>
    </Popover>
  )
}
