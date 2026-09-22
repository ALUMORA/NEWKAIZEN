// Guarda de las rutas privadas. Sin sesión vigente manda a /login?next=<ruta actual> (o a /login
// a secas si la persona cerró su sesión). También
// escucha "kaizen:unauthorized" (el cliente lo emite cuando el API responde 401) por si la
// sesión se cerró desde fuera de React.
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { UNAUTHORIZED_EVENT } from '../lib/api/config.js'
import { isExpired, peekEndReason, useSession } from '../lib/auth/session.js'
import { PATHS, pathLogin } from './paths.js'

export default function RequireAuth({ children }) {
  const session = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const here = `${location.pathname}${location.search}${location.hash}`

  useEffect(() => {
    const onUnauthorized = () => navigate(pathLogin(here), { replace: true })
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [navigate, here])

  if (!session || isExpired(session)) {
    // Después de "Cerrar sesión" no tiene sentido volver a la misma página al entrar otra vez.
    return <Navigate replace to={peekEndReason() === 'logout' ? PATHS.login : pathLogin(here)} />
  }
  return children ?? <Outlet />
}
