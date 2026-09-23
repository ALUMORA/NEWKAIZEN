import { createContext, useContext, useId } from 'react'
import { cn } from '../../cn.js'
import { Badge } from './Badge.jsx'

const TabsContext = createContext(/** @type {{ value: string, baseId: string } | null} */ (null))

/** ids derivados del mismo baseId: la pestaña y su panel se apuntan entre sí. */
const tabId = (baseId, id) => `${baseId}-tab-${id}`
const panelId = (baseId, id) => `${baseId}-panel-${id}`

/**
 * Pestañas con el patrón de APG: una sola parada de tabulador en la lista
 * (tabindex móvil), flechas izquierda y derecha para moverse (dan la vuelta),
 * Inicio y Fin para los extremos, y activación automática al llegar.
 *
 * Es controlado: `value` es la pestaña activa y `onChange` recibe el id nuevo.
 *
 * @param {object} props
 * @param {{ id: string, label: import('react').ReactNode, badge?: import('react').ReactNode, icon?: import('react').ReactNode, disabled?: boolean }[]} props.items
 * @param {string} props.value id de la pestaña activa
 * @param {(id: string) => void} props.onChange
 * @param {string} props.label nombre accesible de la lista ("Secciones de la emisora")
 * @param {string} [props.className]
 * @param {import('react').ReactNode} [props.children] los TabPanel
 */
export function Tabs({ items, value, onChange, label, className, children }) {
  const baseId = useId()
  const enabled = items.filter((item) => !item.disabled)
  // Si el valor no apunta a una pestaña usable, la primera habilitada recibe el
  // tabulador: la lista nunca se queda sin parada.
  const focusId = enabled.some((item) => item.id === value) ? value : enabled[0]?.id

  /** @param {import('react').KeyboardEvent<HTMLDivElement>} event */
  function onKeyDown(event) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key) || enabled.length === 0) return
    event.preventDefault()
    const current = enabled.findIndex((item) => item.id === focusId)
    let next = current
    if (event.key === 'ArrowRight') next = (current + 1) % enabled.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length
    else if (event.key === 'Home') next = 0
    else next = enabled.length - 1
    const target = enabled[next]
    onChange(target.id)
    document.getElementById(tabId(baseId, target.id))?.focus()
  }

  return (
    <TabsContext.Provider value={{ value, baseId }}>
      <div className={cn('kz-tabs', className)}>
        <div className="kz-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item) => {
            const selected = item.id === value
            return (
              <button
                key={item.id}
                type="button"
                id={tabId(baseId, item.id)}
                className="kz-tab"
                role="tab"
                aria-selected={selected}
                aria-controls={selected ? panelId(baseId, item.id) : undefined}
                tabIndex={item.id === focusId ? 0 : -1}
                disabled={item.disabled}
                onClick={() => onChange(item.id)}
              >
                {item.icon && (
                  <span className="kz-tab__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                {item.label}
                {item.badge != null && <Badge>{item.badge}</Badge>}
              </button>
            )
          })}
        </div>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

/**
 * Panel de una pestaña. Solo se dibuja el activo: el contenido escondido no se
 * queda en el orden de tabulación ni lo lee el lector de pantalla. Lleva
 * tabIndex=0 para que Tab desde la lista llegue al contenido aunque éste no
 * tenga nada enfocable.
 *
 * @param {object} props
 * @param {string} props.id el mismo id del item en Tabs
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function TabPanel({ id, className, children }) {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('TabPanel tiene que ir dentro de <Tabs>')
  if (ctx.value !== id) return null
  return (
    <div
      id={panelId(ctx.baseId, id)}
      className={cn('kz-tabs__panel', className)}
      role="tabpanel"
      aria-labelledby={tabId(ctx.baseId, id)}
      tabIndex={0}
    >
      {children}
    </div>
  )
}
