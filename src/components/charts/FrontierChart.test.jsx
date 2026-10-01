import { fireEvent, render, screen, within } from '@testing-library/react'
import { FrontierChart } from './FrontierChart.jsx'

const frontier = [
  { risk: 0.1, ret: 0.06 },
  { risk: 0.14, ret: 0.09 },
  { risk: 0.2, ret: 0.12 },
]
const markers = {
  minVar: { risk: 0.1, ret: 0.06 },
  tangency: { risk: 0.15, ret: 0.1 },
  riskParity: { risk: 0.13, ret: 0.075 },
}

describe('FrontierChart', () => {
  it('marca la paridad de riesgo con su leyenda, su resumen y su renglón en Ver tabla', () => {
    render(<FrontierChart title="Frontera eficiente" frontier={frontier} markers={markers} />)
    expect(screen.getByRole('list', { name: 'Leyenda' })).toHaveTextContent('Paridad de riesgo')
    expect(screen.getByRole('figure', { name: 'Frontera eficiente' })).toHaveAccessibleDescription(/Paridad de riesgo: riesgo 13\.0%, rendimiento 7\.5%\./)
    fireEvent.click(screen.getByRole('button', { name: 'Ver tabla' }))
    const table = screen.getByRole('table', { name: 'Datos de Frontera eficiente' })
    const row = within(table).getByRole('row', { name: /Paridad de riesgo/ })
    expect(row).toHaveTextContent('Portafolio')
    expect(row).toHaveTextContent('13.0%')
  })

  it('sin paridad de riesgo no la anuncia', () => {
    render(<FrontierChart title="Frontera eficiente" frontier={frontier} markers={{ minVar: markers.minVar }} />)
    expect(screen.getByRole('list', { name: 'Leyenda' })).not.toHaveTextContent('Paridad de riesgo')
  })
})
