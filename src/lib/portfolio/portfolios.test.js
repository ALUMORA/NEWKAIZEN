import { emptyState } from '../storage.js'
import {
  PortfolioError,
  addTransaction,
  createPortfolio,
  deletePortfolio,
  removeTransaction,
  renamePortfolio,
  setActivePortfolio,
  setTargets,
  updateTransaction,
} from './portfolios.js'

function withTwo() {
  let s = emptyState()
  s = createPortfolio(s, { name: 'Principal', id: 'a' }).state
  s = createPortfolio(s, { name: 'Retiro', id: 'b' }).state
  return s
}

describe('portafolios (cambios puros)', () => {
  it('crear el primero lo vuelve activo; el segundo no', () => {
    const s = withTwo()
    expect(s.portfolios.map((p) => p.name)).toEqual(['Principal', 'Retiro'])
    expect(s.activePortfolioId).toBe('a')
    expect(s.portfolios[0].baseCurrency).toBe('MXN')
  })

  it('no acepta nombre vacío ni ids repetidos', () => {
    expect(() => createPortfolio(emptyState(), { name: '  ' })).toThrow(PortfolioError)
    expect(() => createPortfolio(withTwo(), { name: 'X', id: 'a' })).toThrow('Ya existe')
  })

  it('renombrar, activar y borrar', () => {
    let s = renamePortfolio(withTwo(), 'b', ' Largo plazo ')
    expect(s.portfolios[1].name).toBe('Largo plazo')
    s = setActivePortfolio(s, 'b')
    expect(s.activePortfolioId).toBe('b')
    s = deletePortfolio(s, 'b')
    expect(s.activePortfolioId).toBe('a')
    s = deletePortfolio(s, 'a')
    expect(s.activePortfolioId).toBeNull()
    expect(() => deletePortfolio(s, 'a')).toThrow('No encontramos ese portafolio.')
  })

  it('agregar, editar y quitar movimientos validados', () => {
    const base = withTwo()
    const { state, transaction } = addTransaction(base, 'a', { type: 'buy', symbol: 'aapl', quantity: 2, price: 10, currency: 'USD' })
    expect(transaction).toMatchObject({ symbol: 'AAPL', fees: 0 })
    expect(base.portfolios[0].transactions).toEqual([])
    const edited = updateTransaction(state, 'a', transaction.id, { quantity: 3 })
    expect(edited.portfolios[0].transactions[0].quantity).toBe(3)
    expect(() => updateTransaction(state, 'a', transaction.id, { quantity: -1 })).toThrow('Movimiento inválido')
    expect(removeTransaction(edited, 'a', transaction.id).portfolios[0].transactions).toEqual([])
    expect(() => addTransaction(base, 'a', { type: 'buy', symbol: 'AAPL' })).toThrow(PortfolioError)
  })

  it('pesos objetivo: fracciones que suman a lo más 100%', () => {
    const s = setTargets(withTwo(), 'a', { naftrac: 0.6, 'FUNO11.MX': 0.4, AAPL: 0 })
    expect(s.portfolios[0].targets).toEqual({ NAFTRAC: 0.6, 'FUNO11.MX': 0.4 })
    expect(() => setTargets(s, 'a', { A: 0.7, B: 0.4 })).toThrow('suman más de 100%')
    expect(() => setTargets(s, 'a', { A: 1.5 })).toThrow('Peso inválido')
  })
})
