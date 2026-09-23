// Menú de usuario de la barra superior: nombre y "Cerrar sesión". Popover nativo: Esc y clic
// afuera lo cierran y el navegador expone aria-expanded en el botón que lo abre.
import { CircleUser, LogOut } from 'lucide-react'
import { useId } from 'react'
import { Button } from '../../components/ui/index.js'
import { useSession } from '../../lib/auth/session.js'
import { useLogout } from './useLogout.js'

export default function UserMenu() {
  const session = useSession()
  const onLogout = useLogout()
  const raw = useId()
  const id = `kz-user-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const name = session?.user.displayName ?? 'Invitado'
  return (
    <div className="kz-user">
      <button aria-label={`Cuenta de ${name}`} className="kz-user__trigger" popoverTarget={id} type="button">
        <CircleUser aria-hidden="true" size={20} strokeWidth={1.75} />
        <span className="kz-user__name">{name}</span>
      </button>
      <div className="kz-user__menu" id={id} popover="auto">
        <p className="kz-user__who">
          <span className="kz-eyebrow">Sesión iniciada</span>
          <strong>{name}</strong>
        </p>
        <Button block icon={<LogOut size={16} />} onClick={onLogout} size="sm" variant="secondary">
          Cerrar sesión
        </Button>
      </div>
    </div>
  )
}
