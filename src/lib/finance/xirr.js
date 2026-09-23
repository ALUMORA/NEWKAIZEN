// Tasa interna de retorno con fechas irregulares (XIRR), la medida ponderada por dinero del
// portafolio. Convención Actual/365, la misma que usan Excel y Google Sheets:
//
//   VPN(r) = Σ aᵢ (1 + r)^(−dᵢ/365),  con dᵢ = días entre la primera fecha y la fecha i
//
// Se resuelve con Newton y, si Newton se sale del dominio o no converge, con bisección sobre un
// intervalo que se busca en escala geométrica. Módulo puro: sin React, sin fetch y sin Date.now().

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
const DAYS_PER_YEAR = 365

/** Tasa mínima admisible. Por debajo de −1 el descuento deja de tener sentido. */
const MIN_RATE = -0.999_999_999
/** Tasa máxima que se explora al buscar el intervalo de bisección. */
const MAX_RATE = 1e6

/** @typedef {{ date: string | Date, amount: number }} CashFlow */
/** @typedef {{ t: number, amount: number }} NormalFlow */

/** @param {unknown} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Milisegundos UTC de una fecha AAAA-MM-DD o de un Date.
 * @param {string | Date} value
 * @returns {number | null}
 */
function timeOf(value) {
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(t) ? null : t
}

/**
 * Días exactos entre dos fechas (Actual), contando de medianoche UTC a medianoche UTC.
 * @param {string | Date} from
 * @param {string | Date} to
 * @returns {number | null}
 */
export function dayCount(from, to) {
  const a = timeOf(from)
  const b = timeOf(to)
  if (a === null || b === null) return null
  return (b - a) / DAY_MS
}

/**
 * Normaliza los flujos a {t (años Actual/365 desde el primero), amount}, ordenados por fecha.
 * Devuelve null si el arreglo no sirve: menos de dos flujos, una fecha inválida o un monto que no
 * es número finito.
 * @param {CashFlow[]} cashflows
 * @returns {NormalFlow[] | null}
 */
function normalize(cashflows) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null
  /** @type {{ time: number, amount: number }[]} */
  const rows = []
  for (const flow of cashflows) {
    if (!flow || typeof flow !== 'object') return null
    const time = timeOf(flow.date)
    if (time === null || !isNum(flow.amount)) return null
    rows.push({ time, amount: flow.amount })
  }
  rows.sort((a, b) => a.time - b.time)
  const t0 = rows[0].time
  return rows.map((row) => ({ t: (row.time - t0) / DAY_MS / DAYS_PER_YEAR, amount: row.amount }))
}

/**
 * Valor presente neto de los flujos normalizados a una tasa anual.
 * @param {number} rate
 * @param {NormalFlow[]} flows
 * @returns {number}
 */
function npvOf(rate, flows) {
  const base = 1 + rate
  let acc = 0
  for (const { t, amount } of flows) acc += amount / base ** t
  return acc
}

/**
 * Derivada del VPN respecto a la tasa.
 * @param {number} rate
 * @param {NormalFlow[]} flows
 * @returns {number}
 */
function dNpvOf(rate, flows) {
  const base = 1 + rate
  let acc = 0
  for (const { t, amount } of flows) acc -= (t * amount) / base ** (t + 1)
  return acc
}

/**
 * Valor presente neto con fechas (Actual/365), descontando desde la fecha más temprana.
 * Devuelve null si los flujos no sirven o si la tasa no es mayor que −1.
 * @param {number} rate tasa anual como fracción (0.10 = 10 %)
 * @param {CashFlow[]} cashflows al menos 2 flujos con fecha y monto
 * @returns {number | null}
 */
export function xnpv(rate, cashflows) {
  if (!isNum(rate) || rate <= -1) return null
  const flows = normalize(cashflows)
  if (flows === null) return null
  return npvOf(rate, flows)
}

/**
 * Busca un intervalo [lo, hi] donde el VPN cambie de signo, explorando en escala geométrica hacia
 * arriba y acercándose a −1 hacia abajo.
 * @param {NormalFlow[]} flows
 * @returns {{ lo: number, hi: number } | null}
 */
function bracket(flows) {
  const grid = [0]
  for (let step = 0.01; step <= MAX_RATE; step *= 2) grid.push(step)
  for (let step = 0.01; step < 1; step *= 2) grid.push(-step)
  grid.push(MIN_RATE)
  grid.sort((a, b) => a - b)

  let prevRate = grid[0]
  let prevValue = npvOf(prevRate, flows)
  if (prevValue === 0) return { lo: prevRate, hi: prevRate }
  for (let i = 1; i < grid.length; i += 1) {
    const rate = grid[i]
    const value = npvOf(rate, flows)
    if (!Number.isFinite(value)) continue
    if (value === 0) return { lo: rate, hi: rate }
    if (prevValue * value < 0) return { lo: prevRate, hi: rate }
    prevRate = rate
    prevValue = value
  }
  return null
}

/**
 * Cuántas veces cambian de signo los flujos, ya ordenados por fecha. Con más de un cambio, la
 * ecuación del XIRR puede tener varias raíces y `xirr` devuelve aquella a la que llegue desde el
 * punto de partida, así que la pantalla no debe presentarla como única. Los ceros no cuentan.
 * Devuelve 0 cuando los flujos no sirven o no cambian de signo.
 * @param {CashFlow[]} cashflows
 * @returns {number}
 */
