// Envoltura de las páginas públicas de F5. El router monta las rutas públicas fuera del shell (sin
// su <main> ni su margen), así que aquí va el landmark principal con el contenedor de la casa, y
// arriba una barra con la salida a la app: "Ir a la app" con sesión vigente, "Entrar" sin ella.
import { Link } from 'react-router'
import { cn } from '../../cn.js'
import { DEFAULT_PRIVATE_PATH, PATHS } from '../../app/paths.js'
import { isExpired, useSession } from '../../lib/auth/session.js'
import './public.css'

export function PublicPage({ className, children }) {
  const session = useSession()
  const active = Boolean(session && !isExpired(session))
  return (
    <>
      <header className="kz-container f5-public__bar">
        <Link className="f5-public__brand" to={PATHS.learn}>
          Kaizen
        </Link>
        <Link className="button button-secondary button-sm f5-public__cta" to={active ? DEFAULT_PRIVATE_PATH : PATHS.login}>
          {active ? 'Ir a la app' : 'Entrar'}
        </Link>
      </header>
      <main id="contenido" className={cn('kz-container', 'f5-public', className)}>
        {children}
      </main>
    </>
  )
}
