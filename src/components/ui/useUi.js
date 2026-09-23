// Hooks de UiProvider: tema, avisos (toasts) y confirmaciones.
//
//   const toast = useToast()
//   toast.show({ title: 'Movimiento borrado', tone: 'neutral', action: { label: 'Deshacer', onClick: undo } })
//
//   const confirm = useConfirm()
//   if (await confirm({ title: '¿Borrar el portafolio Retiro?', confirmLabel: 'Borrar', destructive: true })) ...
import { useContext } from 'react'
import { UiContext } from './ui-context.js'

/** @returns {import('./ui-context.js').UiApi} */
export function useUi() {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useUi, useToast y useConfirm necesitan <UiProvider> arriba (AppRoot ya lo pone).')
  return ui
}

/** @returns {import('./ui-context.js').ToastApi} */
export function useToast() {
  return useUi().toast
}

/** @returns {import('./ui-context.js').ConfirmFn} */
export function useConfirm() {
  return useUi().confirm
}