export function signChanges(cashflows) {
  const flows = normalize(cashflows)
  if (flows === null) return 0
  let changes = 0
  let previous = 0
  for (const flow of flows) {
    const sign = flow.amount > 0 ? 1 : flow.amount < 0 ? -1 : 0
    if (sign === 0) continue
    if (previous !== 0 && sign !== previous) changes += 1
    previous = sign
  }
  return changes
}

/**
 * Tasa interna de retorno con fechas irregulares (XIRR), Actual/365.
 *
 * Mínimo: 2 flujos con fecha válida, con al menos un monto positivo y uno negativo. Devuelve null
 * (nunca 0 ni NaN) si falta algo de eso, si no existe cambio de signo en el VPN o si ni Newton ni
 * la bisección convergen. Un empate de fechas no estorba: los flujos del mismo día se suman solos
 * al descontarse con el mismo exponente.
 *
 * TAMBIÉN DEVUELVE NULL POR TOPE, que es una causa distinta de "no converge": la búsqueda se
 * limita a MAX_RATE = 1e6, o sea 100,000,000 % anual, así que una anualización por arriba de eso
 * sale null aunque la raíz exista. Medido: −100 hoy y +10,000 a 30 días devuelve null.
 *
 * VARIAS SOLUCIONES: cuando los flujos cambian de signo más de una vez, la ecuación puede tener
 * más de una tasa que la satisface, y la que se devuelve depende del punto de partida. Medido con
 * −1000 (2020), +2600 (2021) y −1680 (2022): con guess .1 devuelve .203752 y con guess .3 devuelve
 * .390834, y las dos son raíces de verdad (xnpv da 0 y 1.1e−13). No es un error del solucionador,
 * es la ambigüedad propia de la TIR. Quien lo pinte no debe presentarlo como único cuando la serie
 * alterna aportaciones y retiros; `signChanges` dice cuántos cambios de signo hubo, justo para
 * poder avisarlo. Ese helper se exporta desde este módulo; el barril de `index.js` es de A1, así
 * que quien lo mantenga decide si también lo saca por ahí.
 *
 * @param {CashFlow[]} cashflows [{ date: 'AAAA-MM-DD' o Date, amount }]; negativo = sale dinero
 * @param {{ guess?: number, tolerance?: number, maxIterations?: number }} [options]
 * @returns {number | null} tasa anual efectiva como fracción, o null
 */
export function xirr(cashflows, options = {}) {
  const guess = isNum(options.guess) ? /** @type {number} */ (options.guess) : 0.1
  const tolerance = isNum(options.tolerance) ? /** @type {number} */ (options.tolerance) : 1e-12
  const maxIterations = isNum(options.maxIterations) ? /** @type {number} */ (options.maxIterations) : 100

  const flows = normalize(cashflows)
  if (flows === null) return null
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null

  const scale = flows.reduce((acc, f) => acc + Math.abs(f.amount), 0)
  const target = Math.max(tolerance, tolerance * scale)

  // Newton, con el dominio acotado a r > −1. Se corta por el tamaño del paso, no por el residuo,
  // para no quedarse corto cuando los montos son grandes; el residuo solo sirve de comprobación.
  let rate = guess > MIN_RATE ? guess : 0.1
  for (let i = 0; i < maxIterations; i += 1) {
    const value = npvOf(rate, flows)
    if (!Number.isFinite(value)) break
    const slope = dNpvOf(rate, flows)
    if (!Number.isFinite(slope) || slope === 0) break
    const next = rate - value / slope
    if (!Number.isFinite(next) || next <= MIN_RATE || next > MAX_RATE) break
    const step = Math.abs(next - rate)
    rate = next
    if (step < 1e-14 * Math.max(1, Math.abs(rate))) {
      if (Math.abs(npvOf(rate, flows)) < target) return rate
      break
    }
  }

  // Respaldo: bisección sobre un intervalo con cambio de signo.
  const span = bracket(flows)
  if (span === null) return null
  let lo = span.lo
  let hi = span.hi
  if (lo === hi) return lo
  let flo = npvOf(lo, flows)
  for (let i = 0; i < 400 && hi - lo > 1e-15; i += 1) {
    const mid = (lo + hi) / 2
    const fmid = npvOf(mid, flows)
    if (fmid === 0) return mid
    if (flo * fmid < 0) {
      hi = mid
    } else {
      lo = mid
      flo = fmid
    }
  }
  const root = (lo + hi) / 2
  return Number.isFinite(root) ? root : null
}

/**
 * Rendimiento ponderado por dinero de un portafolio: los flujos externos con su signo (aportación
 * negativa, retiro positivo) más el valor final como flujo positivo en la fecha de corte.
 * Es un envoltorio de `xirr` para no repetir el armado en cada feature.
 * Devuelve null con menos de un flujo externo o si el valor final no es un número finito.
 * @param {{ date: string, amount: number }[]} flows aportaciones en positivo, retiros en negativo
 * @param {number} endValue valor del portafolio en `endDate`
 * @param {string} endDate fecha de corte AAAA-MM-DD
 * @param {{ guess?: number }} [options]
 * @returns {number | null}
 */
export function moneyWeightedReturn(flows, endValue, endDate, options = {}) {
  if (!Array.isArray(flows) || flows.length === 0 || !isNum(endValue)) return null
  /** @type {CashFlow[]} */
  const cashflows = []
  for (const flow of flows) {
    if (!flow || !isNum(flow.amount)) return null
    cashflows.push({ date: flow.date, amount: -flow.amount })
  }
  cashflows.push({ date: endDate, amount: endValue })
  return xirr(cashflows, options)
}
