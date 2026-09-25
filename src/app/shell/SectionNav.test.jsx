// Páginas hermanas de la sección en móvil: sin esto, Backtest y Simulador no tenían liga visible.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import SectionNav from './SectionNav.jsx'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SectionNav />
    </MemoryRouter>,
  )
}

describe('SectionNav', () => {
  it('en /herramientas/backtest lista las tres herramientas y marca Backtest', () => {
    renderAt('/herramientas/backtest')
    const nav = screen.getByRole('navigation', { name: 'Páginas de Herramientas' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Optimizador', 'Backtest', 'Simulador y metas'])
    expect(within(nav).getByRole('link', { name: 'Backtest' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Simulador y metas' })).toHaveAttribute('href', '/herramientas/simulador')
  })

  it('la ficha de una emisora cae en Investigar con Buscar emisora marcada', () => {
    renderAt('/investigar/WALMEX.MX')
    const nav = screen.getByRole('navigation', { name: 'Páginas de Investigar' })
    expect(within(nav).getByRole('link', { name: 'Buscar emisora' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'FIBRAs' })).toBeInTheDocument()
  })

  it('fuera de una sección (lista de seguimiento) no pinta nada', () => {
    const { container } = renderAt('/watchlist')
    expect(container).toBeEmptyDOMElement()
  })
})
