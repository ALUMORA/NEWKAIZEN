// Proveedor de UI (C1): tema, avisos y confirmaciones. AppRoot lo monta dentro de los providers
// de sesión y capacidades y por encima del router, así que los avisos sobreviven a un cambio de
// ruta (un "Deshacer" sigue ahí después de navegar).
//
// Los hooks para usarlo están en useUi.js: useUi(), useToast(), useConfirm().
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../theme.js'
import { ConfirmDialog } from './Dialog.jsx'
import { Toaster } from './Toast.jsx'
import { UiContext } from './ui-context.js'

const MAX_TOASTS = 3
const DEFAULT_DURATION = 5000
// Con "Deshacer" se da más tiempo: hay que leer, entender y llegar al botón.
const ACTION_DURATION = 8000

/** @param {{ children: import('react').ReactNode }} props */
export function UiProvider({ children }) {
  const { mode, dark, setTheme, toggle } = useTheme()
  const theme = useMemo(() => ({ mode, dark, setTheme, toggle }), [mode, dark, setTheme, toggle])
  const [toasts, setToasts] = useState(/** @type {any[]} */ ([]))
  const [pending, setPending] = useState(/** @type {(import('./ui-context.js').ConfirmInput & { resolve: (ok: boolean) => void }) | null} */ (null))
  const seq = useRef(0)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const show = useCallback((/** @type {import('./ui-context.js').ToastInput} */ input) => {
    seq.current += 1
    const id = `aviso-${seq.current}`
    const toast = {
      id,
      title: input.title,
      description: input.description,
      tone: input.tone ?? 'neutral',
      action: input.action,
      duration: input.duration ?? (input.action ? ACTION_DURATION : DEFAULT_DURATION),
    }
    setToasts((list) => [...list, toast].slice(-MAX_TOASTS))
    return id
  }, [])

  const confirm = useCallback(
    (/** @type {import('./ui-context.js').ConfirmInput} */ options) =>
      new Promise((resolve) => {
        setPending((prev) => {
          prev?.resolve(false)
          return { ...options, resolve }
        })
      }),
    [],
  )

  const toast = useMemo(() => ({ show, dismiss }), [show, dismiss])
  const value = useMemo(() => ({ theme, toast, confirm }), [theme, toast, confirm])

  const settle = (ok) => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <UiContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title}
        message={pending?.message}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        destructive={pending?.destructive}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </UiContext.Provider>
  )
}
