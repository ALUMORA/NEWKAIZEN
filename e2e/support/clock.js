// Reloj fijo para specs deterministas. setFixedTime hace que Date.now() y new Date() devuelvan
// siempre el mismo instante, pero deja correr los timers (setTimeout/setInterval) con tiempo
// real, así que la app no se congela. Llamarlo ANTES de page.goto.
//
//   await fixTime(page, '2026-09-22T14:30:00.000Z')

/**
 * @param {import('@playwright/test').Page} page
 * @param {string | number | Date} iso instante ISO (con zona) o epoch en ms
 */
export async function fixTime(page, iso) {
  const when = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(when.getTime())) throw new Error(`fixTime: fecha inválida ${String(iso)}`)
  await page.clock.setFixedTime(when)
  return when
}

/**
 * Variante con reloj controlable: los timers también son falsos y avanzan solo con
 * page.clock.runFor / fastForward. Útil para probar refrescos periódicos sin esperar.
 * @param {import('@playwright/test').Page} page
 * @param {string | number | Date} iso
 */
export async function installClock(page, iso) {
  const when = iso instanceof Date ? iso : new Date(iso)
  await page.clock.install({ time: when })
  return when
}
