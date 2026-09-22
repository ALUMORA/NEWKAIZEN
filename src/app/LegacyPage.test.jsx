// LegacyPage con el módulo legado reemplazado por un host falso: la URL sigue a la tab que avisa
// el legado (push), el título cambia, no hay ciclos y el host no se vuelve a montar al navegar.
// El legado de verdad se prueba en e2e/app.spec.js y en el baseline visual.
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { resetCapabilitiesForTests } from '../lib/api/capabilities.js'
import { SESSION_KEY, resetSessionForTests } from '../lib/auth/session.js'
import { appRoutes } from './router.jsx'

const seen = vi.hoisted(() => ({ props: /** @type {any[]} */ ([]), mounts: 0 }))

vi.mock('../legacy/App.legacy.jsx', () => ({
  LegacyWorkspaceHost: function FakeHost(props) {
    seen.props.push(props)
    useEffect(() => {
      seen.mounts += 1
    }, [])
    return <div data-testid="legacy-host">{props.tab}</div>
  },
}))

const session = { token: 't', expiresAt: '2099-01-01T00:00:00.000Z', user: { username: 'ana', displayName: 'Ana' } }
const lastProps = () => seen.props[seen.props.length - 1]

beforeEach(() => {
  seen.props = []
  seen.mounts = 0
  resetSessionForTests()
  resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, authRequired: true, checkedAt: 'x' })
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
})

async function renderAt(path) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  await screen.findByTestId('legacy-host')
  return router
}

describe('LegacyPage: la URL sigue a la tab del legado', () => {
  it('otra tab navega con push a su ruta y cambia el título; el host sigue montado', async () => {
    const router = await renderAt('/mercados')
    expect(screen.getByTestId('legacy-host')).toHaveTextContent('news')
    expect(lastProps().apiBase).toBeTruthy()

    act(() => lastProps().onTabChange('optimize'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/herramientas/optimizador'))
    expect(router.state.historyAction).toBe('PUSH')
    expect(screen.getByTestId('legacy-host')).toHaveTextContent('optimize')
    await waitFor(() => expect(document.title).toBe('Optimizador · Kaizen'))
    expect(seen.mounts).toBe(1)

    // Atrás regresa a /mercados y a su tab, sin volver a montar el legado.
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/mercados')
    expect(screen.getByTestId('legacy-host')).toHaveTextContent('news')
    await waitFor(() => expect(document.title).toBe('Mercados · Kaizen'))
    expect(seen.mounts).toBe(1)
  })

  it('sin ciclos: la tab de la ruta actual o una tab desconocida no navegan', async () => {
    const router = await renderAt('/screener/fibras')
    const key = router.state.location.key
    act(() => lastProps().onTabChange('fibras'))
    act(() => lastProps().onTabChange('no-existe'))
    act(() => lastProps().onTabChange(undefined))
    expect(router.state.location.key).toBe(key)
    expect(router.state.location.pathname).toBe('/screener/fibras')

    // Después de navegar, el aviso con la tab nueva (el que manda el Workspace al ajustarse a la
    // ruta) tampoco vuelve a navegar.
    act(() => lastProps().onTabChange('analisis'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/investigar'))
    const after = router.state.location.key
    act(() => lastProps().onTabChange('analisis'))
    expect(router.state.location.key).toBe(after)
  })
})
