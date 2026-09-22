// Última red de seguridad: si algo truena al renderizar, se muestra un mensaje amable en español
// con "Recargar". El detalle técnico (mensaje y stack) solo aparece en desarrollo.
import { Component } from 'react'
import { Button } from '../ui.jsx'

/** true si el error es de un chunk que ya no existe (se publicó una versión nueva). */
function isChunkError(error) {
  const text = String(error?.message ?? error ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text)
}

export function ErrorScreen({ error }) {
  const chunk = isChunkError(error)
  return (
    <main className="kz-message-page">
      <section aria-labelledby="kz-error-title" className="kz-message card" role="alert">
        <h1 id="kz-error-title">Algo salió mal</h1>
        <p>
          {chunk
            ? 'Hay una versión nueva de Kaizen. Recarga la página para seguir.'
            : 'Ocurrió un error inesperado al mostrar esta pantalla. Recarga para intentarlo de nuevo; lo que tienes guardado en este navegador no se pierde.'}
        </p>
        <div className="kz-actions">
          <Button onClick={() => window.location.reload()} type="button">
            Recargar
          </Button>
        </div>
        {import.meta.env.DEV && error ? (
          <pre className="kz-stack">{String(error?.stack || error?.message || error)}</pre>
        ) : null}
      </section>
    </main>
  )
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.warn('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (this.state.error) return <ErrorScreen error={this.state.error} />
    return this.props.children
  }
}
