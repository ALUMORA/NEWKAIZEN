// Catálogo de primitivas (C1), solo fuera de producción. router.jsx lo agrega detrás de su propia
// condición; aquí se repite el candado para que, aunque alguien lo importe en un build de
// producción, no haya ruta ni chunk: con MODE === 'production' la lista queda vacía y el import()
// de la página es código muerto que Rollup quita.
//
// Es pública (handle.public) a propósito: es una herramienta de desarrollo sin datos, y así se
// revisa sin sesión y sin el armazón de la app encima.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const enabled = import.meta.env.MODE !== 'production'

const Pages = enabled ? { DevUi: lazy(() => import('./DevUiPage.jsx')) } : null

export const routes = Pages
  ? [{ path: route(PATHS.devUi), element: <Pages.DevUi />, handle: { title: 'Sistema de diseño', public: true } }]
  : []
