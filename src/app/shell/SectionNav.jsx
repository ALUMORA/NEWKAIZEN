// Páginas hermanas de la sección actual, solo en móvil (< 768 px). En escritorio la barra lateral
// ya las muestra todas; en móvil la barra inferior lleva a la portada de cada sección y, sin esto,
// Backtest y Simulador (o Riesgo, o FIBRAs) solo se alcanzaban desde la paleta de búsqueda.
import { useLayoutEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { NAV_SECTIONS, activeNavItem } from '../nav.js'

export default function SectionNav() {
  const { pathname } = useLocation()
  const active = activeNavItem(pathname)
  const section = active ? NAV_SECTIONS.find((s) => s.items.some((item) => item.id === active.id && item.to === active.to)) : null
  const ref = useRef(/** @type {HTMLElement | null} */ (null))
  // La página activa a la vista aunque sea la última (FIBRAs, Rebalanceo): se desplaza solo la
  // tira, nunca la página.
  useLayoutEffect(() => {
    const nav = ref.current
    const link = /** @type {HTMLElement | null} */ (nav?.querySelector('[aria-current="page"]') ?? null)
    if (!nav || !link) return
    const box = nav.getBoundingClientRect()
    const chip = link.getBoundingClientRect()
    if (chip.left < box.left || chip.right > box.right) nav.scrollLeft += chip.left - box.left - 16
  }, [pathname])
  if (!section) return null
  return (
    <nav aria-label={`Páginas de ${section.label}`} className="kz-section-nav" ref={ref}>
      <ul className="kz-section-nav__list">
        {section.items.map((item) => (
          <li key={item.id}>
            <Link aria-current={item.id === active?.id ? 'page' : undefined} className="kz-section-nav__link" to={item.to}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
