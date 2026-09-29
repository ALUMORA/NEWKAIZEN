import { describe, expect, it } from 'vitest'
import { COMPACT_SCALE, compactNumber, heatmapCellText, heatmapHeaders } from './heatmap-fit.js'
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

describe('heatmapCellText', () => {
  it('con espacio, la cifra completa a 12 px', () => {
    expect(heatmapCellText(0.53, { cellW: 80 })).toEqual({ text: '0.53', compact: false })
    expect(heatmapCellText(-0.12, { cellW: 80 })).toEqual({ text: '−0.12', compact: false })
  })
  it('en una celda de 33 px (8 claves a 390) cabe la versión compacta a 10 px', () => {
    expect(heatmapCellText(0.53, { cellW: 33 })).toEqual({ text: '.53', compact: true })
    expect(heatmapCellText(-0.12, { cellW: 33 })).toEqual({ text: '−.12', compact: true })
    expect(heatmapCellText(1, { cellW: 33 })).toEqual({ text: '1.00', compact: true })
    expect(heatmapCellText(null, { cellW: 33 })).toEqual({ text: 's/d', compact: false })
    expect(heatmapCellText(null, { cellW: 26 })).toEqual({ text: 's/d', compact: true })
  })
  it('más angosta todavía: un decimal menos antes que nada', () => {
    expect(heatmapCellText(-0.12, { cellW: 26 })).toEqual({ text: '−.1', compact: true })
    expect(heatmapCellText(0.96, { cellW: 26 })).toEqual({ text: '.96', compact: true })
    expect(heatmapCellText(1, { cellW: 26 })).toEqual({ text: '1.0', compact: true })
  })
  it('lo que no cabe ni así se omite (la tabla y el resumen lo dicen)', () => {
    expect(heatmapCellText(-0.12, { cellW: 12 })).toBeNull()
    expect(heatmapCellText(0.5, { cellW: 80, cellHeight: 12 })).toBeNull()
  })
  it('respeta showValues', () => {
    expect(heatmapCellText(0.53, { cellW: 10, showValues: true })).toEqual({ text: '0.53', compact: false })
    expect(heatmapCellText(0.53, { cellW: 200, showValues: false })).toBeNull()
  })
  it('lo compacto también cabe según la medida escalada a 10 px', () => {
    for (const cellW of [20, 24, 28, 33, 40]) {
      const r = heatmapCellText(-0.87, { cellW })
      if (r?.compact) expect(textWidth(r.text) * COMPACT_SCALE).toBeLessThanOrEqual(cellW)
    }
  })
  it('porcentaje: la misma regla sobre el texto de fmtPct', () => {
    expect(heatmapCellText(0.123, { cellW: 200, format: 'pct', decimals: 1 })).toEqual({ text: '12.3%', compact: false })
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
  it('una clave larguísima se recorta para no comerse la gráfica', () => {
    const h = heatmapHeaders(['UNA EMISORA CON NOMBRE MUY LARGO', 'AMX'], 20)
    expect(h.labels[0].endsWith('…')).toBe(true)
    expect(h.height).toBeLessThanOrEqual(90)
  })
})
