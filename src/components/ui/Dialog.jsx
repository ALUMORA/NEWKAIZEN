import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../cn.js'
import { Button, IconButton } from './Button.jsx'

// Diálogos sobre <dialog> nativo con showModal(): el navegador pone el resto de
// la página inerte (ni clic ni lector de pantalla llegan atrás) y lo sube a la
// capa superior. Encima se agrega lo que el nativo no garantiza igual en todos
// los navegadores: el foco da la vuelta adentro con Tab y Shift+Tab, Esc llama
// a onClose (el padre decide), el scroll de atrás se congela y al cerrar el
// foco regresa a donde estaba.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary'

/** Elementos enfocables visibles dentro de un contenedor, en orden. */
function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && !el.closest('[popover]:not(:popover-open)') && el.getClientRects().length > 0,
  )
}

let locks = 0
function lockScroll() {
  locks += 1
  document.documentElement.classList.add('kz-scroll-lock')
}
function unlockScroll() {
  locks = Math.max(0, locks - 1)
  if (locks === 0) document.documentElement.classList.remove('kz-scroll-lock')
}

/**
 * Abre y cierra un <dialog> según `open`, con trampa de foco, Esc y regreso
 * del foco.
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {{ current: HTMLElement | null } | undefined} initialFocusRef
 */
function useModal(open, onClose, initialFocusRef) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null))
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return undefined
    const opener = /** @type {HTMLElement | null} */ (document.activeElement)
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    lockScroll()
    const target = /** @type {HTMLElement} */ (initialFocusRef?.current ?? dialog.querySelector('[data-autofocus]') ?? focusables(dialog)[0] ?? dialog)
    target.focus()

    /** @param {Event} event */
    const onCancel = (event) => {
      event.preventDefault()
      closeRef.current()
    }
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        // Algunos navegadores no mandan 'cancel' si ya se canceló una vez.
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables(dialog)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      dialog.removeEventListener('keydown', onKeyDown)
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close()
        else dialog.removeAttribute('open')
      }
      unlockScroll()
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus()
    }
  }, [open, initialFocusRef])

  return ref
}

/**
 * Ventana modal. Úsala cuando la tarea de verdad interrumpe (confirmar,
 * editar un movimiento); para información secundaria van mejor un InfoTip o
 * una sección que se expande.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose lo llaman Esc, el botón Cerrar y el clic en el fondo
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.description] primer párrafo; queda en aria-describedby
 * @param {import('react').ReactNode} [props.footer] botones de acción, alineados a la derecha
 * @param {'md'|'lg'} [props.size] md 520px, lg 760px
 * @param {boolean} [props.dismissible] false quita el cierre con clic en el fondo (Esc sigue)
 * @param {{ current: HTMLElement | null }} [props.initialFocusRef] a dónde va el foco al abrir
 * @param {string} [props.closeLabel] "Cerrar" por omisión
 * @param {string} [props.className]
 * @param {import('react').ReactNode} [props.children]
 */
export function Dialog({ open, onClose, title, description, footer, size = 'md', dismissible = true, initialFocusRef, closeLabel = 'Cerrar', className, children }) {
  const ref = useModal(open, onClose, initialFocusRef)
  const titleId = useId()
  const descId = useId()
  if (!open) return null
  return (
    <dialog
      ref={ref}
      className={cn('kz-dialog', className)}
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="kz-dialog__head">
        <h2 className="kz-dialog__title" id={titleId}>
          {title}
        </h2>
        <IconButton label={closeLabel} size="sm" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="kz-dialog__body">
        {description && (
          <p className="kz-dialog__description" id={descId}>
            {description}
          </p>
        )}
        {children}
      </div>
      {footer && <div className="kz-dialog__foot">{footer}</div>}
    </dialog>
  )
}

/**
 * Confirmación antes de algo que no se deshace fácil (borrar un portafolio).
 * Es alertdialog, no se cierra con clic en el fondo y, si es destructiva, el
 * foco empieza en Cancelar para que un Enter distraído no borre nada.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {import('react').ReactNode} props.title "¿Borrar el portafolio Retiro?"
 * @param {import('react').ReactNode} [props.message] qué pasa exactamente
 * @param {string} [props.confirmLabel] "Confirmar" por omisión; mejor un verbo concreto ("Borrar")
 * @param {string} [props.cancelLabel] "Cancelar" por omisión
 * @param {boolean} [props.destructive] botón en rojo y foco inicial en Cancelar
 * @param {boolean} [props.busy] pone el botón de confirmar en carga
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel también lo llama Esc
 */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', destructive = false, busy = false, onConfirm, onCancel }) {
  const cancelRef = useRef(/** @type {HTMLButtonElement | null} */ (null))
  const confirmRef = useRef(/** @type {HTMLButtonElement | null} */ (null))
  const ref = useModal(open, onCancel, destructive ? cancelRef : confirmRef)
  const titleId = useId()
  const descId = useId()
  if (!open) return null
  return (
    <dialog ref={ref} className="kz-dialog" data-size="sm" role="alertdialog" aria-labelledby={titleId} aria-describedby={message ? descId : undefined}>
      <div className="kz-dialog__head">
        <h2 className="kz-dialog__title" id={titleId}>
          {title}
        </h2>
      </div>
      {message && (
        <div className="kz-dialog__body">
          <p className="kz-dialog__description" id={descId}>
            {message}
          </p>
        </div>
      )}
      <div className="kz-dialog__foot">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button ref={confirmRef} variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}

/**
 * Hoja que sube desde abajo: el menú "Más" del celular, filtros, detalles.
 * En pantalla ancha se queda centrada abajo con 560px de ancho máximo.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose Esc, botón Cerrar y clic en el fondo
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.description]
 * @param {import('react').ReactNode} [props.footer]
 * @param {string} [props.closeLabel]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} [props.children]
 */
export function Sheet({ open, onClose, title, description, footer, closeLabel = 'Cerrar', className, children }) {
  const ref = useModal(open, onClose, undefined)
  const titleId = useId()
  const descId = useId()
  if (!open) return null
  return (
    <dialog
      ref={ref}
      className={cn('kz-sheet', className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <span className="kz-sheet__grip" aria-hidden="true" />
      <div className="kz-dialog__head">
        <h2 className="kz-dialog__title" id={titleId}>
          {title}
        </h2>
        <IconButton label={closeLabel} size="sm" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="kz-sheet__body">
        {description && (
          <p className="kz-dialog__description" id={descId}>
            {description}
          </p>
        )}
        {children}
      </div>
      {footer && <div className="kz-dialog__foot">{footer}</div>}
    </dialog>
  )
}
