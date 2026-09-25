// Celda de la tira de mercado: un dato faltante se dice una vez.
import { render } from '@testing-library/react'
import { StripCell } from './MarketStrip.jsx'

const base = { id: 'vix', label: 'VIX', title: 'VIX', decimals: 2, changeKind: /** @type {const} */ ('pct'), direction: /** @type {const} */ ('auto') }

describe('StripCell', () => {
  it('sin valor ni cambio muestra un solo s/d', () => {
    const { container } = render(<ul><StripCell item={{ ...base, value: null, change: null }} /></ul>)
    expect(container.textContent).toBe('VIXs/d')
  })

  it('con valor muestra valor y cambio', () => {
    const { container } = render(<ul><StripCell item={{ ...base, value: 15.21, change: 0.0277 }} /></ul>)
    expect(container.textContent).toContain('15.21')
    expect(container.textContent).toContain('+2.77%')
  })
})
