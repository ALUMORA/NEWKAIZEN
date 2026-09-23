// Galería del sistema de diseño (/dev/ui, C1) sobre el build de e2e. Corre en desktop (1440x900)
// y mobile (390x844).
//
// - axe WCAG 2.1 AA sin violaciones, en tema claro y oscuro, con la página en reposo y con los
//   estados que cambian el DOM (tabla con error, popover abierto, diálogo abierto).
// - Teclado: pestañas (flechas, Inicio, Fin), trampa de foco y Esc del diálogo, orden de la tabla
//   y activación de fila, InfoTip.
// - Deshacer del aviso después de borrar con confirmación.
// - Sin scroll horizontal de página; la tabla hace scroll dentro de su marco.
// - Sin errores de consola ni requests fallidos: la fixture `guards` tumba la prueba si aparecen.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])

/** Abre /dev/ui con el tema pedido ya guardado (la llave es la de src/theme.js). */
async function openGallery(page, baseURL, theme = 'light') {
  await setupApp(page, { baseURL })
  await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  await page.goto('/dev/ui')
  await expect(page.getByRole('heading', { level: 1, name: 'Sistema de diseño' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

/** Corre axe y falla con la lista legible de violaciones. Antes espera a que terminen las
 *  animaciones de entrada (un diálogo a media opacidad mide contraste de más). */
async function expectNoAxeViolations(page, context) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null)),
    ),
  )
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  const detail = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`)
    .join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

const tableCard = (page) => page.getByRole('region', { name: 'Emisoras de muestra' })
const firstColumn = (page) => tableCard(page).locator('tbody tr > :first-child')

test.describe('accesibilidad de la galería', () => {
  for (const theme of THEMES) {
    test(`axe sin violaciones en tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }) => {
      test.setTimeout(60_000) // seis pasadas de axe sobre una página larga
      await openGallery(page, baseURL, theme)
      await expectNoAxeViolations(page, `reposo, tema ${theme}`)

      // Estados de la tabla que cambian el DOM.
      for (const state of ['Cargando', 'Vacía', 'Error']) {
        await tableCard(page).getByRole('radio', { name: state }).check()
        await expectNoAxeViolations(page, `tabla ${state}, tema ${theme}`)
      }
      await tableCard(page).getByRole('radio', { name: 'Con datos' }).check()

      // Popover de un InfoTip abierto.
      await page.getByRole('button', { name: 'Qué es Índice de Sharpe' }).click()
      await expect(page.getByRole('dialog', { name: 'Índice de Sharpe' })).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Índice de Sharpe' })).toContainText('volatilidad')
      await expectNoAxeViolations(page, `InfoTip abierto, tema ${theme}`)
      await page.keyboard.press('Escape')

      // Diálogo modal abierto.
      await page.getByRole('button', { name: 'Editar movimiento' }).click()
      await expect(page.getByRole('dialog', { name: 'Editar movimiento' })).toBeVisible()
      await expectNoAxeViolations(page, `diálogo abierto, tema ${theme}`)
    })
  }
})

