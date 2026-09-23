// SearchCombobox en jsdom: espera de 200 ms, /v2/search, aria-activedescendant, teclado y estados.
// Lo que depende del navegador real (axe, clic encima de otras capas) lo cubre e2e/dev-ui.spec.js.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetCapabilitiesForTests } from '../../lib/api/capabilities.js'
import { installFetch, json } from '../../test/fetchMock.js'
import { SearchCombobox } from './index.js'

const RESULTS = [
  { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['Walmart de México'] },
  { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', type: 'equity', currency: 'USD', aliases: ['Walmart'] },
]
const META = { asOf: null, source: 'kaizen', delayMinutes: null, stale: false, fallback: false, generatedAt: '2026-09-22T14:52:00Z', notes: [] }

/** fetch falso: /v2/search contesta con los resultados cuyo símbolo o nombre contiene q. */
function searchApi({ status = 200 } = {}) {
  return installFetch((url) => {
    const u = new URL(url)
    if (!u.pathname.endsWith('/v2/search')) throw new Error(`sin respuesta para ${url}`)
    if (status !== 200) return json(status, { error: { code: 'bad_request', message: 'No' } })()
    const q = (u.searchParams.get('q') ?? '').toLowerCase()
    return json(200, { results: RESULTS.filter((r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)), meta: META })()
  })
}

function renderCombobox(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSelect = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <SearchCombobox label="Agregar emisora" onSelect={onSelect} {...props} />
      <button type="button">Otro control</button>
    </QueryClientProvider>,
  )
  return { onSelect, input: screen.getByRole('combobox', { name: props.label ?? 'Agregar emisora' }) }
}

const searchCalls = (api) => api.calls.filter((c) => c.url.includes('/v2/search'))

beforeEach(() => {
  resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, authRequired: true, checkedAt: 'x' })
})

