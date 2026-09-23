import { describe, expect, it } from 'vitest'
import { divergingIndex, maxAbs } from './diverging.js'

describe('escala divergente', () => {
  it('cinco pasos simétricos', () => {
    expect([-1, -0.5, 0, 0.2, 0.21, 0.61, 1].map((v) => divergingIndex(v, 1))).toEqual([0, 1, 2, 2, 3, 4, 4])
  })
  it('faltante es −1', () => {
    expect(divergingIndex(null, 1)).toBe(-1)
  })
  it('maxAbs ignora faltantes', () => {
    expect(maxAbs([[0.2, null], [-0.7, 0.1]])).toBe(0.7)
    expect(maxAbs([])).toBe(1)
  })
})