test.describe('teclado', () => {
  test('pestañas: flechas con vuelta, saltan la deshabilitada, Inicio, Fin y Tab al panel', async ({ page, baseURL }) => {
    await openGallery(page, baseURL)
    const list = page.getByRole('tablist', { name: 'Secciones de la emisora' })
    const tab = (name) => list.getByRole('tab', { name })
    await tab('Resumen').focus()
    await expect(tab('Resumen')).toHaveAttribute('aria-selected', 'true')
    // Una sola parada de tabulador en la lista.
    await expect(list.locator('[role="tab"][tabindex="0"]')).toHaveCount(1)

    await page.keyboard.press('ArrowRight')
    await expect(tab(/Estados financieros/)).toBeFocused()
    await expect(tab(/Estados financieros/)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toContainText('cuatro trimestres')

    await page.keyboard.press('ArrowRight')
    await expect(tab('Dividendos')).toBeFocused()
    // "Insiders" está deshabilitada: la flecha da la vuelta a la primera.
    await page.keyboard.press('ArrowRight')
    await expect(tab('Resumen')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(tab('Dividendos')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(tab('Resumen')).toBeFocused()
    await page.keyboard.press('End')
    await expect(tab('Dividendos')).toBeFocused()
    await expect(tab('Dividendos')).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Tab')
    const panel = page.getByRole('tabpanel')
    await expect(panel).toBeFocused()
    await expect(panel).toContainText('doce meses')
  })

  test('diálogo: el foco queda atrapado, Esc cierra y el foco regresa al botón', async ({ page, baseURL }) => {
    await openGallery(page, baseURL)
    const opener = page.getByRole('button', { name: 'Editar movimiento' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Editar movimiento' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/kz-scroll-lock/)

    const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]')))
    expect(await inside()).toBe(true)
    // Más Tabs que controles: el foco nunca sale.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab')
      expect(await inside(), `Tab número ${i + 1}`).toBe(true)
    }
    // Shift+Tab desde el primero va al último (Guardar cambios).
    await dialog.getByRole('button', { name: 'Cerrar' }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Guardar cambios' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect(page.locator('html')).not.toHaveClass(/kz-scroll-lock/)
  })

  test('confirmación destructiva: el foco empieza en Cancelar y Esc cancela', async ({ page, baseURL }) => {
    await openGallery(page, baseURL)
    const opener = page.getByRole('button', { name: 'Borrar Compra de 100 WALMEX.MX' })
    await opener.click()
    const dialog = page.getByRole('alertdialog', { name: '¿Borrar este movimiento?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect(page.getByTestId('moves-count')).toHaveText('3 movimientos')
  })

  test('tabla: ordena con Enter y Espacio (aria-sort) y la fila se activa con el teclado', async ({ page, baseURL }) => {
    await openGallery(page, baseURL)
    const table = tableCard(page).getByRole('table')
    const header = (name) => table.getByRole('columnheader', { name })

    // Orden inicial: valor de mercado descendente.
    await expect(header(/Valor de mercado/)).toHaveAttribute('aria-sort', 'descending')
    await expect(firstColumn(page).first()).toHaveText('AAPL')

    const price = table.getByRole('button', { name: 'Precio' })
    await price.focus()
    await page.keyboard.press('Enter')
    // Numérica: la primera activación ordena de mayor a menor.
    await expect(header(/Precio/)).toHaveAttribute('aria-sort', 'descending')
    await expect(header(/Valor de mercado/)).not.toHaveAttribute('aria-sort', /.+/)
    await expect(firstColumn(page).first()).toHaveText('MSFT')

    await page.keyboard.press('Space')
    await expect(header(/Precio/)).toHaveAttribute('aria-sort', 'ascending')
    await expect(firstColumn(page).first()).toHaveText('CEMEXCPO.MX')

    // Los faltantes (s/d) van al final en las dos direcciones.
    const ytd = table.getByRole('button', { name: 'En el año' })
    await ytd.focus()
    await page.keyboard.press('Enter')
    await expect(firstColumn(page).last()).toHaveText('FUNO11.MX')
    await page.keyboard.press('Enter')
    await expect(firstColumn(page).last()).toHaveText('FUNO11.MX')

    // Activación de fila: Tab llega al botón de la primera celda y Enter la abre.
    const row = table.getByRole('button', { name: 'Abrir WALMEX.MX, Walmart de México' })
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: 'Avisos', exact: true })).toContainText('Abrirías WALMEX.MX')
  })

  test('InfoTip: se abre con Enter, liga a /aprender y Esc regresa el foco', async ({ page, baseURL }) => {
    await openGallery(page, baseURL)
    const trigger = page.getByRole('button', { name: 'Qué es Índice de Sharpe' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const pop = page.getByRole('dialog', { name: 'Índice de Sharpe' })
    await expect(pop).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(pop.getByRole('link', { name: 'Ver más sobre Índice de Sharpe' })).toHaveAttribute('href', '/aprender/sharpe')
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('DataStatus: dice respaldo y dato viejo en la insignia y el detalle', async ({ page, baseURL }) => {
    await openGallery(page, baseURL)
    const badge = page.getByRole('button', { name: /^Respaldo: FRED · Dato del 18 sep/ })
    await expect(badge).toBeVisible()
    await badge.click()
    const pop = page.getByRole('dialog', { name: 'Estado del dato' })
    await expect(pop).toBeVisible()
    await expect(pop).toContainText('fuente de respaldo, dato viejo')
    // Un segundo clic en el mismo botón lo cierra (no lo cierra y lo vuelve a abrir).
    await badge.click()
    await expect(pop).toBeHidden()
  })
})

test('aviso: borrar con confirmación y Deshacer lo regresa, anunciado con aria-live', async ({ page, baseURL }) => {
  await openGallery(page, baseURL)
  const count = page.getByTestId('moves-count')
  await expect(count).toHaveText('3 movimientos')
  const region = page.getByRole('region', { name: 'Avisos', exact: true })
  await expect(region.locator('[aria-live="polite"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Borrar Compra de 100 WALMEX.MX' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click()
  await expect(count).toHaveText('2 movimientos')
  await expect(region).toContainText('Movimiento borrado')

  await region.getByRole('button', { name: 'Deshacer' }).click()
  await expect(count).toHaveText('3 movimientos')
  await expect(page.getByRole('button', { name: 'Borrar Compra de 100 WALMEX.MX' })).toBeVisible()
  await expect(region).toContainText('Movimiento restaurado')
  await expect(region).not.toContainText('Movimiento borrado')
})

test('InlineLink: acento y subrayado; la externa abre otra pestaña con rel seguro y lo avisa', async ({ page, baseURL }) => {
  await openGallery(page, baseURL)
  const inner = page.getByRole('link', { name: 'metodología de la volatilidad' })
  await expect(inner).toHaveAttribute('href', '/aprender/volatilidad')
  await expect(inner).not.toHaveAttribute('target', /./)
  const outer = page.getByRole('link', { name: 'sitio de Banxico (se abre en otra pestaña)' })
  await expect(outer).toHaveAttribute('target', '_blank')
  await expect(outer).toHaveAttribute('rel', 'noopener noreferrer')
  const look = await inner.evaluate((el) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.body.append(probe)
    const accent = getComputedStyle(probe).color
    probe.remove()
    const cs = getComputedStyle(el)
    return { color: cs.color, accent, line: cs.textDecorationLine }
  })
  expect(look.color, 'color de acento').toBe(look.accent)
  expect(look.line, 'subrayada: no depende solo del color').toBe('underline')
  // Con teclado se llega y se sigue con Enter, como cualquier liga.
  await inner.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/aprender\/volatilidad$/)
})

test('.kz-page: medianil de 16 px en teléfono y 24 px desde 820 px, con tope --content-max', async ({ page, baseURL }, testInfo) => {
  await openGallery(page, baseURL)
  const main = page.locator('main.kz-page')
  await expect(main).toHaveCount(1)
  const css = await main.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { left: cs.paddingLeft, right: cs.paddingRight, max: cs.maxWidth, token: getComputedStyle(document.documentElement).getPropertyValue('--content-max').trim() }
  })
  const gutter = testInfo.project.name === 'mobile' ? '16px' : '24px'
  expect(css).toEqual({ left: gutter, right: gutter, max: css.token, token: '1440px' })
  // En el corte exacto ya es de 24 px, y un píxel antes sigue en 16.
  await page.setViewportSize({ width: 820, height: 900 })
  await expect.poll(() => main.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('24px')
  await page.setViewportSize({ width: 819, height: 900 })
  await expect.poll(() => main.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('16px')
})

test('sin scroll horizontal de página; la tabla hace scroll dentro de su marco', async ({ page, baseURL }, testInfo) => {
  for (const theme of THEMES) {
    await openGallery(page, baseURL, theme)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `scroll horizontal de página en tema ${theme}`).toBeLessThanOrEqual(0)
  }
  const scroller = tableCard(page).locator('.kz-table-scroll')
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  if (testInfo.project.name === 'mobile') {
    expect(scrollWidth).toBeGreaterThan(clientWidth)
    // Con scroll, el marco entra al orden de tabulación con nombre (región de la tabla).
    await expect(scroller).toHaveAttribute('tabindex', '0')
    await expect(scroller).toHaveAttribute('role', 'region')
    // La primera columna se queda fija al desplazar.
    const before = await firstColumn(page).first().boundingBox()
    await scroller.evaluate((el) => el.scrollTo({ left: 300 }))
    const after = await firstColumn(page).first().boundingBox()
    expect(Math.round(after?.x ?? -1)).toBe(Math.round(before?.x ?? -2))
  }
})
