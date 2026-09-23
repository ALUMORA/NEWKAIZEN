// Al cambiar de ruta (no en la primera carga) el foco va al h1 de la página: el que marca
// PageHeader de C1 con data-page-title, o el primer h1 del contenido. Si la página todavía se
// está cargando (lazy), se espera a que aparezca; si nunca aparece, el foco va al <main>.
// El título de la pestaña lo pone RootLayout con handle.title.
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'

const WAIT_MS = 3000

/** @param {HTMLElement} main */
function findHeading(main) {
  return /** @type {HTMLElement | null} */ (main.querySelector('[data-page-title]') ?? main.querySelector('h1'))
}

/** @param {HTMLElement} el */
function focusQuietly(el) {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

/** @param {import('react').RefObject<HTMLElement | null>} mainRef */
export function useRouteFocus(mainRef) {
  const { pathname } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return undefined
    }
    const main = mainRef.current
    if (!main) return undefined
    const started = Date.now()
    let frame = 0
    const tick = () => {
      const heading = findHeading(main)
      if (heading) return focusQuietly(heading)
      if (Date.now() - started > WAIT_MS) return focusQuietly(main)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [pathname, mainRef])
}
