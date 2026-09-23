// InlineLink: interna con router, externa con rel seguro y aviso para lectores de pantalla.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { InlineLink } from './index.js'

describe('InlineLink', () => {
  it('interna con router: Link de react-router, misma pestaña y clase de liga', () => {
    render(
      <MemoryRouter>
        <p>
          Lee la <InlineLink to="/aprender/sharpe">metodología</InlineLink>.
        </p>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'metodología' })
    expect(link).toHaveAttribute('href', '/aprender/sharpe')
    expect(link).toHaveClass('kz-link')
    expect(link).not.toHaveAttribute('target')
    expect(link).not.toHaveAttribute('rel')
  })

  it('interna sin router cae a un <a href> y no truena', () => {
    render(<InlineLink to="/aprender">Aprender</InlineLink>)
    expect(screen.getByRole('link', { name: 'Aprender' })).toHaveAttribute('href', '/aprender')
  })

  it('externa por href absoluto: otra pestaña, noopener noreferrer y aviso solo para lectores', () => {
    render(
      <InlineLink href="https://www.banxico.org.mx/" className="extra">
        Banxico
      </InlineLink>,
    )
    const link = screen.getByRole('link', { name: /^Banxico\s?\(se abre en otra pestaña\)$/ })
    expect(link).toHaveAttribute('href', 'https://www.banxico.org.mx/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveClass('kz-link', 'extra')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('suma noopener noreferrer al rel que venga, sin repetir', () => {
    render(
      <InlineLink href="https://example.com/" rel="author noopener">
        Autor
      </InlineLink>,
    )
    expect(screen.getByRole('link', { name: /Autor/ })).toHaveAttribute('rel', 'author noopener noreferrer')
  })

  it('external={false} deja una liga absoluta en la misma pestaña', () => {
    render(
      <InlineLink href="https://kaizen.example/ayuda" external={false}>
        Ayuda
      </InlineLink>,
    )
    const link = screen.getByRole('link', { name: 'Ayuda' })
    expect(link).not.toHaveAttribute('target')
    expect(link).not.toHaveAttribute('rel')
  })

  it('external fuerza otra pestaña aunque la liga sea relativa, y un target _blank suelto también lleva rel seguro', () => {
    render(
      <>
        <InlineLink href="/docs/metodologia.pdf" external>
          PDF
        </InlineLink>
        <InlineLink href="/legal/aviso" target="_blank">
          Aviso
        </InlineLink>
      </>,
    )
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Aviso' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('ancla y correo no son externas', () => {
    render(
      <>
        <InlineLink href="#fuentes">Fuentes</InlineLink>
        <InlineLink href="mailto:hola@example.com">Escríbenos</InlineLink>
      </>,
    )
    expect(screen.getByRole('link', { name: 'Fuentes' })).not.toHaveAttribute('target')
    expect(screen.getByRole('link', { name: 'Escríbenos' })).not.toHaveAttribute('target')
  })
})
