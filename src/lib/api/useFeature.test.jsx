import { act, renderHook } from '@testing-library/react'
import { resetCapabilitiesForTests } from './capabilities.js'
import { useFeature } from './useFeature.js'
import { useFeature as fromOldPath } from '../../features/markets/overview/useFeature.js'

afterEach(() => resetCapabilitiesForTests())

describe('useFeature', () => {
  it('se enciende si el servidor listo anuncia alguna de las capacidades', () => {
    resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, capabilities: new Set(['curves']) })
    const { result } = renderHook(() => useFeature(['fxdesk', 'curves']))
    expect(result.current).toEqual({ enabled: true, waiting: false, reason: '' })
  })

  it('sin la capacidad lo dice y no espera', () => {
    resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, capabilities: new Set(['search']) })
    const { result } = renderHook(() => useFeature(['curves']))
    expect(result.current.enabled).toBe(false)
    expect(result.current.waiting).toBe(false)
    expect(result.current.reason).toMatch(/todavía no ofrece este dato/)
  })

  it('mientras sondea espera, y con el servidor caído da otra razón', () => {
    resetCapabilitiesForTests({ status: 'probing' })
    const { result } = renderHook(() => useFeature(['curves']))
    expect(result.current).toEqual({ enabled: false, waiting: true, reason: '' })
    act(() => resetCapabilitiesForTests({ status: 'down' }))
    expect(result.current.reason).toMatch(/No pudimos hablar con el servidor/)
  })

  it('la ruta vieja del panorama reexporta el mismo hook', () => {
    expect(fromOldPath).toBe(useFeature)
  })
})
