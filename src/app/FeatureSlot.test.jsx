import { render, screen } from '@testing-library/react'
import { lazy } from 'react'
import { resetCapabilitiesForTests } from '../lib/api/capabilities.js'
import { FeatureSlot } from './FeatureSlot.jsx'

const Lazy = lazy(async () => ({ default: () => <p>sección cargada</p> }))

function Boom() {
  throw new Error('falla de la sección')
}

afterEach(() => resetCapabilitiesForTests())

describe('FeatureSlot', () => {
  it('monta la sección lazy si el servidor anuncia la capacidad', async () => {
    resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, capabilities: new Set(['ohlc']) })
    render(<FeatureSlot capabilities={['ohlc']}><Lazy /></FeatureSlot>)
    expect(await screen.findByText('sección cargada')).toBeInTheDocument()
  })

  it('sin la capacidad no pinta nada', () => {
    resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, capabilities: new Set(['search']) })
    const { container } = render(<FeatureSlot capabilities={['ohlc']}><p>no debe verse</p></FeatureSlot>)
    expect(container).toBeEmptyDOMElement()
  })

  it('sin lista de capacidades se monta siempre (funciones solo del navegador)', () => {
    resetCapabilitiesForTests({ status: 'down' })
    render(<FeatureSlot><p>siempre</p></FeatureSlot>)
    expect(screen.getByText('siempre')).toBeInTheDocument()
  })

  it('si la sección truena, el aviso queda dentro de la ranura', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <div>
        <p>resto de la página</p>
        <FeatureSlot>
          <Boom />
        </FeatureSlot>
      </div>,
    )
    expect(screen.getByText('resto de la página')).toBeInTheDocument()
    expect(screen.getByText(/No pudimos mostrar esta sección/)).toBeInTheDocument()
  })
})
