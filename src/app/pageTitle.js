// Título de pestaña propio de una página cuando handle.title no alcanza porque depende de los
// datos: la ficha de cada emisora, cada concepto del glosario, cada guía de metodología. Sin esto
// todas las fichas se llamaban "Ficha de la emisora · Kaizen" y no se distinguían en el historial
// ni en las pestañas.
//
//   usePageTitle(`Ficha de ${symbol}`)
//
// RootLayout lo lee y lo usa solo mientras la ruta sea la misma que lo pidió; si no, vuelve a
// handle.title. Va en un almacén aparte, no en un efecto que escriba document.title, porque en un
// mismo commit el efecto del hijo corre antes que el de RootLayout y este lo pisaba.
import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'

/** @type {{ path: string, text: string } | null} */
let current = null
/** @type {Set<() => void>} */
const listeners = new Set()

function emit() {
  for (const listener of listeners) listener()
}

/** @param {() => void} listener */
function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot() {
  return current
}

/**
 * El título que pidió la página de `pathname`, o null.
 * @param {string} pathname
 */
export function usePageTitleOverride(pathname) {
  const entry = useSyncExternalStore(subscribe, snapshot, snapshot)
  return entry && entry.path === pathname ? entry.text : null
}

/**
 * Pide un título de pestaña para la página actual ("Ficha de WALMEX.MX" da
 * "Ficha de WALMEX.MX · Kaizen"). Con texto vacío o null no pide nada.
 * @param {string | null | undefined} text
 */
export function usePageTitle(text) {
  const { pathname } = useLocation()
  useEffect(() => {
    if (!text) return undefined
    const entry = { path: pathname, text }
    current = entry
    emit()
    return () => {
      if (current === entry) {
        current = null
        emit()
      }
    }
  }, [pathname, text])
}
