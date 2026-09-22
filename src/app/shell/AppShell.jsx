// Marco de las rutas privadas. PROVISIONAL de S2: hoy solo deja pasar la página (las rutas que
// montan la app legada traen su propia barra lateral). C3 lo reemplaza con la navegación nueva
// (src/app/nav.js) sin tocar router.jsx: el router ya renderiza <AppShell /> alrededor de
// todas las rutas privadas y la página va en su <Outlet />.
import { Outlet } from 'react-router'

export default function AppShell() {
  return <Outlet />
}
