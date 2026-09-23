import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../../cn.js'

// Popover chico anclado a un botón. Interno del sistema (no sale en el barril):
// lo usan InfoTip y DataStatus.
//
// Va sobre la API nativa de popover, con el botón como invocador
// (popovertarget), por tres razones concretas:
//   1. Vive en la capa superior: no lo corta el overflow de una tarjeta ni el
//      contenedor con scroll de una tabla.
//   2. El navegador trae el cierre con Esc y con clic afuera, y como sabe quién
//      lo invocó, un clic en el mismo botón lo cierra en vez de cerrarlo y
//      volverlo a abrir.
//   3. Al cerrarse con el foco adentro, el foco regresa al botón.
// La posición sale de CSS anchor positioning (components.css). Donde el
// navegador no lo tiene, se calcula aquí con getBoundingClientRect.

const supportsAnchor = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('position-anchor: --a')

/** Coloca el popover debajo del botón (o arriba si no cabe), dentro de la ventana. */
function place(el, anchor) {
  const a = anchor.getBoundingClientRect()
  const p = el.getBoundingClientRect()
  const margin = 8
  const gap = 6
  const left = Math.max(margin, Math.min(a.left, window.innerWidth - p.width - margin))
  let top = a.bottom + gap
  if (top + p.height > window.innerHeight - margin) top = Math.max(margin, a.top - p.height - gap)
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

/**
 * @param {object} props
 * @param {(trigger: { popoverTarget: string, 'aria-expanded': boolean, 'aria-controls': string, style: object }) => import('react').ReactNode} props.trigger
 *   dibuja el botón y le pasa estas props
 * @param {string} props.label nombre accesible del popover
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function Popover({ trigger, label, onOpenChange, className, children }) {
  const raw = useId()
  const id = `kz-pop-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const anchorName = `--${id}`
  const [open, setOpen] = useState(false)
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const changeRef = useRef(onOpenChange)
  useEffect(() => {
    changeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const fallback = !supportsAnchor()
    /** @param {Event & { newState?: string }} event */
    const onBefore = (event) => {
      if (fallback && event.newState === 'open') el.style.visibility = 'hidden'
    }
    /** @param {Event & { newState?: string }} event */
    const onToggle = (event) => {
      const isOpen = event.newState === 'open'
      if (isOpen && fallback) {
        const anchor = document.querySelector(`[popovertarget="${id}"]`)
        if (anchor) place(el, anchor)
        el.style.visibility = ''
      }
      setOpen(isOpen)
      changeRef.current?.(isOpen)
    }
    el.addEventListener('beforetoggle', onBefore)
    el.addEventListener('toggle', onToggle)
    return () => {
      el.removeEventListener('beforetoggle', onBefore)
      el.removeEventListener('toggle', onToggle)
    }
  }, [id])

  // Sin anchor positioning, un scroll mueve el botón y no el popover: se cierra.
  useEffect(() => {
    if (!open || supportsAnchor()) return undefined
    const close = () => {
      try {
        ref.current?.hidePopover()
      } catch {
        /* ya estaba cerrado */
      }
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      {trigger({
        popoverTarget: id,
        'aria-expanded': open,
        'aria-controls': id,
        style: { anchorName },
      })}
      <div
        ref={ref}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        className={cn('kz-popover', className)}
        style={{ positionAnchor: anchorName }}
      >
        {children}
      </div>
    </>
  )
}
