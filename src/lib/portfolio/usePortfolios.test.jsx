import { act, renderHook } from '@testing-library/react'
import { LEGACY_KEYS, STORAGE_KEY, resetStorageForTests } from '../storage.js'
import { usePortfolios } from './usePortfolios.js'

beforeEach(() => resetStorageForTests())

describe('usePortfolios', () => {
  it('lee lo migrado, deriva posiciones y se actualiza al agregar movimientos', () => {
    localStorage.setItem(
      LEGACY_KEYS.portfolios,
      JSON.stringify([{ id: 'p1', name: 'Principal', positions: [{ ticker: 'AAPL', shares: 2, cost: 100 }] }]),
    )
    const { result } = renderHook(() => usePortfolios())
    expect(result.current.active.name).toBe('Principal')
    expect(result.current.positions).toEqual([{ symbol: 'AAPL', quantity: 2, avgCost: 100, currency: 'USD', costBasis: 200 }])

    act(() => {
      result.current.actions.addTransaction('p1', { type: 'buy', symbol: 'AAPL', quantity: 2, price: 200, currency: 'USD', date: '2026-09-22' })
    })
    expect(result.current.positions[0]).toMatchObject({ quantity: 4, avgCost: 150 })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).portfolios[0].transactions).toHaveLength(2)
  })

  it('sin datos: sin portafolio activo; crear uno lo activa', () => {
    const { result } = renderHook(() => usePortfolios())
    expect(result.current.active).toBeNull()
    expect(result.current.positions).toEqual([])
    act(() => {
      result.current.actions.create({ name: 'Mío' })
    })
    expect(result.current.active.name).toBe('Mío')
  })
})
