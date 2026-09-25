// Componentes en jsdom: ids y aria que no dependen del navegador real. Lo que sí depende de él
// (popover nativo, <dialog> modal, foco atrapado, axe) lo cubre e2e/dev-ui.spec.js.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Card, DataTable, Delta, IconButton, Input, Money, NumberInput, Stat, TabPanel, Tabs, UiProvider, useToast } from './index.js'

describe('Field e Input', () => {
  it('conecta label, ayuda y error, y marca aria-invalid y required', () => {
    render(<Input label="Emisora" hint="Clave de pizarra" error="No existe" required />)
    const input = screen.getByRole('textbox', { name: /Emisora/ })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toBeRequired()
    expect(input).toHaveAccessibleDescription('Clave de pizarra No existe')
  })

  it('suelto conserva required y el sufijo entra a la descripción', () => {
    render(<Input aria-label="Tasa" suffix="%" required />)
    const input = screen.getByRole('textbox', { name: 'Tasa' })
    expect(input).toBeRequired()
    expect(input).toHaveAccessibleDescription('%')
  })
})

describe('NumberInput', () => {
  function Harness({ initial = 25000 }) {
    const [value, setValue] = useState(/** @type {number | null} */ (initial))
    return (
      <>
        <NumberInput label="Monto" value={value} onChange={setValue} decimals={2} />
        <output data-testid="valor">{String(value)}</output>
        <button type="button" onClick={() => setValue(1234.5)}>
          Usar máximo
        </button>
      </>
    )
  }

  it('lee es-MX mientras se escribe y reformatea al salir', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Monto' })
    expect(input).toHaveValue('25,000.00')
    await user.clear(input)
    await user.type(input, '1,234.5')
    expect(screen.getByTestId('valor')).toHaveTextContent('1234.5')
    expect(input).toHaveValue('1,234.5')
    await user.tab()
    expect(input).toHaveValue('1,234.50')
    await user.clear(input)
    await user.type(input, 'abc')
    expect(screen.getByTestId('valor')).toHaveTextContent('null')
  })

  it('un valor nuevo desde afuera se dibuja', async () => {
    const user = userEvent.setup()
    render(<Harness initial={null} />)
    expect(screen.getByRole('textbox', { name: 'Monto' })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Usar máximo' }))
    expect(screen.getByRole('textbox', { name: 'Monto' })).toHaveValue('1,234.50')
  })
})

describe('Tabs', () => {
  function Harness() {
    const [tab, setTab] = useState('a')
    return (
      <Tabs
        label="Secciones"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'a', label: 'Uno' },
          { id: 'b', label: 'Dos', disabled: true },
          { id: 'c', label: 'Tres' },
        ]}
      >
        <TabPanel id="a">Panel uno</TabPanel>
        <TabPanel id="c">Panel tres</TabPanel>
      </Tabs>
    )
  }

  it('tabindex móvil, flechas que saltan la deshabilitada y panel enlazado', () => {
    render(<Harness />)
    const [uno, dos, tres] = screen.getAllByRole('tab')
    expect(uno).toHaveAttribute('tabindex', '0')
    expect(dos).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Uno')
    act(() => uno.focus())
    fireEvent.keyDown(uno, { key: 'ArrowRight' })
    expect(tres).toHaveAttribute('aria-selected', 'true')
    expect(tres).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel tres')
    fireEvent.keyDown(tres, { key: 'ArrowRight' })
    expect(uno).toHaveAttribute('aria-selected', 'true')
  })
})

