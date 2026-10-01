// Ranura para una sección que llega de otra feature (fase 5): la ficha, el screener y otras
// páginas montan aquí lo que construye cada stream sin que la página sepa de su código.
//
//   const Slots = { Technical: lazy(() => import('../../technical/TechnicalSection.jsx')) }
//   <FeatureSlot capabilities={['ohlc']}><Slots.Technical symbol={symbol} /></FeatureSlot>
//
// - capabilities: la sección solo se monta si el servidor anuncia alguna (useFeature). Sin la
//   lista se monta siempre (funciones solo del navegador, como agregar a la lista de seguimiento).
// - Suspense propio con `fallback` (null por omisión): mientras carga el chunk la página no salta.
// - ErrorBoundary propio: si la sección truena, se ve un aviso dentro de la ranura y el resto de la
//   página sigue en pie (el ErrorBoundary de la app tumbaría la pantalla entera).
import { Component, Suspense } from 'react'
import { ErrorState } from '../components/ui/index.js'
import { useFeature } from '../lib/api/useFeature.js'

class SlotBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.warn('[FeatureSlot]', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return <ErrorState message="No pudimos mostrar esta sección. El resto de la página sigue disponible." />
    }
    return this.props.children
  }
}

const NO_CAPABILITIES = []

/**
 * @param {{ capabilities?: string[], fallback?: import('react').ReactNode, children: import('react').ReactNode }} props
 */
export function FeatureSlot({ capabilities, fallback = null, children }) {
  const feature = useFeature(capabilities ?? NO_CAPABILITIES)
  if (capabilities && !feature.enabled) return null
  return (
    <SlotBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </SlotBoundary>
  )
}
