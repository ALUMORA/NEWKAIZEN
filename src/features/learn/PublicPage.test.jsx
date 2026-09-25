// Las páginas públicas (/aprender, /legal/*) viven fuera del shell: sin esta barra no había cómo
// volver a la app ni cómo entrar (revisión RT).
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SESSION_KEY, resetSessionForTests } from '../../lib/auth/session.js'
import { PublicPage } from './PublicPage.jsx'

const renderPage = () =>
  render(
    <MemoryRouter>
      <PublicPage>
        <h1>Aprender</h1>
      </PublicPage>
    </MemoryRouter>,
  )

describe('PublicPage: salida a la app', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetSessionForTests()
  })

  it('sin sesión ofrece Entrar hacia /login', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('link', { name: 'Ir a la app' })).toBeNull()
  })

  it('con sesión vigente ofrece Ir a la app', () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString()
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'jwt', expiresAt, user: { username: 'ana', displayName: 'Ana' } }))
    resetSessionForTests()
    renderPage()
    expect(screen.getByRole('link', { name: 'Ir a la app' })).toHaveAttribute('href', '/mercados')
    expect(screen.queryByRole('link', { name: 'Entrar' })).toBeNull()
  })

  it('con sesión vencida vuelve a ofrecer Entrar', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'jwt', expiresAt: '2020-01-01T00:00:00Z', user: { username: 'ana', displayName: 'Ana' } }))
    resetSessionForTests()
    renderPage()
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeVisible()
  })

  it('el contenido sigue en un solo main', () => {
    renderPage()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
  })
})
