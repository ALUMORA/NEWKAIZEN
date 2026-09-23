// Baseline visual del CONTENIDO de la app LEGADA (src/legacy/App.legacy.jsx): una captura por tab,
// en escritorio (1440x900) y en móvil (390x844). Es la referencia contra la que se compara la app
// nueva; no se regenera salvo que el legado cambie a propósito.
//
// Desde C3 el legado va incrustado en el shell nuevo (barra lateral, barra superior, pie y barra
// inferior de la app nueva), así que se captura solo la región de contenido: la caja de contenido
// de .workspace-page, sin su relleno, en toda su altura. El cromo lo cuida e2e/shell.spec.js.
// La tab se cambia con la URL (pushState + popstate, sin recargar), como lo hace el shell.
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
  readLegacyMeta,
  scrollToTop,
  trackNetwork,
  waitForSettled,
} from './support/legacy.js'
import { LEGACY_TAB_PATHS } from '../src/app/legacyTabs.js'

/** Cromo fijo del shell que una captura de página completa pinta encima del contenido. */
const HIDE_FIXED_CHROME = '.kz-bottom { visibility: hidden !important; }'

/**
 * Lleva el legado a otra tab sin recargar: la misma navegación del lado del cliente que hace el
 * shell (react-router escucha popstate), así el Workspace sigue montado como con el clic de antes.
 * @param {import('@playwright/test').Page} page
 * @param {string} path
 */
async function goClientSide(page, path) {
  await page.evaluate((to) => {
    history.pushState({}, '', to)
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, path)
  await page.waitForURL((url) => url.pathname === path)
}

/**
 * Caja de contenido de .workspace-page en coordenadas de la página (sin relleno), en píxeles
 * enteros para que el recorte no dependa de medios píxeles.
 * @param {import('@playwright/test').Page} page
 */
async function contentClip(page) {
  return page.evaluate(() => {
    const el = /** @type {HTMLElement} */ (document.querySelector('.workspace-page'))
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const px = (v) => Number.parseFloat(v) || 0
    const x = Math.round(r.left + scrollX + px(cs.paddingLeft))
    const y = Math.round(r.top + scrollY + px(cs.paddingTop))
    const width = Math.round(r.width - px(cs.paddingLeft) - px(cs.paddingRight))
    const height = Math.floor(r.height - px(cs.paddingTop) - px(cs.paddingBottom))
    return { x, y, width, height }
  })
}

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
    await expect(page.locator('.app-shell[data-embedded]')).toBeAttached()
    if (tab.id !== 'news') await goClientSide(page, LEGACY_TAB_PATHS[tab.id])
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
    const clip = await contentClip(page)
    // La barra inferior del shell es fija: en una captura de página completa queda pintada a la
    // altura de la primera pantalla, encima del contenido. Se esconde para la captura.
    await page.addStyleTag({ content: HIDE_FIXED_CHROME })
    await expect(page).toHaveScreenshot(`legacy-${tab.slug}.png`, { fullPage: true, clip, maxDiffPixels: 150 })
  })
}
