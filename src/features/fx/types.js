// Typedefs JSDoc de las respuestas de tipo de cambio (V5FX) y de la encuesta de expectativas que
// usa la pantalla de cobertura. Copia de kaizen_api/schemas.py (FxMonitorResponse,
// FxCrossesResponse, FixLookupResponse, FixTableResponse, FxForwardResponse, ExpectationsResponse).
// Porcentajes, cambios y volatilidades en fracción; tipos de cambio en pesos por unidad.

/** @typedef {import('../../lib/api/types.js').Meta} Meta */
/** @typedef {import('../../lib/api/types.js').FixRule} FixRule */

/**
 * @typedef {{ d1: number | null, w1: number | null, m1: number | null, ytd: number | null, y1: number | null }} PeriodChanges
 * @typedef {{ reportDate: string, openInterest: number | null, nonCommercialNet: number | null,
 *   nonCommercialNetChange: number | null, leveragedNet: number | null, assetManagerNet: number | null }} CotPosition
 * @typedef {{ month: string, average: number | null, min: number | null, max: number | null, last: number | null }} FxMonthly
 * @typedef {{ low: number, high: number, count: number }} HistogramBin
 * @typedef {{
 *   pair: 'USDMXN',
 *   spot: { value: number, asOf: string, source: 'banxico' },
 *   range52w: { low: number | null, high: number | null, percentile: number | null },
 *   changes: PeriodChanges,
 *   changesCents: PeriodChanges,
 *   realizedVol: { d20: number | null, d60: number | null, d250: number | null },
 *   monthly: FxMonthly[],
 *   histogram: HistogramBin[],
 *   series: { dates: string[], values: (number | null)[] },
 *   cot: CotPosition | null,
 *   meta: Meta,
 * }} FxMonitorResponse
 */

/**
 * @typedef {'EURMXN' | 'JPYMXN' | 'GBPMXN' | 'CNYMXN' | 'CADMXN' | 'BRLMXN' | 'COPMXN' | 'CLPMXN' | 'ARSMXN' | 'PENMXN'} CrossPair
 * @typedef {{ pair: CrossPair, value: number | null, asOf: string | null, change1d: number | null,
 *   change1y: number | null, source: 'banxico' | 'frankfurter', provider: 'banxico' | 'ecb' | 'mezcla',
 *   fallback: boolean }} FxCrossRow
 * @typedef {{ rows: FxCrossRow[], meta: Meta }} FxCrossesResponse
 */

/**
 * @typedef {{ date: string, rule: FixRule, fixDate: string | null, value: number | null,
 *   dofPublicationDate: string | null, explanation: string, meta: Meta }} FixLookupResponse
 * @typedef {{ date: string, fixDate: string | null, value: number | null }} FixRow
 * @typedef {{ month: string, fixDate: string | null, value: number | null, average: number | null }} FixMonthEnd
 * @typedef {{ rule: FixRule, rows: FixRow[], monthEnds: FixMonthEnd[], meta: Meta }} FixTableResponse
 */

/**
 * @typedef {{ days: number, date: string, iMxn: number | null, iUsd: number | null, iMxnSeries: string,
 *   iUsdSeries: string, iMxnConvention: 'act/360 simple' | 'overnight plano',
 *   iUsdConvention: 'cmt convertida x360/365' | 'overnight plano', forward: number | null,
 *   pointsPips: number | null, carryAnnual: number | null }} ForwardRow
 * @typedef {{ spot: { value: number, asOf: string }, rows: ForwardRow[], meta: Meta }} FxForwardResponse
 */

/**
 * @typedef {{ id: 'inflationT' | 'inflationT1' | 'gdpT' | 'fxT' | 'fxT1', label: string, year: number | null,
 *   mean: number | null, median: number | null, unit: 'fraction' | 'mxnPerUsd', seriesIdMean: string | null,
 *   seriesIdMedian: string | null, verified: boolean }} SurveyItem
 * @typedef {{ survey: { surveyDate: string | null, yearT: number | null, items: SurveyItem[] },
 *   realRates: Record<string, number | null>, impliedForwards: { mx: object[], us: object[] }, meta: Meta }} ExpectationsResponse
 */

export {}