describe('SearchCombobox', () => {
  it('etiqueta visible, combobox cerrado y sin opción activa al empezar', () => {
    searchApi()
    const { input } = renderCombobox({ hint: 'Nombre o clave de pizarra' })
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(input).toHaveAccessibleDescription('Nombre o clave de pizarra')
    expect(document.getElementById(/** @type {string} */ (input.getAttribute('aria-controls')))).toHaveAttribute('role', 'listbox')
  })

  it('espera a que dejes de teclear: una sola búsqueda por pausa, en /v2/search con el límite', async () => {
    const api = searchApi()
    const user = userEvent.setup()
    const { input } = renderCombobox({ limit: 5 })
    await user.type(input, 'walmart')
    expect(await screen.findByRole('option', { name: /WMT/ })).toBeInTheDocument()
    const calls = searchCalls(api)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('q=walmart')
    expect(calls[0].url).toContain('limit=5')
  })

  it('la primera opción queda activa, las flechas la mueven y aria-activedescendant la sigue', async () => {
    searchApi()
    const user = userEvent.setup()
    const { input } = renderCombobox()
    await user.type(input, 'wal')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(input).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('2 resultados')
  })

  it('Enter elige la activa, avisa con la emisora y los resultados, limpia y cierra', async () => {
    searchApi()
    const user = userEvent.setup()
    const { input, onSelect } = renderCombobox()
    await user.type(input, 'wal')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
    const [option, context] = onSelect.mock.calls[0]
    expect(option).toMatchObject({ id: 'sym-WMT', label: 'WMT', symbol: 'WMT', detail: 'Walmart Inc. · NYSE' })
    expect(option.result).toEqual(RESULTS[1])
    expect(context.q).toBe('wal')
    expect(context.results).toHaveLength(2)
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('el clic elige sin sacar el foco del campo', async () => {
    searchApi()
    const user = userEvent.setup()
    const { input, onSelect } = renderCombobox()
    await user.type(input, 'wal')
    await user.click(await screen.findByRole('option', { name: /WALMEX\.MX/ }))
    expect(onSelect.mock.calls[0][0].symbol).toBe('WALMEX.MX')
    expect(input).toHaveFocus()
  })

  it('exclude no ofrece las emisoras que ya se eligieron', async () => {
    searchApi()
    const user = userEvent.setup()
    const { input } = renderCombobox({ exclude: ['walmex.mx'] })
    await user.type(input, 'wal')
    await screen.findByRole('option', { name: /WMT/ })
    expect(screen.queryByRole('option', { name: /WALMEX/ })).toBeNull()
  })

  it('Esc cierra la lista y un segundo Esc borra el texto', async () => {
    searchApi()
    const user = userEvent.setup()
    const { input } = renderCombobox()
    await user.type(input, 'wal')
    await screen.findAllByRole('option')
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(input).toHaveValue('wal')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('al salir del campo con Tab la lista se cierra', async () => {
    searchApi()
    const user = userEvent.setup()
    const { input } = renderCombobox()
    await user.type(input, 'wal')
    await screen.findAllByRole('option')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Otro control' })).toHaveFocus()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('sin coincidencias lo dice, y un error del API no se esconde', async () => {
    searchApi({ status: 400 })
    const user = userEvent.setup()
    const { input } = renderCombobox()
    await user.type(input, 'zzz')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No se pudo buscar ahora. Intenta de nuevo en un momento.'))
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('con un servidor viejo no llama a /v2/search y avisa que no está disponible', async () => {
    resetCapabilitiesForTests({ status: 'legacy', apiVersion: 1, authRequired: false, checkedAt: 'x' })
    const api = searchApi()
    const user = userEvent.setup()
    const { input } = renderCombobox()
    await user.type(input, 'wal')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('La búsqueda de emisoras no está disponible por ahora.'))
    expect(searchCalls(api)).toHaveLength(0)
  })

  it('en línea: lista siempre abierta, grupos propios, onEnter manda y renderOption pinta', async () => {
    searchApi()
    const user = userEvent.setup()
    const onEnter = vi.fn(({ q }) => q === 'FEMSA')
    const { input, onSelect } = renderCombobox({
      inline: true,
      hideLabel: true,
      label: 'Buscar emisora o función',
      onEnter,
      getGroups: ({ results }) => [
        ...(results.length ? [{ id: 'emisoras', label: 'Emisoras', options: results.map((r) => ({ id: `sym-${r.symbol}`, label: r.symbol })) }] : []),
        { id: 'ir-a', label: 'Ir a', options: [{ id: 'go-riesgo', label: 'Riesgo' }] },
      ],
      renderOption: (option, { selected }) => `${option.label}${selected ? ' (activa)' : ''}`,
    })
    // Abierta aun sin texto, con la primera opción activa y el estado visible.
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('group', { name: 'Ir a' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Riesgo (activa)' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('1 resultado')

    await user.type(input, 'wal')
    expect(await screen.findByRole('group', { name: 'Emisoras' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'WALMEX.MX (activa)' })).toBeInTheDocument()

    // onEnter que devuelve true se queda con el Enter; si devuelve false, se elige la activa.
    await user.clear(input)
    await user.type(input, 'FEMSA{Enter}')
    expect(onEnter).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'FEMSA' }))
    expect(onSelect).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'wal')
    await screen.findByRole('group', { name: 'Emisoras' })
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].id).toBe('sym-WALMEX.MX')
    // En línea no se limpia sola ni cierra: eso lo decide quien la usa (la paleta se cierra).
    expect(input).toHaveValue('wal')
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('en línea, Esc no se detiene: le toca al diálogo que la contiene', async () => {
    searchApi()
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <div onKeyDown={(e) => onKeyDown(e.key)}>
          <SearchCombobox inline hideLabel label="Buscar" />
        </div>
      </QueryClientProvider>,
    )
    await user.type(screen.getByRole('combobox', { name: 'Buscar' }), 'wal{Escape}')
    expect(onKeyDown).toHaveBeenLastCalledWith('Escape')
  })
})
