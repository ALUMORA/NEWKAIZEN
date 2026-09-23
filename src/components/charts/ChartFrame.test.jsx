import { fireEvent, render, screen } from '@testing-library/react'
import { ChartFrame } from './ChartFrame.jsx'

const table = {
  columns: [{ key: 'm', header: 'Mes' }, { key: 'v', header: 'Valor', numeric: true }],
  rows: [{ m: 'ene', v: 1 }, { m: 'feb', v: -2 }],
  rowKey: 'm',
}

describe('ChartFrame', () => {
  it('nombra la figura con el título y la describe con el pie y el resumen', () => {
    render(<ChartFrame title="IPC" description="Cierre diario" summary="Sube 3%">x</ChartFrame>)
    const fig = screen.getByRole('figure', { name: 'IPC' })
    expect(fig).toHaveAccessibleDescription('Cierre diario Sube 3%')
    expect(screen.getByRole('heading', { level: 3, name: 'IPC' })).toBeInTheDocument()
  })
  it('Ver tabla abre y cierra la tabla con aria-expanded', () => {
    render(<ChartFrame title="IPC" table={table}>x</ChartFrame>)
    const btn = screen.getByRole('button', { name: 'Ver tabla' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Ocultar tabla' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('table', { name: 'Datos de IPC' })).toBeInTheDocument()
    expect(screen.getByText('−2.00')).toBeInTheDocument()
  })
  it('pie con fuente y estado del dato', () => {
    render(<ChartFrame title="IPC" source="BMV" status={{ asOf: '2026-09-19', source: 'BMV', now: Date.UTC(2026, 8, 22) }}>x</ChartFrame>)
    expect(screen.getByText('Fuente: BMV')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Al 19 sep|Dato del 19 sep/ })).toBeInTheDocument()
  })
  it('leyenda con valores', () => {
    render(<ChartFrame title="Mezcla" legend={[{ label: 'Acciones', color: 'var(--chart-1)', value: '60%' }]}>x</ChartFrame>)
    expect(screen.getByRole('list', { name: 'Leyenda' })).toHaveTextContent('Acciones60%')
  })
})