describe('DataTable', () => {
  const columns = [
    { key: 'sym', header: 'Emisora', sortable: true },
    { key: 'ret', header: 'Rendimiento', numeric: true, sortable: true, format: (v) => <Delta value={v} /> },
  ]
  const rows = [
    { sym: 'B', ret: 0.1 },
    { sym: 'A', ret: null },
    { sym: 'C', ret: -0.2 },
  ]

  it('ordena con aria-sort, alinea números a la derecha y deja s/d al final', async () => {
    const user = userEvent.setup()
    render(<DataTable caption="Prueba" columns={columns} rows={rows} rowKey="sym" />)
    const header = screen.getByRole('columnheader', { name: 'Rendimiento' })
    expect(header).not.toHaveAttribute('aria-sort')
    expect(header).toHaveAttribute('data-align', 'right')
    await user.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('rowheader').map((c) => c.textContent)).toEqual(['B', 'C', 'A'])
    await user.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('rowheader').map((c) => c.textContent)).toEqual(['C', 'B', 'A'])
  })

  it('la fila se activa con su botón (teclado) y con clic en la fila', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<DataTable caption="Prueba" columns={columns} rows={rows} rowKey="sym" onRowClick={onRowClick} rowLabel={(r) => `Abrir ${r.sym}`} />)
    screen.getByRole('button', { name: 'Abrir C' }).focus()
    await user.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenLastCalledWith(rows[2])
    await user.click(screen.getAllByRole('cell')[0])
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })

  it('estados de carga, vacío y error', () => {
    const { rerender } = render(<DataTable caption="Prueba" columns={columns} rows={[]} rowKey="sym" loading />)
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    rerender(<DataTable caption="Prueba" columns={columns} rows={[]} rowKey="sym" empty={{ title: 'Sin emisoras' }} />)
    expect(screen.getByText('Sin emisoras')).toBeInTheDocument()
    const onRetry = vi.fn()
    rerender(<DataTable caption="Prueba" columns={columns} rows={rows} rowKey="sym" error="Falló" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Falló')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('cifras', () => {
  it('Money y Delta usan el menos tipográfico y s/d', () => {
    render(
      <>
        <Money value={-1141} currency="USD" data-testid="m" />
        <Money value={null} data-testid="m2" />
        <Delta value={-0.0045} arrow data-testid="d" />
      </>,
    )
    expect(screen.getByTestId('m')).toHaveTextContent('−$1,141.00 USD')
    expect(screen.getByTestId('m2')).toHaveTextContent('s/d')
    expect(screen.getByTestId('d')).toHaveAttribute('data-dir', 'down')
    expect(screen.getByTestId('d')).toHaveTextContent('▼−0.45%')
  })

  it('Stat sin valor dice s/d y cargando se anuncia', () => {
    const { rerender } = render(<Stat label="Dividendo" value={null} />)
    expect(screen.getByText('s/d')).toBeInTheDocument()
    rerender(<Stat label="Dividendo" loading />)
    expect(screen.getByText('Cargando')).toBeInTheDocument()
  })

  it('IconButton lleva nombre accesible y aria-pressed', () => {
    render(
      <IconButton label="Tema oscuro" pressed={false}>
        x
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Tema oscuro' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('UiProvider: avisos', () => {
  function Harness({ onUndo }) {
    const toast = useToast()
    return (
      <button type="button" onClick={() => toast.show({ title: 'Movimiento borrado', action: { label: 'Deshacer', onClick: onUndo } })}>
        Borrar
      </button>
    )
  }

  it('la región viva existe antes del aviso y Deshacer llama a la acción y cierra', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    render(
      <UiProvider>
        <Harness onUndo={onUndo} />
      </UiProvider>,
    )
    const region = screen.getByRole('region', { name: 'Avisos' })
    expect(region.querySelector('[aria-live="polite"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Borrar' }))
    expect(region).toHaveTextContent('Movimiento borrado')
    await user.click(within(region).getByRole('button', { name: 'Deshacer' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(region).not.toHaveTextContent('Movimiento borrado')
  })

  it('el aviso se va solo después de su duración', () => {
    vi.useFakeTimers()
    function Auto() {
      const toast = useToast()
      return (
        <button type="button" onClick={() => toast.show({ title: 'Guardado', duration: 1000 })}>
          Guardar
        </button>
      )
    }
    render(
      <UiProvider>
        <Auto />
      </UiProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('region', { name: 'Avisos' })).toHaveTextContent('Guardado')
    act(() => vi.advanceTimersByTime(1100))
    expect(screen.getByRole('region', { name: 'Avisos' })).not.toHaveTextContent('Guardado')
    vi.useRealTimers()
  })
})

describe('Card', () => {
  // Con status={q.data?.meta} la insignia llega junto con el dato; si el encabezado no le guarda
  // lugar, en móvil aparece una fila nueva y todo lo de abajo brinca (CLS de /mercados).
  it('con status todavía vacío guarda el lugar de la insignia, oculto para lectores de pantalla', () => {
    const { container } = render(<Card title="Resumen" status={undefined}>x</Card>)
    const slot = container.querySelector('.kz-card__actions')
    expect(slot).not.toBeNull()
    expect(slot).toHaveAttribute('data-reserve')
    expect(slot).toHaveAttribute('aria-hidden', 'true')
  })

  it('sin la prop status no agrega nada al encabezado', () => {
    const { container } = render(<Card title="Resumen">x</Card>)
    expect(container.querySelector('.kz-card__actions')).toBeNull()
  })

  it('con status lleno muestra la insignia sin reserva', () => {
    const meta = { asOf: '2026-09-22T14:40:00Z', source: 'yahoo', delayMinutes: 15, stale: false, fallback: false, generatedAt: '2026-09-22T14:52:00Z', notes: [] }
    const { container } = render(<Card title="Resumen" status={meta}>x</Card>)
    const slot = container.querySelector('.kz-card__actions')
    expect(slot).not.toHaveAttribute('data-reserve')
    expect(slot).not.toHaveAttribute('aria-hidden')
  })
})
