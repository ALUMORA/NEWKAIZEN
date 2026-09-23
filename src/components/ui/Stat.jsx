import { MISSING, fmtMoney, isNum } from '../../lib/format.js'
import { cn } from '../../cn.js'
import { DataStatus } from './DataStatus.jsx'
import { Skeleton } from './Feedback.jsx'
import { InfoTip } from './InfoTip.jsx'
import { describeDelta } from './delta.js'

/**
 * Cantidad de dinero. Todo pasa por fmtMoney: agrupación es-MX, símbolo, código
 * de moneda al final, menos tipográfico (U+2212) y "s/d" si falta.
 *
 * @param {object} props
 * @param {unknown} props.value
 * @param {string} [props.currency] código ISO; MXN por omisión
 * @param {boolean} [props.compact] "$1.2 M MXN"; el monto completo queda en el title
 * @param {number} [props.decimals]
 * @param {boolean} [props.sign] antepone "+" a los positivos
 * @param {string} [props.className]
 */
export function Money({ value, currency = 'MXN', compact = false, decimals, sign = false, className, ...rest }) {
  const text = fmtMoney(value, currency, { compact, decimals, sign })
  const full = compact && isNum(value) ? fmtMoney(value, currency, { decimals: 2, sign }) : undefined
  return (
    <span className={cn('num', text === MISSING && 'kz-missing', className)} title={full} {...rest}>
      {text}
    </span>
  )
}

/**
 * Variación con dirección. El color nunca va solo: el signo (+ o U+2212) va en
 * el texto y la flecha, opcional, es decorativa.
 *
 * `direction="neutral"` es para lo que sube o baja sin ser bueno ni malo, como
 * USD/MXN: va en --neutral-dir y se acompaña con `hint` ("peso más débil").
 *
 * @param {object} props
 * @param {unknown} props.value fracción para pct y pp, puntos base para bp, monto para money
 * @param {'pct'|'pp'|'bp'|'money'|'number'} [props.kind] pct por omisión
 * @param {'auto'|'neutral'} [props.direction]
 * @param {string} [props.currency] para kind="money"
 * @param {number} [props.decimals]
 * @param {boolean} [props.compact] para money y number
 * @param {boolean} [props.arrow] agrega ▲ o ▼ (aria-hidden)
 * @param {import('react').ReactNode} [props.hint] aclaración corta a un lado
 * @param {string} [props.className]
 */
export function Delta({ value, kind = 'pct', direction = 'auto', currency, decimals, compact, arrow = false, hint, className, ...rest }) {
  const { text, dir, missing } = describeDelta(value, { kind, currency, decimals, compact, direction })
  const up = text.startsWith('+')
  const showArrow = arrow && !missing && dir !== 'flat'
  return (
    <span className={cn('kz-delta', missing && 'kz-missing', className)} data-dir={dir} {...rest}>
      {showArrow && (
        <span className="kz-delta__arrow" aria-hidden="true">
          {up ? '▲' : '▼'}
        </span>
      )}
      <span className="num">{text}</span>
      {hint && <span className="kz-delta__hint">{hint}</span>}
    </span>
  )
}

/**
 * Cifra con su etiqueta. El valor llega ya formateado (un <Money>, un fmtPct):
 * la métrica no adivina qué es el número. Sin valor dice "s/d".
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.label
 * @param {import('react').ReactNode} [props.value]
 * @param {import('react').ReactNode} [props.delta] normalmente un <Delta>
 * @param {import('react').ReactNode} [props.sublabel]
 * @param {{ termKey?: string, term?: string, text?: import('react').ReactNode, label?: string, link?: boolean }} [props.info] props de InfoTip
 * @param {import('./status.js').DataStatusMeta} [props.status]
 * @param {boolean} [props.loading] esqueleto en lugar del valor
 * @param {'sm'|'md'|'lg'} [props.size]
 * @param {string} [props.className]
 */
export function Stat({ label, value, delta, sublabel, info, status, loading = false, size = 'md', className, ...rest }) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className={cn('kz-stat', className)} data-size={size} aria-busy={loading || undefined} {...rest}>
      <span className="kz-stat__label">
        {label}
        {info && <InfoTip {...info} />}
      </span>
      {loading ? (
        <span className="kz-stat__row">
          <Skeleton height={size === 'lg' ? 29 : size === 'sm' ? 19 : 24} width="72%" />
          <span className="sr-only">Cargando</span>
        </span>
      ) : (
        <span className="kz-stat__row">
          <span className={cn('kz-stat__value', empty && 'kz-missing')}>{empty ? MISSING : value}</span>
          {delta}
        </span>
      )}
      {(sublabel || status) && (
        <span className="kz-stat__sub">
          {sublabel && <span>{sublabel}</span>}
          {status && <DataStatus {...status} />}
        </span>
      )}
    </div>
  )
}
