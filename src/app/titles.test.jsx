// Títulos de pestaña (handle.title y usePageTitle): únicos, descriptivos, en mayúscula de oración
// y sin guiones largos.
import { render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { resetCapabilitiesForTests } from '../lib/api/capabilities.js'
import { resetSessionForTests } from '../lib/auth/session.js'
import { appRoutes } from './router.jsx'

/** @returns {{ path: string, title: string }[]} */
function collectTitles(routes, prefix = '') {
  /** @type {{ path: string, title: string }[]} */
  const out = []
  for (const r of routes) {
    const path = r.path ? `${prefix}/${r.path}`.replace(/\/+/g, '/') : prefix
    if (typeof r.handle?.title === 'string') out.push({ path, title: r.handle.title })
    if (r.children) out.push(...collectTitles(r.children, path))
  }
  return out
}

// Nombres propios, siglas y marcas que sí van con mayúscula a media frase.
const PROPER = new Set(['CETES', 'FIBRAs', 'México', 'Kaizen', 'Sharpe', 'DCF'])

describe('títulos de pestaña', () => {
  const titles = collectTitles(appRoutes)

  it('hay un título por ruta y ninguno se repite', () => {
    expect(titles.length).toBeGreaterThan(25)
    const seen = new Map()
    for (const { path, title } of titles) {
      expect(seen.has(title), `"${title}" se repite en ${seen.get(title)} y ${path}`).toBe(false)
      seen.set(title, path)
    }
  })

  it('van en mayúscula de oración, sin guiones largos', () => {
    for (const { title } of titles) {
      expect(title).not.toMatch(/[—–]/)
      const rest = title.split(/\s+/).slice(1).map((w) => w.replace(/[:,.]$/, ''))
      for (const word of rest) {
        if (/^[A-ZÁÉÍÓÚÑ]/.test(word)) expect(PROPER.has(word), `"${word}" en "${title}"`).toBe(true)
      }
    }
  })

  it('un concepto del glosario pone su propio nombre en la pestaña', async () => {
    resetSessionForTests()
    resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, authRequired: true, checkedAt: 'x' })
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/aprender/volatilidad'] })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Volatilidad' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Volatilidad · Kaizen'))
    await router.navigate('/aprender/correlacion')
    await waitFor(() => expect(document.title).toBe('Correlación · Kaizen'))
    await router.navigate('/legal/aviso')
    await waitFor(() => expect(document.title).toBe('Aviso legal · Kaizen'))
  })
})
