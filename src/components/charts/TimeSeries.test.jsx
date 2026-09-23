import { fireEvent, render, screen } from '@testing-library/react'
import { TimeSeries } from './TimeSeries.jsx'

const series = [{ label: 'IPC', points: [
  { date: '2026-09-17', value: 100 }, { date: '2026-09-18', value: 101.5 }, { date: '2026-09-19', value: 99 },
] }]

describe('TimeSeries', () => {
  it('con foco muestra el último punto y las flechas lo mueven', () => {
    render(<TimeSeries title="IPC" series={series} />)
    const plot = screen.getByRole('group', { name: /Gráfica interactiva/ })
    fireEvent.focus(plot)
    expect(plot).toHaveAccessibleDescription(/19 sep 2026\. IPC: 99\.00/)
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(plot).toHaveAccessibleDescription(/18 sep 2026\. IPC: 101\.50/)
    fireEvent.keyDown(plot, { key: 'Home' })
    expect(plot).toHaveAccessibleDescription(/17 sep 2026/)
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(plot).toHaveAccessibleDescription(/17 sep 2026/)
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(plot).toHaveAccessibleDescription('')
  })
  it('resumen automático con primer y último valor', () => {
    render(<TimeSeries title="IPC" series={series} />)
    expect(screen.getByRole('figure', { name: 'IPC' })).toHaveAccessibleDescription(/de 100\.00 el 17 sep 2026 a 99\.00 el 19 sep 2026/)
  })
  it('vacío: sin foco ni tabla', () => {
    render(<TimeSeries title="IPC" series={[{ label: 'IPC', points: [] }]} />)
    expect(screen.getByText('Sin datos para este periodo')).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ver tabla' })).toBeNull()
  })
  it('un punto sigue siendo navegable', () => {
    render(<TimeSeries title="IPC" series={[{ label: 'IPC', points: [{ date: '2026-09-19', value: 5 }] }]} format="pct" />)
    const plot = screen.getByRole('group')
    fireEvent.focus(plot)
    expect(plot).toHaveAccessibleDescription(/IPC: 500\.00%/)
  })
})
