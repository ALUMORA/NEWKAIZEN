// Tipos de fondos y rayos X (V5PF): lo que manda /v2/funds/{symbol} y lo que arma
// src/features/funds/lib/lookthrough.js. Solo JSDoc: no exporta código.

/** @typedef {import('../../lib/api/types.js').Meta} Meta */

/**
 * Pesos como fracción; totalNetAssets en millones de USD cuando totalNetAssetsUnit lo dice.
 * @typedef {{
 *   symbol: string, mappedFrom: string | null, name: string | null, family: string | null,
 *   category: string | null, legalType: string | null, expenseRatio: number | null,
 *   totalNetAssets: number | null, totalNetAssetsUnit: 'usdMillions' | null, turnover: number | null,
 *   assetClasses: { stock: number | null, bond: number | null, cash: number | null, other: number | null } | null,
 *   sectors: { sector: string, weight: number }[],
 *   topHoldings: { symbol: string | null, name: string | null, weight: number }[],
 *   coverage: { topHoldingsWeight: number | null },
 *   meta: Meta,
 * }} FundResponse
 */

/**
 * Posición del portafolio para el cálculo por transparencia.
 *   kind: 'direct' (acción que se tiene directo) o 'fund' (ETF o fondo).
 *   weight: fracción del valor invertido del portafolio.
 * @typedef {{ symbol: string, name?: string | null, weight: number, kind: 'direct' | 'fund', sector?: string | null }} XrayHolding
 */

/**
 * @typedef {{ sector: string, weight: number }} SectorExposure
 * @typedef {{ key: string, symbol: string | null, name: string | null, weight: number, direct: number, viaFunds: number, funds: string[] }} IssuerExposure
 * @typedef {{
 *   sectors: SectorExposure[], issuers: IssuerExposure[],
 *   coverage: { sectors: number, issuers: number, uncoveredFunds: string[] },
 * }} Lookthrough
 * @typedef {{ labels: string[], values: (number | null)[][] }} OverlapMatrix
 */

export {}
