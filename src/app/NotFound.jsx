// Ruta desconocida. Pública: la ve cualquiera, con o sin sesión.
import { Link, useLocation } from 'react-router'
import { useSession } from '../lib/auth/session.js'
import { PATHS } from './paths.js'

export default function NotFound() {
  const { pathname } = useLocation()
  const session = useSession()
  return (
    <main className="kz-message-page">
      <section aria-labelledby="kz-notfound-title" className="kz-message card">
        <span className="eyebrow">Error 404</span>
        <h1 id="kz-notfound-title">No encontramos esta página</h1>
        <p>
          La dirección <code>{pathname}</code> no existe o cambió de lugar.
        </p>
        <div className="kz-actions">
          <Link className="button button-primary button-md" to={session ? PATHS.markets : PATHS.login}>
            {session ? 'Ir a Mercados' : 'Ir a iniciar sesión'}
          </Link>
        </div>
      </section>
    </main>
  )
}
