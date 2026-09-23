// Envoltura de las páginas públicas de F5. El router monta las rutas públicas fuera del shell (sin
// su <main> ni su margen), así que aquí va el landmark principal con el contenedor de la casa.
import { cn } from '../../cn.js'

export function PublicPage({ className, children }) {
  return (
    <main id="contenido" className={cn('kz-container', 'f5-public', className)}>
      {children}
    </main>
  )
}
