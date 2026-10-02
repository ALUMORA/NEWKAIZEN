// Rayos X del portafolio (V5PF): exposición por sector y por emisora sumando las acciones directas y
// lo que hay dentro de cada ETF (cálculo por transparencia), y traslape entre ETF. Módulo puro.
//
// - Sector: una acción directa suma su peso completo a su sector; un ETF suma peso × peso del sector
//   dentro del fondo. Lo que el fondo no reparte en sectores (bonos, efectivo) no se inventa.
// - Emisora: directa + peso del ETF × peso de la emisora entre sus 10 principales. Yahoo solo da las
//   10 principales, así que la exposición por emisora y el traslape son cotas inferiores.
// - Traslape entre dos ETF: suma, sobre las emisoras que comparten en sus 10 principales, del menor
//   de los dos pesos.

/** @typedef {import('../types.js').FundResponse} FundResponse */
/** @typedef {import('../types.js').XrayHolding} XrayHolding */
/** @typedef {import('../types.js').Lookthrough} Lookthrough */
/** @typedef {import('../types.js').IssuerExposure} IssuerExposure */

/**
 * ETF de la BMV que Yahoo no cubre: no se piden a /v2/funds porque responden 404 por contrato.
 * Espejo de la llave bmvWithoutData de kaizen_api/data/sic_etf_map.json; si esa lista cambia, esta
 * también.
 */
export const BMV_ETF_SIN_DATOS = Object.freeze(['NAFTRAC.MX'])

/** @param {string | null | undefined} symbol */
export const isBmvEtfWithoutData = (symbol) => BMV_ETF_SIN_DATOS.includes(String(symbol ?? '').toUpperCase())

/** Tipos de instrumento que se abren por transparencia. */
export const FUND_TYPES = Object.freeze(['etf', 'fund'])

/** @param {string | null | undefined} type */
export const isFundType = (type) => FUND_TYPES.includes(String(type ?? '').toLowerCase())

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export const NO_SECTOR = 'Sin sector'

/** Llave de una emisora dentro de un fondo: la clave si viene, si no el nombre. */
export function holdingKey(/** @type {{ symbol: string | null, name: string | null }} */ h) {
  const s = h.symbol ? String(h.symbol).toUpperCase().trim() : ''
  if (s) return s
  return h.name ? `nombre:${String(h.name).toLowerCase().trim()}` : ''
}

/**
 * @param {XrayHolding[]} holdings pesos como fracción del valor invertido
 * @param {Record<string, FundResponse | null | undefined>} funds datos por símbolo del ETF; null o
 *   ausente = sin datos de composición
 * @returns {Lookthrough}
 */
export function lookthrough(holdings, funds) {
  /** @type {Map<string, number>} */
  const sectors = new Map()
  /** @type {Map<string, IssuerExposure>} */
  const issuers = new Map()
  let sectorCovered = 0
  let issuerCovered = 0
  /** @type {string[]} */
  const uncoveredFunds = []

  const addIssuer = (key, symbol, name, w, direct, fundSymbol) => {
    if (!key || !isNum(w) || w === 0) return
    const cur = issuers.get(key) ?? { key, symbol, name, weight: 0, direct: 0, viaFunds: 0, funds: [] }
    cur.weight += w
    if (direct) cur.direct += w
    else {
      cur.viaFunds += w
      if (fundSymbol && !cur.funds.includes(fundSymbol)) cur.funds.push(fundSymbol)
    }
    if (!cur.name && name) cur.name = name
    if (!cur.symbol && symbol) cur.symbol = symbol
    issuers.set(key, cur)
  }

  for (const h of holdings) {
    if (!isNum(h.weight) || h.weight <= 0) continue
    if (h.kind === 'direct') {
      const sector = h.sector || NO_SECTOR
      sectors.set(sector, (sectors.get(sector) ?? 0) + h.weight)
      sectorCovered += h.weight
      issuerCovered += h.weight
      addIssuer(String(h.symbol).toUpperCase(), h.symbol, h.name ?? null, h.weight, true, null)
      continue
    }
    const fund = funds[h.symbol]
    if (!fund) {
      uncoveredFunds.push(h.symbol)
      continue
    }
    const fundSectors = (fund.sectors ?? []).filter((s) => isNum(s.weight) && s.weight > 0)
    if (fundSectors.length) {
      sectorCovered += h.weight
      for (const s of fundSectors) sectors.set(s.sector, (sectors.get(s.sector) ?? 0) + h.weight * s.weight)
    }
    let topSum = 0
    for (const t of fund.topHoldings ?? []) {
      if (!isNum(t.weight) || t.weight <= 0) continue
      topSum += t.weight
      addIssuer(holdingKey(t), t.symbol, t.name, h.weight * t.weight, false, h.symbol)
    }
    issuerCovered += h.weight * Math.min(1, topSum)
  }

  return {
    sectors: [...sectors.entries()].map(([sector, weight]) => ({ sector, weight })).sort((a, b) => b.weight - a.weight),
    issuers: [...issuers.values()].sort((a, b) => b.weight - a.weight),
    coverage: { sectors: sectorCovered, issuers: issuerCovered, uncoveredFunds },
  }
}

/**
 * Traslape entre dos fondos sobre sus 10 principales: suma de los mínimos de los pesos compartidos.
 * Es cota inferior: lo que no está en los 10 principales de alguno no se ve.
 * @param {FundResponse | null | undefined} a
 * @param {FundResponse | null | undefined} b
 * @returns {number | null}
 */
export function overlap(a, b) {
  if (!a || !b) return null
  /** @type {Map<string, number>} */
  const wa = new Map()
  for (const t of a.topHoldings ?? []) if (isNum(t.weight) && holdingKey(t)) wa.set(holdingKey(t), (wa.get(holdingKey(t)) ?? 0) + t.weight)
  let sum = 0
  /** @type {Map<string, number>} */
  const wb = new Map()
  for (const t of b.topHoldings ?? []) if (isNum(t.weight) && holdingKey(t)) wb.set(holdingKey(t), (wb.get(holdingKey(t)) ?? 0) + t.weight)
  for (const [k, w] of wb) if (wa.has(k)) sum += Math.min(w, /** @type {number} */ (wa.get(k)))
  return sum
}

/**
 * Matriz de traslape entre los fondos con datos. La diagonal es lo que suman los 10 principales del
 * propio fondo (el traslape de un fondo consigo mismo con la misma regla).
 * @param {{ symbol: string, fund: FundResponse | null | undefined }[]} list
 * @returns {import('../types.js').OverlapMatrix}
 */
export function overlapMatrix(list) {
  const withData = list.filter((f) => f.fund)
  return {
    labels: withData.map((f) => f.symbol),
    values: withData.map((f) => withData.map((g) => overlap(f.fund, g.fund))),
  }
}
