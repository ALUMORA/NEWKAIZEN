// Viewports y opciones de contexto comunes de playwright.config.js.
import { devices } from '@playwright/test'

// Locale y zona fijos: la app formatea horas y fechas con toLocale*("es-MX") y sin esto la
// prueba cambia según la máquina (en CI la zona es UTC).
export const COMMON_CONTEXT = {
  locale: 'es-MX',
  timezoneId: 'America/Mexico_City',
  colorScheme: /** @type {const} */ ('light'),
}

// 1440x900 y 390x844 son los dos anchos obligatorios del proyecto.
export const DESKTOP = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
}

// Pixel 7 (isMobile, hasTouch, UA de Android) pero con el viewport de 390x844.
export const MOBILE = {
  ...devices['Pixel 7'],
  viewport: { width: 390, height: 844 },
}
