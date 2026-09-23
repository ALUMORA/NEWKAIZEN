// Barra lateral de escritorio (>= 768 px). Plegable a 64 px: plegada solo muestra iconos, cada
// liga conserva su nombre accesible (aria-label) y un title para el cursor.
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { IconButton, Mark } from '../../components/ui/index.js'
import { NAV_EXTRA, NAV_SECTIONS, activeNavItem } from '../nav.js'
import { PATHS } from '../paths.js'

/** @param {{ item: import('../nav.js').NavItem, active: boolean, collapsed: boolean }} props */
function SideLink({ item, active, collapsed }) {
  const Icon = item.icon
  return (
    <li>
      <Link
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        className="kz-side__link"
        title={collapsed ? item.label : undefined}
        to={item.to}
      >
        <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
        <span className="kz-side__text">{item.label}</span>
      </Link>
    </li>
  )
}

/** @param {{ collapsed: boolean, onToggle: () => void }} props */
export default function Sidebar({ collapsed, onToggle }) {
  const { pathname } = useLocation()
  const active = activeNavItem(pathname)
  return (
    <aside className="kz-side" data-collapsed={collapsed || undefined}>
      <div className="kz-side__head">
        <Link aria-label="Kaizen, ir a Mercados" className="kz-side__brand" to={PATHS.markets}>
          <Mark size={28} />
          <span className="kz-side__text kz-side__wordmark">Kaizen</span>
        </Link>
      </div>
      <nav aria-label="Principal" className="kz-side__nav">
        {NAV_SECTIONS.map((section) => (
          <div className="kz-side__group" key={section.id}>
            <p className="kz-side__label kz-eyebrow" id={`kz-side-${section.id}`}>
              {section.label}
            </p>
            <ul aria-labelledby={`kz-side-${section.id}`} className="kz-side__list">
              {section.items.map((item) => (
                <SideLink active={active?.id === item.id} collapsed={collapsed} item={item} key={item.id} />
              ))}
            </ul>
          </div>
        ))}
        <div className="kz-side__group">
          <ul aria-label="Más" className="kz-side__list">
            {NAV_EXTRA.map((item) => (
              <SideLink active={active?.id === item.id} collapsed={collapsed} item={item} key={item.id} />
            ))}
          </ul>
        </div>
      </nav>
      <div className="kz-side__foot">
        <IconButton label={collapsed ? 'Expandir barra lateral' : 'Plegar barra lateral'} onClick={onToggle} size="sm">
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </IconButton>
      </div>
    </aside>
  )
}
