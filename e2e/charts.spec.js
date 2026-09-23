// Galería de gráficas (C2) en /dev/ui, sección "Gráficas", sobre el build de e2e. Corre en desktop
// (1440x900) y mobile (390x844).
//
// - axe WCAG 2.1 AA sin violaciones dentro de la sección, en claro y oscuro, en reposo, con la
//   cruceta activa y con una tabla abierta.
// - Cruceta y tooltip con teclado (flechas, Inicio, Fin, Esc) y con puntero.
// - "Ver tabla" abre y cierra la alternativa de texto.
// - Sin scroll horizontal de página.
// - Sin errores de consola ni requests fallidos: la fixture `guards` tumba la prueba si aparecen.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])

async function openCharts(page, baseURL, theme = 'light') {
  await setupApp(page, { baseURL })
  await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  await page.goto('/dev/ui')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  const section = page.locator('#graficas')
  await expect(section.getByRole('heading', { level: 2, name: 'Gráficas' })).toBeVisible()
  await expect(section.getByRole('figure', { name: 'IPC contra S&P 500' })).toBeVisible()
  // El ancho se mide con ResizeObserver: espera a que haya trazos.
  await expect(section.locator('.kz-chart__line').first()).toBeAttached()
  return section
}

async function expectNoAxeViolations(page, context) {
  const results = await new AxeBuilder({ page }).include('#graficas').withTags(WCAG_AA).analyze()
  const detail = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`)
    .join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

const plotOf = (figure) => figure.getByRole('group', { name: /Gráfica interactiva/ })

test.describe('accesibilidad de las gráficas', () => {
  for (const theme of THEMES) {
    test(`axe sin violaciones en tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }) => {
      test.setTimeout(60_000)
      const section = await openCharts(page, baseURL, theme)
      await expectNoAxeViolations(page, `reposo, tema ${theme}`)

      const ipc = section.getByRole('figure', { name: 'IPC contra S&P 500' })
      await plotOf(ipc).focus()
      await expect(ipc.locator('.kz-chart__tooltip')).toBeVisible()
      await expectNoAxeViolations(page, `cruceta activa, tema ${theme}`)

      const mix = section.getByRole('figure', { name: 'Mezcla del portafolio' })
      await mix.getByRole('button', { name: 'Ver tabla' }).click()
      await expect(mix.getByRole('table', { name: 'Datos de Mezcla del portafolio' })).toBeVisible()
      await expectNoAxeViolations(page, `tabla abierta, tema ${theme}`)
    })
  }
})

test.describe('interacción', () => {
  test('cruceta por teclado: flechas, Inicio, Fin y Esc', async ({ page, baseURL }) => {
    const section = await openCharts(page, baseURL)
    const ipc = section.getByRole('figure', { name: 'IPC contra S&P 500' })
    const plot = plotOf(ipc)
    const tooltip = ipc.locator('.kz-chart__tooltip')
    const title = tooltip.locator('.kz-chart__tooltip-title')

    await plot.focus()
    await expect(tooltip).toBeVisible()
    await expect(ipc.locator('.kz-chart__crosshair')).toBeAttached()
    const last = await title.textContent()
    await expect(tooltip).toContainText('IPC')
    await expect(tooltip).toContainText('S&P 500')

    await page.keyboard.press('ArrowLeft')
    await expect(title).not.toHaveText(last ?? '')
    await page.keyboard.press('Home')
    await expect(title).toHaveText('22 sep 2025')
    await page.keyboard.press('ArrowRight')
    await expect(title).toHaveText('23 sep 2025')
    await page.keyboard.press('End')
    await expect(title).toHaveText(last ?? '')
    // El lector de pantalla recibe el punto activo por la región viva.
    await expect(plot).toHaveAccessibleDescription(new RegExp(`^${last}\\. IPC: `))

    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)
  })

  test('cruceta con puntero', async ({ page, baseURL }) => {
    const section = await openCharts(page, baseURL)
    const ipc = section.getByRole('figure', { name: 'IPC contra S&P 500' })
    const plot = plotOf(ipc)
    await plot.scrollIntoViewIfNeeded()
    const box = await plot.boundingBox()
    if (!box) throw new Error('sin caja de la gráfica')
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await expect(ipc.locator('.kz-chart__tooltip')).toBeVisible()
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 60)
    await expect(ipc.locator('.kz-chart__tooltip')).toHaveCount(0)
  })

  test('Ver tabla abre y cierra la alternativa de texto', async ({ page, baseURL }) => {
    const section = await openCharts(page, baseURL)
    const bars = section.getByRole('figure', { name: 'Rendimiento por sector' })
    const toggle = bars.getByRole('button', { name: 'Ver tabla' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    const table = bars.getByRole('table', { name: 'Datos de Rendimiento por sector' })
    await expect(table).toBeVisible()
    await expect(table.getByRole('rowheader', { name: 'Consumo básico' })).toBeVisible()
    await expect(table).toContainText('−2.3%')
    const hide = bars.getByRole('button', { name: 'Ocultar tabla' })
    await expect(hide).toHaveAttribute('aria-expanded', 'true')
    await hide.click()
    await expect(table).toHaveCount(0)
  })

  test('casos borde: vacío sin foco y un solo punto navegable', async ({ page, baseURL }) => {
    const section = await openCharts(page, baseURL)
    const empty = section.getByRole('figure', { name: 'Serie sin datos' })
    await expect(empty).toContainText('Sin datos para este periodo')
    await expect(empty.getByRole('group')).toHaveCount(0)
    const one = section.getByRole('figure', { name: 'Un solo punto' })
    await plotOf(one).focus()
    await expect(one.locator('.kz-chart__tooltip')).toContainText('7.52%')
  })

  test('sin scroll horizontal de página', async ({ page, baseURL }) => {
    await openCharts(page, baseURL)
    await page.locator('#graficas').scrollIntoViewIfNeeded()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
