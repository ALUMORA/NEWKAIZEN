// Piezas compartidas de las páginas de mercados (F2): formato por unidad y aviso de notas del API.
import { fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'

/** Glosario por identificador de serie (coincidencia por fragmento). */
const TERMS = [
  ['objetivo', 'tasa-objetivo'],
  ['target', 'tasa-objetivo'],
  ['tiie', 'tiie'],
  ['cetes', 'cetes'],
  ['inpc', 'inpc'],
  ['udi', 'udi'],
  ['fix', 'tipo-de-cambio-fix'],
  ['vix', 'vix'],
  ['dxy', 'dxy'],
  ['spread10y2y', 'spread-10a-2a'],
]

/** @param {string} id @returns {string | undefined} */
export function termFor(id) {
  const low = String(id ?? '').toLowerCase()
  return TERMS.find(([frag]) => low.includes(frag))?.[1]
}

/** Valor de una serie según su unidad del API: fracción, índice, pesos o puntos base. */
export function fmtByUnit(value, unit, id = '') {
  if (unit === 'fraction') return fmtPct(value, { decimals: 2 })
  if (unit === 'mxn') return fmtMoney(value, 'MXN', { decimals: 4 })
  if (unit === 'bp') return `${fmtNumber(value, { decimals: 0 })} pb`
  // Índices: el INPC se publica con 3 decimales; VIX, DXY y el resto con 2.
  return fmtNumber(value, { decimals: /inpc/i.test(id) ? 3 : 2 })
}

/** Meta de DataStatus para un dato con su propia fecha y fuente dentro de una respuesta. */
export function itemStatus(item, meta) {
  return {
    asOf: item?.asOf ?? meta?.asOf ?? null,
    source: item?.source ?? meta?.source ?? '',
    delayMinutes: meta?.delayMinutes ?? null,
    stale: Boolean(item?.stale ?? meta?.stale),
    // `verified: false` es una serie que no pasó por el SIE (hoy, el Bono M de FRED): se marca como
    // respaldo aunque el resto de la respuesta venga de Banxico.
    fallback: Boolean(meta?.fallback || item?.fallback || item?.verified === false),
  }
}

/**
 * Tarjeta del dólar de /v2/fx en /mercados/mexico. null si /v2/rates/mx ya trae el FIX con valor
 * (sería la misma serie SF43718 dos veces) o si no hay dato. Solo se llama FIX si viene de Banxico:
 * el respaldo de Yahoo es el precio de mercado, no el FIX.
 * @param {any[] | undefined} rateItems @param {any} fx
 * @returns {{ label: string, sublabel: string, isFix: boolean } | null}
 */
export function fxStatSpec(rateItems, fx) {
  const hasFix = (rateItems ?? []).some((it) => it?.id === 'fix' && typeof it.value === 'number' && Number.isFinite(it.value))
  if (hasFix || !fx || typeof fx.rate !== 'number' || !Number.isFinite(fx.rate)) return null
  const isFix = fx.source === 'banxico_fix'
  return {
    label: isFix ? 'Dólar FIX' : 'Dólar en el mercado',
    sublabel: isFix ? 'Pesos por dólar. Si sube, el peso está más débil.' : 'Pesos por dólar, precio de mercado (no es el FIX). Si sube, el peso está más débil.',
    isFix,
  }
}

/**
 * Título y nombre de la serie de /v2/rates/rf. Con el respaldo de FRED la serie es interbancaria a
 * 3 meses, no CETES, y el título no puede decir otra cosa.
 * @param {{ source?: string, fallback?: boolean, tenorDays?: number | null } | undefined} rf
 */
export function rfChartText(rf) {
  if (rf?.source === 'fred_ir3tib' || rf?.fallback) {
    return {
      title: 'Tasa interbancaria a 3 meses en el tiempo (respaldo)',
      series: 'Interbancaria 3 meses',
      description: 'Respaldo mensual de la OCDE en FRED mientras no hay CETES de Banxico. No son CETES ni tiene la convención de la subasta.',
    }
  }
  const days = rf?.tenorDays ?? 28
  return {
    title: `CETES ${days} días en el tiempo`,
    series: `CETES ${days} días`,
    description: 'Rendimiento anual simple de la subasta, la tasa libre de riesgo para quien invierte en pesos.',
  }
}
