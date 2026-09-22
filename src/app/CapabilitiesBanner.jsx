// Avisos del estado del servidor. No bloquean: flotan arriba y la página se sigue usando.
// - "waking": Render dormido, se reintenta solo.
// - "legacy": el servidor sigue con el API viejo; en las rutas que todavía montan la app legada
//   (handle.legacy) no se muestra, porque ahí todo funciona con ese API.
// - "down": no contestó; se ofrece reintentar.
import { useState } from 'react'
import { useMatches } from 'react-router'
import { startCapabilitiesProbe, useCapabilities } from '../lib/api/capabilities.js'
import { Button } from '../ui.jsx'

export default function CapabilitiesBanner() {
  const { status } = useCapabilities()
  const matches = useMatches()
  const [dismissed, setDismissed] = useState(null)
  const onLegacyRoute = matches.some((m) => /** @type {{ legacy?: boolean } | undefined} */ (m.handle)?.legacy)

  if (status === 'waking') {
    return (
      <div className="kz-banner" role="status">
        <span aria-hidden="true" className="kz-banner-dot" />
        <span className="kz-banner-text">
          <strong>Despertando el servidor…</strong>
          Puede tardar hasta un minuto la primera vez del día.
        </span>
      </div>
    )
  }

  if (status === 'legacy' && !onLegacyRoute && dismissed !== 'legacy') {
    return (
      <div className="kz-banner" data-tone="warning" role="status">
        <span className="kz-banner-text">
          <strong>Servidor sin actualizar</strong>
          Algunas secciones nuevas no van a tener datos hasta que se actualice.
        </span>
        <Button onClick={() => setDismissed('legacy')} size="sm" type="button" variant="ghost">
          Cerrar
        </Button>
      </div>
    )
  }

  if (status === 'down' && !onLegacyRoute) {
    return (
      <div className="kz-banner" data-tone="danger" role="alert">
        <span className="kz-banner-text">
          <strong>Sin conexión con el servidor</strong>
          Revisa tu conexión o intenta en unos minutos.
        </span>
        <Button onClick={() => startCapabilitiesProbe({ force: true })} size="sm" type="button" variant="secondary">
          Reintentar
        </Button>
      </div>
    )
  }

  return null
}
