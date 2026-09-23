import { useEffect, useRef } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

const ICONS = { positive: CircleCheck, negative: CircleAlert, info: Info, neutral: Info }

/**
 * Un aviso. Se va solo después de `duration` ms, salvo mientras el cursor o el
 * foco están encima (así da tiempo de leerlo o de llegar a "Deshacer").
 * @param {{ toast: { id: string, title: import('react').ReactNode, description?: import('react').ReactNode,
 *   tone: string, action?: { label: string, onClick: () => void }, duration: number }, onDismiss: (id: string) => void }} props
 */
function ToastItem({ toast, onDismiss }) {
  const { id, title, description, tone, action, duration } = toast
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  const remaining = useRef(duration)
  const started = useRef(0)

  useEffect(() => {
    const start = () => {
      started.current = Date.now()
      timer.current = setTimeout(() => onDismiss(id), remaining.current)
    }
    start()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [id, onDismiss])

  const pause = () => {
    if (!timer.current) return
    clearTimeout(timer.current)
    timer.current = null
    remaining.current = Math.max(1500, remaining.current - (Date.now() - started.current))
  }
  const resume = (event) => {
    if (timer.current) return
    if (event?.currentTarget?.contains(event.relatedTarget)) return
    started.current = Date.now()
    timer.current = setTimeout(() => onDismiss(id), remaining.current)
  }

  const Icon = ICONS[tone] ?? Info
  return (
    <li className="kz-toast" data-tone={tone} onPointerEnter={pause} onPointerLeave={resume} onFocus={pause} onBlur={resume}>
      <Icon className="kz-toast__icon" size={18} aria-hidden="true" />
      <div className="kz-toast__content">
        <p className="kz-toast__title">{title}</p>
        {description && <p className="kz-toast__description">{description}</p>}
      </div>
      <div className="kz-toast__side">
        {action && (
          <button
            type="button"
            className="kz-toast__action"
            onClick={() => {
              action.onClick()
              onDismiss(id)
            }}
          >
            {action.label}
          </button>
        )}
        <button type="button" className="kz-toast__close" aria-label="Cerrar aviso" onClick={() => onDismiss(id)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

/**
 * Región de avisos. Siempre está en el DOM (vacía) para que el lector de
 * pantalla ya la conozca cuando llegue el primer aviso: una región viva que
 * aparece junto con su contenido muchas veces no se anuncia.
 * @param {{ toasts: any[], onDismiss: (id: string) => void }} props
 */
export function Toaster({ toasts, onDismiss }) {
  return (
    <section className="kz-toaster" aria-label="Avisos">
      <ol className="kz-toaster__list" aria-live="polite" aria-relevant="additions text">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </ol>
    </section>
  )
}
