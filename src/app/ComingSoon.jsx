// Página provisional para rutas nuevas que todavía no tienen feature. Toma el título y la
// descripción del handle de la ruta: { handle: { title: 'Riesgo', description: '...' } }.
import { Link, useMatches } from 'react-router'
import { useSession } from '../lib/auth/session.js'
import { PATHS } from './paths.js'
import { useShell } from './shell/shell-context.js'

const DEFAULT_DESCRIPTION = 'Estamos construyendo esta sección. Mientras tanto puedes usar las herramientas que ya están disponibles.'

export default function ComingSoon({ title, description }) {
  const matches = useMatches()
  const session = useSession()
  const handle = /** @type {{ title?: string, description?: string } | undefined} */ (matches.at(-1)?.handle)
  const heading = title ?? handle?.title ?? 'Próximamente'
  // Dentro del shell ya hay un <main id="contenido">: aquí va un div para no anidar otro main.
  const { embedded } = useShell()
  const Root = embedded ? 'div' : 'main'
  return (
    <Root className={embedded ? 'kz-message-page kz-message-page--embedded' : 'kz-message-page'}>
      <section aria-labelledby="kz-soon-title" className="kz-message card">
        <span className="badge">Próximamente</span>
        <h1 id="kz-soon-title">{heading}</h1>
        <p>{description ?? handle?.description ?? DEFAULT_DESCRIPTION}</p>
        <div className="kz-actions">
          <Link className="button button-secondary button-md" to={session ? PATHS.markets : PATHS.login}>
            {session ? 'Ir a Mercados' : 'Ir a iniciar sesión'}
          </Link>
        </div>
      </section>
    </Root>
  )
}
