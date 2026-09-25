// Primeros pasos en /mercados, que es adonde llega cualquiera al entrar. Sin esto, una persona
// nueva sin portafolio no tenía ninguna pista de la bienvenida: la ruta no está en la navegación y
// solo aparecía si entraba a Mi portafolio. Se va sola en cuanto hay un portafolio o se descarta.
import { Link } from 'react-router'
import { Button, Card } from '../../../components/ui/index.js'
import { PATHS } from '../../../app/paths.js'
import { update, useStore } from '../../../lib/storage.js'

export function FirstSteps() {
  const show = useStore((s) => !s.settings?.onboardingDone && !(s.portfolios?.length > 0))
  if (!show) return null
  const dismiss = () => update((s) => ({ ...s, settings: { ...s.settings, onboardingDone: true } }))
  return (
    <Card
      title="Primeros pasos"
      description="Arma tu portafolio con un ejemplo, con un CSV de tus movimientos o desde cero, y aquí mismo ves cuánto vale en pesos y cómo le va. Se guarda solo en este navegador."
      className="markets-first"
    >
      <div className="kz-row" data-gap="3">
        <Link className="kz-button" data-variant="primary" data-size="md" to={PATHS.onboarding}>
          Ir a la bienvenida
        </Link>
        <Button variant="secondary" onClick={dismiss}>
          Ahora no
        </Button>
      </div>
    </Card>
  )
}
