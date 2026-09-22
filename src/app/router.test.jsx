// Árbol de rutas en memoria: guardas, NotFound, Próximamente y títulos. La app legada no se
// monta aquí (se cubre en e2e/app.spec.js y en el baseline visual).
import { render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { resetCapabilitiesForTests } from '../lib/api/capabilities.js'
import { SESSION_KEY, resetSessionForTests } from '../lib/auth/session.js'
import { appRoutes } from './router.jsx'

const session = { token: 't', expiresAt: '2099-01-01T00:00:00.000Z', user: { username: 'ana', displayName: 'Ana' } }

function renderAt(path) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  resetSessionForTests()
  resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, authRequired: true, checkedAt: 'x' })
})

describe('router', () => {
  it('sin sesión, una ruta privada manda a /login?next=', async () => {
    const router = renderAt('/portafolio/riesgo')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe('?next=%2Fportafolio%2Friesgo')
    expect(await screen.findByRole('heading', { level: 1, name: 'Entra a Kaizen' })).toBeInTheDocument()
  })

  it('con sesión, una ruta nueva sin feature muestra Próximamente con el título del handle', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    renderAt('/portafolio/riesgo')
    expect(await screen.findByRole('heading', { level: 1, name: 'Riesgo' })).toBeInTheDocument()
    expect(screen.getByText('Próximamente')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Riesgo · Kaizen'))
  })

  it('las rutas públicas no piden sesión', async () => {
    renderAt('/legal/privacidad')
    expect(await screen.findByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeInTheDocument()
  })

  it('ruta desconocida: NotFound con la dirección', async () => {
    renderAt('/nada/por/aqui')
    expect(await screen.findByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeInTheDocument()
    expect(screen.getByText('/nada/por/aqui')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a iniciar sesión' })).toHaveAttribute('href', '/login')
  })

  it('/herramientas redirige al optimizador', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    const router = renderAt('/herramientas')
    await waitFor(() => expect(router.state.location.pathname).toBe('/herramientas/optimizador'))
  })

  it('servidor viejo: aviso en rutas nuevas', async () => {
    resetCapabilitiesForTests({ status: 'legacy', apiVersion: 1, authRequired: false, checkedAt: 'x' })
    renderAt('/aprender')
    expect(await screen.findByText('Servidor sin actualizar')).toBeInTheDocument()
  })
})
