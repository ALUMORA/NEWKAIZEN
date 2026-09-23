// Contexto de UiProvider, aparte para que UiProvider.jsx solo exporte componentes (Fast Refresh).
import { createContext } from 'react'

/**
 * @typedef {'neutral'|'positive'|'negative'|'info'} ToastTone
 * @typedef {{ title: import('react').ReactNode, description?: import('react').ReactNode, tone?: ToastTone,
 *   action?: { label: string, onClick: () => void }, duration?: number }} ToastInput
 * @typedef {{ show: (toast: ToastInput) => string, dismiss: (id: string) => void }} ToastApi
 * @typedef {{ title: import('react').ReactNode, message?: import('react').ReactNode, confirmLabel?: string,
 *   cancelLabel?: string, destructive?: boolean }} ConfirmInput
 * @typedef {(options: ConfirmInput) => Promise<boolean>} ConfirmFn
 * @typedef {{ mode: string, dark: boolean, setTheme: (next: 'light'|'dark'|'system') => void, toggle: () => void }} ThemeApi
 * @typedef {{ theme: ThemeApi, toast: ToastApi, confirm: ConfirmFn }} UiApi
 */

export const UiContext = createContext(/** @type {UiApi | null} */ (null))
