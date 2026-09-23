// Punto de estado del servidor con texto corto al lado: el color nunca va solo.
import { useCapabilities } from '../../lib/api/capabilities.js'

const STATES = {
  probing: { tone: 'idle', short: 'Conectando', long: 'Conectando con el servidor' },
  waking: { tone: 'idle', short: 'Despertando', long: 'El servidor está despertando' },
  ready: { tone: 'up', short: 'En línea', long: 'Servidor en línea' },
  legacy: { tone: 'stale', short: 'Sin actualizar', long: 'Servidor sin actualizar: algunas secciones no tienen datos' },
  down: { tone: 'down', short: 'Sin conexión', long: 'Sin conexión con el servidor' },
}

export default function ServerStatus() {
  const { status } = useCapabilities()
  const state = STATES[/** @type {keyof typeof STATES} */ (status)] ?? STATES.probing
  return (
    <p className="kz-server" data-tone={state.tone} title={state.long}>
      <span aria-hidden="true" className="kz-server__dot" />
      <span aria-hidden="true" className="kz-server__text">
        {state.short}
      </span>
      <span className="sr-only">{state.long}</span>
    </p>
  )
}
