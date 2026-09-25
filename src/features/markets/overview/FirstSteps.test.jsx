// Primeros pasos en /mercados: la pista hacia la bienvenida para quien entra sin portafolio.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { load, resetStorageForTests, update } from '../../../lib/storage.js'
import { FirstSteps } from './FirstSteps.jsx'

function renderIt() {
  return render(
    <MemoryRouter>
      <FirstSteps />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetStorageForTests()
})

describe('FirstSteps', () => {
  it('sin portafolio lleva a la bienvenida y "Ahora no" la descarta para siempre', async () => {
    renderIt()
    expect(screen.getByRole('heading', { name: 'Primeros pasos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a la bienvenida' })).toHaveAttribute('href', '/bienvenida')
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
    expect(screen.queryByRole('heading', { name: 'Primeros pasos' })).not.toBeInTheDocument()
    expect(load().settings.onboardingDone).toBe(true)
  })

  it('con un portafolio ya no aparece', () => {
    update((s) => ({ ...s, portfolios: [{ id: 'p1', name: 'Mi portafolio', baseCurrency: 'MXN', createdAt: '2026-09-01T00:00:00.000Z', transactions: [], targets: {}, notes: '' }] }))
    const { container } = renderIt()
    expect(container).toBeEmptyDOMElement()
  })
})
