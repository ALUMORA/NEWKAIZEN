// Rutas privadas: primero la guarda de sesión y luego el marco de la app (C3).
import AppShell from './shell/AppShell.jsx'
import RequireAuth from './RequireAuth.jsx'

export default function PrivateLayout() {
  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  )
}
