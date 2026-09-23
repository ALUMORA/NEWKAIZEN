// Páginas de F5: Aprender (glosario y ficha), legales y, con sesión, lista de seguimiento y
// bienvenida. Corre en desktop (1440x900) y mobile (390x844) sobre el build de e2e, con las
// respuestas v2 simuladas. La fixture `guards` tumba la prueba ante cualquier console.error,
// excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F5_CAPTURE_DIR=/ruta se guarda una por página y viewport.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F5_CAPTURE_DIR ?? ''

/** @param {import('@playwright/test').Page} page */
async function settleAnimations(page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null)),
    ),
  )
}

async function expectNoAxeViolations(page, context) {
  await settleAnimations(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  const detail = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`)
    .join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

async function noHorizontalScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth, 'la página no se desplaza a lo ancho').toBeLessThanOrEqual(innerWidth)
}

async function open(page, baseURL, path, { theme = 'light', session = false, routes = {} } = {}) {
  await setupApp(page, { baseURL, session, routes })
  await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  await page.goto(path)
}

const PUBLIC_PAGES = [
  { path: '/aprender', h1: 'Glosario' },
  { path: '/aprender/sharpe', h1: /Sharpe/ },
  { path: '/legal/terminos', h1: 'Términos de uso' },
  { path: '/legal/privacidad', h1: 'Aviso de privacidad' },
  { path: '/legal/aviso', h1: 'Aviso legal' },
]

test.describe('F5: páginas públicas', () => {
  for (const { path, h1 } of PUBLIC_PAGES) {
    for (const theme of THEMES) {
      test(`${path} en tema ${theme}: h1, axe y sin scroll a lo ancho`, async ({ page, baseURL }, testInfo) => {
        await open(page, baseURL, path, { theme })
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await noHorizontalScroll(page)
        await expectNoAxeViolations(page, `${path} ${theme}`)
        if (CAPTURE_DIR && theme === 'light') {
          const name = path.replace(/\//g, '_').replace(/^_/, '')
          await page.screenshot({ path: `${CAPTURE_DIR}/${name}-${testInfo.project.name}.png`, fullPage: false })
        }
      })
    }
  }

  test('el buscador del glosario filtra y lleva a la ficha', async ({ page, baseURL }) => {
    await open(page, baseURL, '/aprender')
    await page.getByRole('searchbox', { name: /Buscar un concepto/ }).fill('volatilidad')
    await expect(page.getByRole('status')).toContainText('encontrado')
    const first = page.getByRole('region', { name: 'Resultados' }).getByRole('link').first()
    const title = (await first.locator('strong').textContent()) ?? ''
    await first.click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(page.getByText('Cómo leerlo')).toBeVisible()
  })

  test('un término que no existe muestra un estado vacío amable', async ({ page, baseURL }) => {
    await open(page, baseURL, '/aprender/no-existe-este-termino')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Concepto no encontrado')
    await expect(page.getByRole('link', { name: 'Ver el glosario completo' })).toBeVisible()
  })
})
