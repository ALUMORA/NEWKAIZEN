// Baseline visual de la app LEGADA (src/App.jsx): una captura de página completa por tab, en
// escritorio (1440x900) y en móvil (390x844). Es la referencia contra la que se compara la app
// nueva; no se regenera salvo que el legado cambie a propósito.
//
// Determinismo:
// - El API sale de un HAR grabado (npm run fixtures:legacy). Lo que no esté grabado se aborta
//   y cualquier otro origen externo se bloquea: las guardas lo marcan y la prueba falla.
// - El reloj se fija a la hora de la grabación (meta.json), así "hace 3 h" y la hora de
//   actualización salen iguales siempre. Zona y locale fijos en playwright.config.js.
// - Se espera a que no haya requests en vuelo, spinners ni textos de carga, y se regresa el
//   scroll arriba antes de capturar (el scroll persiste entre tabs).
import { test, expect } from '@playwright/test'
import { attachGuards } from './support/guards.js'
import { fixTime } from './support/clock.js'
import { blockExternalRequests, replayHar } from './support/mockApi.js'
import {
  LEGACY_HAR_URL,
  LEGACY_TABS,
  legacyHarPath,
  openLegacyTab,
  readLegacyMeta,
  scrollToTop,
  trackNetwork,
  waitForSettled,
} from './support/legacy.js'

const meta = readLegacyMeta()

for (const tab of LEGACY_TABS) {
  test(`legado · ${tab.desktop}`, async ({ page, baseURL }, testInfo) => {
    const viewport = testInfo.project.name.endsWith('mobile') ? 'mobile' : 'desktop'
    const recordedAt = meta.recordedAt[viewport]
    expect(recordedAt, `meta.json no tiene recordedAt.${viewport}: corre npm run fixtures:legacy`).toBeTruthy()

    const guards = attachGuards(page)
    // Orden importa: la última ruta registrada se evalúa primero, así que el HAR atiende lo
    // suyo y el bloqueo se queda con todo lo demás que no sea el dev server.
    await blockExternalRequests(page, [/** @type {string} */ (baseURL)])
    await replayHar(page, legacyHarPath(viewport), { url: LEGACY_HAR_URL })
    await fixTime(page, recordedAt)
    const net = trackNetwork(page)

    await page.goto('/')
    if (tab.id !== 'news') await openLegacyTab(page, tab, viewport === 'mobile')
    // Si no se estabiliza, casi siempre es porque algo no estaba en el HAR: las guardas dan la
    // causa exacta (request abortado, 4xx, error de consola) antes que el timeout genérico.
    await waitForSettled(page, net).catch((err) => {
      guards.assertClean()
      throw err
    })
    await scrollToTop(page)

    // Guardas antes de la captura: si algo falló, su causa exacta sale primero.
    guards.assertClean()
    // El baseline es determinista (HAR + reloj fijo), así que el presupuesto va en píxeles
    // absolutos: 0.02 de proporción dejaba pasar un cambio real de 9,311 píxeles.
    await expect(page).toHaveScreenshot(`legacy-${tab.slug}.png`, { fullPage: true, maxDiffPixels: 150 })
  })
}
