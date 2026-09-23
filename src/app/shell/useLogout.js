// Cerrar sesión desde el shell (menú de usuario, hoja "Más" y paleta): borra la sesión y va a
// /login, igual que el botón del legado (src/app/LegacyPage.jsx).
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { logout } from '../../lib/auth/session.js'
import { PATHS } from '../paths.js'

export function useLogout() {
  const navigate = useNavigate()
  return useCallback(() => {
    logout()
    navigate(PATHS.login, { replace: true })
  }, [navigate])
}
