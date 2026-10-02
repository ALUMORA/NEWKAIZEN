// Tipos JSDoc del centro de tasas (V5TS). Son la forma de las respuestas de kaizen_api/schemas.py
// (CurvesResponse, CurveSpreadsResponse, MoneyMarketResponse, ExpectationsResponse). Todo
// rendimiento es fracción y todo cambio o diferencial va en pb.

/**
 * @typedef {import('../../lib/api/types.js').Meta} Meta
 * @typedef {'mx' | 'us'} RatesCountry
 * @typedef {'curvas' | 'dinero' | 'expectativas'} RatesTab
 *
 * @typedef {object} CurveNode
 * @property {number} tenorDays
 * @property {string} label
 * @property {number | null} value
 * @property {string | null} asOf
 * @property {string} seriesId
 * @property {'cetes' | 'bonoM' | 'udibono' | 'ust'} instrument
 *
 * @typedef {{ tenorDays: number, value: number | null, asOf: string | null }} CurvePoint
 * @typedef {{ tenorDays: number, value: number | null, asOf: string | null, seriesId: string }} RealCurveNode
 * @typedef {{ tenorDays: number, value: number | null, simpleBp: number | null, nominalAsOf: string | null,
 *   realAsOf: string | null, dateGapDays: number | null }} BreakevenNode
 *
 * @typedef {object} CurvesResponse
 * @property {RatesCountry} country
 * @property {CurveNode[]} nodes
 * @property {Partial<Record<'1w' | '1m' | '1y', CurvePoint[]>>} compare
 * @property {RealCurveNode[]} real
 * @property {BreakevenNode[]} breakeven
 * @property {Meta} meta
 *
 * @typedef {object} CurveSpreadRow
 * @property {number} tenorYears
 * @property {string} mxSeriesId
 * @property {string} usSeriesId
 * @property {number | null} mx
 * @property {number | null} us
 * @property {number | null} spreadBp
 * @property {string | null} mxAsOf
 * @property {string | null} usAsOf
 * @property {number | null} dateGapDays
 * @property {boolean} asOfMismatch
 *
 * @typedef {{ rows: CurveSpreadRow[], history10y: { dates: string[], valuesBp: (number | null)[] }, meta: Meta }} CurveSpreadsResponse
 *
 * @typedef {object} MoneyMarketRow
 * @property {string} id
 * @property {string} label
 * @property {'MX' | 'US'} country
 * @property {number | null} value
 * @property {'act/360 simple' | 'overnight' | 'cmt base bono'} convention
 * @property {string | null} asOf
 * @property {number | null} change1dBp
 * @property {number | null} change1wBp
 * @property {number | null} change1mBp
 * @property {string} seriesId
 * @property {string} source
 * @property {boolean} stale
 *
 * @typedef {{ rows: MoneyMarketRow[], mxChanges: { id: string, change1wBp: number | null, change1mBp: number | null }[], meta: Meta }} MoneyMarketResponse
 *
 * @typedef {object} SurveyItem
 * @property {'inflationT' | 'inflationT1' | 'gdpT' | 'fxT' | 'fxT1'} id
 * @property {string} label
 * @property {number | null} year
 * @property {number | null} mean
 * @property {number | null} median
 * @property {'fraction' | 'mxnPerUsd'} unit
 * @property {string | null} seriesIdMean
 * @property {string | null} seriesIdMedian
 * @property {boolean} verified
 *
 * @typedef {object} ExpectationsResponse
 * @property {{ surveyDate: string | null, yearT: number | null, items: SurveyItem[] }} survey
 * @property {{ cetes28: number | null, observedInflation: number | null, exPost: number | null,
 *   expectedInflation: number | null, exAnte: number | null }} realRates
 * @property {{ mx: { fromDays: number, toDays: number, rate: number | null, vsTargetBp: number | null }[],
 *   us: { fromDays: number, toDays: number, rate: number | null, vsDffBp: number | null, note: string }[] }} impliedForwards
 * @property {Meta} meta
 *
 * @typedef {object} RateTableRow  renglón de la tabla de mercado de dinero (une /v2/rates/mx y /v2/money-market)
 * @property {string} id
 * @property {string} label
 * @property {'MX' | 'US'} country
 * @property {number | null} value
 * @property {string} convention
 * @property {string | null} asOf
 * @property {number | null} change1dBp
 * @property {number | null} change1wBp
 * @property {number | null} change1mBp
 * @property {string} seriesId
 */

export {}
