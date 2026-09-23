import { describe, expect, it } from 'vitest'
import { drawdownFrom, maxDrawdown } from './drawdown.js'

describe('drawdown', () => {
  it('0 en máximos y negativa abajo; faltantes siguen faltando', () => {
    const dd = drawdownFrom([{ value: 100 }, { value: 80 }, { value: null }, { value: 120 }, { value: 90 }])
    expect(dd.map((p) => p.value)).toEqual([0, -0.2, null, 0, -0.25])
    expect(maxDrawdown(dd).value).toBe(-0.25)
    expect(maxDrawdown([])).toBeNull()
  })
})
