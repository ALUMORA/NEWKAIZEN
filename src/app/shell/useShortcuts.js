// Atajos globales de la paleta: ⌘K o Ctrl+K desde cualquier lado, y "/" cuando no se está
// escribiendo en un campo.
import { useEffect } from 'react'

/** @param {EventTarget | null} target */
function isTyping(target) {
  const el = /** @type {HTMLElement | null} */ (target instanceof HTMLElement ? target : null)
  if (!el) return false
  if (el.isContentEditable) return true
  return el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
}

/** @param {() => void} onOpen */
export function usePaletteShortcuts(onOpen) {
  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing) return
      const k = event.key.toLowerCase()
      if (k === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        onOpen()
        return
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
        event.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpen])
}
