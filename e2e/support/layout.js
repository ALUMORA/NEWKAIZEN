// Aserciones de layout compartidas por los specs.
import { expect } from '@playwright/test'

/**
 * Sin scroll a lo ancho, medido contra el ancho EMULADO (page.viewportSize) y no contra
 * window.innerWidth: en el proyecto mobile (isMobile) el viewport de diseño crece hasta que quepa
 * el contenido desbordado, así que innerWidth sube junto con scrollWidth y comparar esos dos pasa
 * sin comparar nada.
 * @param {import('@playwright/test').Page} page
 */
export async function expectNoHorizontalScroll(page) {
  const width = page.viewportSize()?.width
  if (!width) throw new Error('expectNoHorizontalScroll: la página no tiene viewport emulado')
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(innerWidth, 'el viewport de diseño no se ensancha').toBe(width)
  expect(scrollWidth, 'la página no se desplaza a lo ancho').toBeLessThanOrEqual(width)
}
