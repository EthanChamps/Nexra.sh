import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownMessage } from '../src/components/MarkdownMessage'

describe('MarkdownMessage', () => {
  it('renders bold and italic text', () => {
    render(<MarkdownMessage content="**bold** and _italic_" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
  })

  it('renders a bullet list', () => {
    render(<MarkdownMessage content={'- one\n- two'} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders inline code as a code element', () => {
    render(<MarkdownMessage content="use `npm install`" />)
    expect(screen.getByText('npm install').tagName).toBe('CODE')
  })

  it('renders a fenced code block inside a pre element', () => {
    render(<MarkdownMessage content={'```\nconst x = 1\n```'} />)
    expect(screen.getByText('const x = 1').closest('pre')).not.toBeNull()
  })

  it('renders a link that opens in a new tab', () => {
    render(<MarkdownMessage content="[docs](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('breaks single newlines into separate lines', () => {
    const { container } = render(<MarkdownMessage content={'line one\nline two'} />)
    expect(container.querySelector('br')).not.toBeNull()
  })

  it('renders a GFM table', () => {
    render(<MarkdownMessage content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('A').tagName).toBe('TH')
  })
})
