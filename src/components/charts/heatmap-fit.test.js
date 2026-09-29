import { describe, expect, it } from 'vitest'
import { COMPACT_SCALE, compactNumber, heatmapCellLevel, heatmapCellText, heatmapHeaders } from './heatmap-fit.js'
import { textWidth } from './measure.js'

describe('compactNumber: sin el cero inicial', () => {
  it('quita el cero antes del punto, con o sin signo menos', () => {
    expect(compactNumber('0.53')).toBe('.53')
    expect(compactNumber('−0.12')).toBe('−.12')
    expect(compactNumber('+0.05')).toBe('+.05')
  })
  it('no toca lo que no empieza con cero ni el dato faltante', () => {
    expect(compactNumber('1.00')).toBe('1.00')
    expect(compactNumber('10.5')).toBe('10.5')
    expect(compactNumber('s/d')).toBe('s/d')
    expect(compactNumber('0')).toBe('0')
  })
})

describe('heatmapCellLevel y heatmapCellText: un solo formato por matriz', () => {
  const texts = (values, opts) => {
    const level = heatmapCellLevel(values, opts)
    return values.flat().map((v) => heatmapCellText(v, level, opts))
  }
  it('con espacio, todas las cifras completas a 12 px', () => {
    expect(heatmapCellLevel([[0.53, -0.12]], { cellW: 80 })).toBe('full')
    expect(texts([[0.53, -0.12]], { cellW: 80 })).toEqual([
      { text: '0.53', compact: false },
      { text: '−0.12', compact: false },
    ])
  })
  it('si una sola cifra no cabe completa, todas van compactas a 10 px (Riesgo con 6 emisoras a 390 px)', () => {
    const values = [[1, 0.53], [-0.12, -0.87]]
    expect(heatmapCellLevel(values, { cellW: 39.5 })).toBe('compact')
    expect(texts(values, { cellW: 39.5 })).toEqual([
      { text: '1.00', compact: true },
      { text: '.53', compact: true },
      { text: '−.12', compact: true },
      { text: '−.87', compact: true },
    ])
  })
  it('el dato faltante sigue la letra de la matriz', () => {
    expect(heatmapCellText(null, 'full')).toEqual({ text: 's/d', compact: false })
    expect(heatmapCellText(null, 'compact')).toEqual({ text: 's/d', compact: true })
    expect(heatmapCellText(null, 'compact1')).toEqual({ text: 's/d', compact: true })
  })
  it('en 8 claves a 390 px (celdas de 33 px) la matriz entera va compacta a dos decimales', () => {
    expect(texts([[1, 0.53], [-0.12, null]], { cellW: 33 }).map((t) => t?.text)).toEqual(['1.00', '.53', '−.12', 's/d'])
  })
  it('más angosta: un decimal menos en todas, no mezcla de uno y dos decimales', () => {
    const values = [[0.96, -0.12], [0.05, -0.05]]
    expect(heatmapCellLevel(values, { cellW: 26 })).toBe('compact1')
    expect(texts(values, { cellW: 26 }).map((t) => t?.text)).toEqual(['1.0', '−.1', '.1', '−.1'])
  })
  it('no baja a un decimal si una cifra distinta de cero quedaría en cero (perdería el signo)', () => {
    expect(heatmapCellLevel([[0.96, -0.04]], { cellW: 26 })).toBeNull()
    expect(texts([[0.96, -0.04]], { cellW: 26 })).toEqual([null, null])
  })
  it('si una no cabe ni a un decimal, ninguna lleva cifra (la tabla y el resumen las dicen)', () => {
    expect(heatmapCellLevel([[1, -1]], { cellW: 26 })).toBeNull()
    expect(heatmapCellLevel([[-0.12]], { cellW: 12 })).toBeNull()
    expect(heatmapCellLevel([[0.5]], { cellW: 80, cellHeight: 12 })).toBeNull()
  })
  it('respeta showValues', () => {
    expect(heatmapCellLevel([[0.53]], { cellW: 10, showValues: true })).toBe('full')
    expect(heatmapCellLevel([[0.53]], { cellW: 200, showValues: false })).toBeNull()
  })
  it('lo compacto también cabe según la medida escalada a 10 px', () => {
    for (const cellW of [20, 24, 28, 33, 40]) {
      const values = [[-0.87, 0.3]]
      const level = heatmapCellLevel(values, { cellW })
      for (const v of values.flat()) {
        const r = heatmapCellText(v, level)
        if (r?.compact) expect(textWidth(r.text) * COMPACT_SCALE).toBeLessThanOrEqual(cellW)
      }
    }
  })
  it('porcentaje: la misma regla sobre el texto de fmtPct', () => {
    const opts = { cellW: 200, format: /** @type {const} */ ('pct'), decimals: 1 }
    expect(heatmapCellText(0.123, heatmapCellLevel([[0.123]], opts), opts)).toEqual({ text: '12.3%', compact: false })
  })
})

describe('heatmapHeaders', () => {
  const KEYS = ['WALMEX', 'GFNORTE', 'AMX', 'FEMSA', 'GMEXICO', 'CEMEX', 'CETES', 'USD/MXN']
  it('si todos caben a 12 px van completos y horizontales', () => {
    expect(heatmapHeaders(['AMX', 'FEMSA'], 80)).toEqual({ labels: ['AMX', 'FEMSA'], compact: false, vertical: false, height: 24 })
  })
  it('si caben a 10 px, compactos y horizontales', () => {
    expect(heatmapHeaders(['WALMEX', 'AMX'], 40)).toEqual({ labels: ['WALMEX', 'AMX'], compact: true, vertical: false, height: 24 })
  })
  it('8 claves en celdas de 33 px: verticales y completas, con el alto de la más larga', () => {
    const h = heatmapHeaders(KEYS, 33)
    expect(h.vertical).toBe(true)
    expect(h.compact).toBe(true)
    expect(h.labels).toEqual(KEYS)
    expect(h.height).toBeGreaterThanOrEqual(textWidth('USD/MXN') * COMPACT_SCALE)
  })
  it('las claves de la BMV con .MX (11 caracteres) van completas en vertical, como en Riesgo', () => {
    const bmv = ['GFNORTEO.MX', 'FEMSAUBD.MX', 'WALMEX.MX', 'AMXB.MX', 'CEMEXCPO.MX', 'GMEXICOB.MX']
    const h = heatmapHeaders(bmv, 39.5)
    expect(h.vertical).toBe(true)
    expect(h.labels).toEqual(bmv)
  })
  it('una clave larguísima se recorta para no comerse la gráfica', () => {
    const h = heatmapHeaders(['UNA EMISORA CON NOMBRE MUY LARGO', 'AMX'], 20)
    expect(h.labels[0].endsWith('…')).toBe(true)
    expect(h.height).toBeLessThanOrEqual(100)
  })
})
