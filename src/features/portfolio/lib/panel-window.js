// Recorta un panel del API (fechas y precios alineados) a los últimos N años. El API solo acepta
// los periodos del contrato (1y, 2y, 5y...): para medir "los últimos tres años" se pide 5y y se
// recorta aquí.

/**
 * @template {{ dates: string[], prices: Record<string, number[]> }} P
 * @param {P | undefined} panel
 * @param {number} years
 * @returns {P | undefined}
 */
export function lastYears(panel, years) {
  if (!panel || !panel.dates.length) return panel
  const last = panel.dates[panel.dates.length - 1]
  const cut = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`
  const start = panel.dates.findIndex((d) => d > cut)
  if (start <= 0) return panel
  const prices = Object.fromEntries(Object.entries(panel.prices).map(([k, v]) => [k, v.slice(start)]))
  return { ...panel, dates: panel.dates.slice(start), prices }
}
