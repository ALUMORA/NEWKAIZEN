// Prep de la fase 5: lo nuevo del barril y la prop `download`, que no cambia nada en pantalla
// mientras DownloadButton sea provisional.
import { render, screen } from '@testing-library/react'
import { ChartFrame } from '../charts/ChartFrame.jsx'
import { ApiNotes as OldApiNotes } from '../../features/markets/pages/ApiNotes.jsx'
import { ApiNotes, DataTable, DownloadButton, Popover } from './index.js'

const columns = [
  { key: 'name', header: 'Nombre' },
  { key: 'value', header: 'Valor', numeric: true },
]
const rows = [
  { name: 'A', value: 1 },
  { name: 'B', value: 2 },
]

describe('barril de la fase 5', () => {
  it('exporta Popover, ApiNotes y DownloadButton, y la ruta vieja de ApiNotes reexporta el mismo', () => {
    expect(typeof Popover).toBe('function')
    expect(typeof DownloadButton).toBe('function')
    expect(OldApiNotes).toBe(ApiNotes)
  })

  it('ApiNotes muestra las notas y el respaldo, y nada si no hay', () => {
    const { container, rerender } = render(<ApiNotes meta={{ notes: [] }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ApiNotes meta={{ notes: ['yfinance es para uso personal'], fallback: true, source: 'fred' }} />)
    const note = screen.getByRole('note', { name: 'Avisos de la fuente' })
    expect(note).toHaveTextContent('yfinance es para uso personal')
    expect(note).toHaveTextContent('fuente de respaldo (fred)')
  })

  it('DataTable con `download` se ve igual que sin ella', () => {
    const plain = render(<DataTable columns={columns} rows={rows} rowKey="name" caption="Tabla" />).container.innerHTML
    const withDownload = render(
      <DataTable columns={columns} rows={rows} rowKey="name" caption="Tabla" download={{ filename: 'tabla.csv', meta: { source: 'banxico' } }} />,
    ).container.innerHTML
    expect(withDownload.replace(/_r_[0-9a-z]+_|:r[0-9a-z]+:/g, 'ID')).toBe(plain.replace(/_r_[0-9a-z]+_|:r[0-9a-z]+:/g, 'ID'))
  })

  it('ChartFrame con `download` no agrega nada visible', () => {
    render(
      <ChartFrame title="Curva" download={{ filename: 'curva.csv', rows }}>
        <svg aria-hidden="true" />
      </ChartFrame>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const actions = document.querySelector('.kz-chart__actions')
    expect(actions).toBeEmptyDOMElement()
  })
})
