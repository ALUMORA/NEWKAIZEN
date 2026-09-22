// Prueba mínima del proyecto "dom": jsdom, jest-dom, render y los mocks de setup.js.
import { render, screen } from '@testing-library/react'

function Hola({ nombre }) {
  return <h1>Hola, {nombre}</h1>
}

describe('entorno jsdom', () => {
  it('renderiza y aplica los matchers de jest-dom', () => {
    render(<Hola nombre="Kaizen" />)
    expect(screen.getByRole('heading', { name: 'Hola, Kaizen' })).toBeInTheDocument()
  })

  it('desmonta el DOM entre pruebas', () => {
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('trae los mocks del navegador que jsdom no implementa', () => {
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
    expect(() => window.scrollTo(0, 0)).not.toThrow()
    expect(() => document.body.scrollTo({ top: 0 })).not.toThrow()
    const url = URL.createObjectURL(new Blob(['x']))
    expect(url).toMatch(/^blob:/)
    expect(() => URL.revokeObjectURL(url)).not.toThrow()
    const ro = new ResizeObserver(() => {})
    expect(() => { ro.observe(document.body); ro.disconnect() }).not.toThrow()
  })

  it('localStorage y sessionStorage funcionan y empiezan vacíos', () => {
    expect(localStorage.length).toBe(0)
    expect(window.localStorage).toBe(localStorage)
    expect(localStorage).toBeInstanceOf(Storage)
    localStorage.setItem('a', '1')
    sessionStorage.setItem('kaizen.session', '{}')
    expect(localStorage.getItem('a')).toBe('1')
    expect(window.sessionStorage.getItem('kaizen.session')).toBe('{}')
  })
})
