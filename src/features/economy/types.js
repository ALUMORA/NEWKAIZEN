// Typedefs de JSDoc de economía y calendario (V5EC), espejo de kaizen_api/schemas.py.

/**
 * @typedef {object} EconomicEvent
 * @property {string} id
 * @property {'MX' | 'US'} country
 * @property {'decision' | 'minutes' | 'release' | 'report'} kind
 * @property {string} title
 * @property {string | null} period
 * @property {string} date YYYY-MM-DD en hora del centro
 * @property {string | null} timeLocal HH:MM en America/Mexico_City
 * @property {string | null} datetimeUtc
 * @property {'curated' | 'bls'} source
 * @property {string | null} seriesId
 * @property {'fraction' | 'index' | 'thousandsPersons' | null} unit
 * @property {number | null} previous
 * @property {number | null} actual
 * @property {null} consensus
 */

/**
 * @typedef {object} EconomicCalendarResponse
 * @property {EconomicEvent[]} events
 * @property {{ banxicoUntil: string | null, fomcUntil: string | null, inegiUntil: string | null, blsUntil: string | null }} coverage
 * @property {{ banxico: { date: string, daysLeft: number } | null, fed: { date: string, daysLeft: number } | null }} nextDecisions
 * @property {object} meta
 */

/**
 * @typedef {object} MacroIndicator
 * @property {'inflation' | 'coreInflation' | 'pceCore' | 'unemployment' | 'payrolls' | 'gdpReal' | 'gdpGrowth' | 'remittances' | 'reserves' | 'wti'} id
 * @property {string} label
 * @property {'rate' | 'level'} kind
 * @property {'fraction' | 'index' | 'thousandsPersons' | 'usdMillions' | 'mxnMillions2018' | 'usdBillionsChained2017' | 'usdPerBarrel'} unit
 * @property {'monthly' | 'quarterly' | 'weekly' | 'daily'} frequency
 * @property {{ date: string, value: number } | null} last
 * @property {{ date: string, value: number } | null} previous
 * @property {number | null} changeYoY
 * @property {number | null} changeYoYBp
 * @property {{ dates: string[], values: (number | null)[] }} history
 * @property {string} seriesId
 * @property {string} source
 * @property {boolean} fallback
 * @property {boolean} stale
 * @property {string | null} nextRelease
 */

/**
 * @typedef {object} MacroWorldRow
 * @property {string} country
 * @property {string} name
 * @property {'gdpUsd' | 'gdpGrowth' | 'inflation' | 'debt'} indicator
 * @property {'usd' | 'fraction'} unit
 * @property {number | null} year
 * @property {number | null} value
 */

export {}
