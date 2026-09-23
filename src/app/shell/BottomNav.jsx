// Barra inferior de móvil (< 768 px): Mercados, Portafolio, Investigar, Herramientas y "Más",
// que abre el Sheet de C1 con Watchlist, Aprender, Tema y Cerrar sesión. El marco deja abajo el
// alto de esta barra para que el contenido nunca quede debajo.
import { Ellipsis, LogOut } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Button, Sheet, ThemeToggle } from '../../components/ui/index.js'
import { BOTTOM_NAV, NAV_EXTRA, activeBottomId } from '../nav.js'
import { useLogout } from './useLogout.js'

export default function BottomNav() {
  const { pathname } = useLocation()
  const active = activeBottomId(pathname)
  const [moreOpen, setMoreOpen] = useState(false)
  const onLogout = useLogout()
  const close = () => setMoreOpen(false)
  return (
    <>
      <nav aria-label="Secciones" className="kz-bottom">
        <ul className="kz-bottom__list">
          {BOTTOM_NAV.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.id}>
                <Link aria-current={active === item.id ? 'page' : undefined} className="kz-bottom__item" to={item.to}>
                  <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
          <li>
            <button
              aria-haspopup="dialog"
              className="kz-bottom__item"
              data-active={active === 'mas' || undefined}
              onClick={() => setMoreOpen(true)}
              type="button"
            >
              <Ellipsis aria-hidden="true" size={20} strokeWidth={1.75} />
              <span>Más</span>
            </button>
          </li>
        </ul>
      </nav>
      <Sheet onClose={close} open={moreOpen} title="Más">
        <ul className="kz-more">
          {NAV_EXTRA.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.id}>
                <Link aria-current={active === 'mas' && pathname.startsWith(item.to) ? 'page' : undefined} className="kz-more__link" onClick={close} to={item.to}>
                  <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="kz-more__theme">
          <ThemeToggle variant="segmented" />
        </div>
        <Button block icon={<LogOut size={16} />} onClick={onLogout} variant="secondary">
          Cerrar sesión
        </Button>
      </Sheet>
    </>
  )
}
