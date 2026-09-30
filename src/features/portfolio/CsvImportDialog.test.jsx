import { render, screen } from '@testing-library/react'
import CsvImportDialog from './CsvImportDialog.jsx'

const base = { name: 'mis-movimientos.csv', ok: [{ id: 'a' }, { id: 'b' }], bad: [], repeated: 0, empty: false }
const noop = () => {}

describe('CsvImportDialog', () => {
  it('nombra las columnas del archivo que no se leen', () => {
    render(<CsvImportDialog preview={{ ...base, ignored: ['Casa de bolsa', 'Folio'] }} onCancel={noop} onConfirm={noop} />)
    expect(screen.getByText('Estas columnas no las reconocimos y no se importan: Casa de bolsa, Folio.')).toBeInTheDocument()
    expect(screen.getByText('2 movimientos listos para agregar.')).toBeInTheDocument()
  })

  it('con una sola columna ignorada lo dice en singular', () => {
    render(<CsvImportDialog preview={{ ...base, ignored: ['Broker'] }} onCancel={noop} onConfirm={noop} />)
    expect(screen.getByText('Esta columna no la reconocimos y no se importa: Broker.')).toBeInTheDocument()
  })

  it('sin columnas ignoradas no agrega el aviso', () => {
    render(<CsvImportDialog preview={{ ...base, ignored: [] }} onCancel={noop} onConfirm={noop} />)
    expect(screen.queryByText(/no las? reconocimos/)).toBeNull()
    expect(screen.getByText(/Columnas que se leen: Fecha, Tipo, Clave/)).toBeInTheDocument()
  })
})
