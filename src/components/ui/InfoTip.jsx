import { useState } from 'react'
import { Info } from 'lucide-react'
import { Link, useInRouterContext } from 'react-router'
import { pathLearnTerm } from '../../app/paths.js'
import { cn } from '../../cn.js'
import { loadTip } from '../../content/glossary-lazy.js'
import { Popover } from './Popover.jsx'

/** Cierra el popover que contiene al elemento (al seguir la liga). */
function closeOwner(event) {
  try {
    event.currentTarget.closest('[popover]')?.hidePopover()
  } catch {
    /* ya estaba cerrado */
  }
}

/**
 * Explicación corta de un término, con liga "Ver más" a /aprender/:termino.
 *
 * Se abre con clic, toque, Enter o Espacio, nunca solo con el cursor encima: en
 * una pantalla táctil no hay "encima", y en esta casa ningún dato vive
 * únicamente en un hover. Esc, el clic afuera o otro clic en el botón lo
 * cierran, y el foco regresa al botón.
 *
 * El texto sale de src/content/glossary.js a través de glossary-lazy.js: el
 * glosario pesa, así que se descarga la primera vez que alguien apunta, enfoca
 * o abre un InfoTip, no al pintar la página. Si la llave no existe se usa
 * `text`, y si tampoco hay text se dice que no hay definición.
 *
 * @param {object} props
 * @param {string} [props.termKey] slug del glosario, p. ej. 'sharpe' o 'p-u'
 * @param {string} [props.term] nombre visible del término; con termKey se recomienda
 *   pasarlo para que el botón tenga nombre desde el primer momento
 * @param {import('react').ReactNode} [props.text] respaldo cuando no hay entrada en el glosario
 * @param {string} [props.label] nombre accesible del botón; por omisión "Qué es <término>"
 * @param {boolean} [props.link] muestra "Ver más" hacia /aprender/:termino (con termKey); true por omisión
 * @param {string} [props.className]
 */
export function InfoTip({ termKey, term, text, label, link = true, className }) {
  const [tip, setTip] = useState(/** @type {{ slug: string, titulo: string, corto: string, href: string } | null | undefined} */ (undefined))
  const inRouter = useInRouterContext()

  function prefetch() {
    if (!termKey || tip !== undefined) return
    loadTip(termKey)
      .then((found) => setTip(found ?? null))
      .catch(() => setTip(null))
  }

  const title = term ?? tip?.titulo ?? termKey ?? 'Definición'
  const loading = Boolean(termKey) && tip === undefined
  const body = tip?.corto ?? text
  const href = tip?.href ?? (termKey ? pathLearnTerm(termKey) : null)
  const showLink = link && Boolean(termKey) && tip !== null && href

  return (
    <span className={cn('kz-infotip', className)}>
      <Popover
        label={title}
        onOpenChange={(open) => open && prefetch()}
        trigger={(t) => (
          <button
            {...t}
            type="button"
            className="kz-infotip__trigger"
            aria-label={label ?? `Qué es ${title}`}
            onPointerEnter={prefetch}
            onFocus={prefetch}
          >
            <Info size={15} aria-hidden="true" />
          </button>
        )}
      >
        <p className="kz-popover__title">{title}</p>
        <div className="kz-popover__body" aria-busy={loading || undefined}>
          {body ?? (loading ? 'Cargando la definición…' : 'Todavía no hay una definición para este término.')}
        </div>
        {showLink &&
          (inRouter ? (
            <Link className="kz-popover__more" to={href} onClick={closeOwner}>
              Ver más sobre {title}
            </Link>
          ) : (
            <a className="kz-popover__more" href={href} onClick={closeOwner}>
              Ver más sobre {title}
            </a>
          ))}
      </Popover>
    </span>
  )
}
