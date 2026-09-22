// errorElement del router: errores al renderizar una ruta o al cargar su chunk.
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ErrorScreen } from './ErrorBoundary.jsx'
import NotFound from './NotFound.jsx'

export default function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />
  return <ErrorScreen error={error} />
}
