import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolCard } from '../src/components/ToolCard'

describe('ToolCard', () => {
  it('shows the running command with a live elapsed timer', () => {
    render(<ToolCard running success={false} unavailable={false} command="run scubagear" />)
    expect(screen.getByText('run scubagear')).toBeInTheDocument()
    expect(screen.getByText('0:00')).toBeInTheDocument()
  })

  it('shows the tail of streamed output while running', () => {
    const output = ['l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08'].join('\n')
    const { container } = render(<ToolCard running success={false} unavailable={false} command="run scubagear" output={output} />)
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('l08')
    expect(pre?.textContent).not.toContain('l01')
  })

  it('shows no output panel while running with empty output', () => {
    const { container } = render(<ToolCard running success={false} unavailable={false} command="run scubagear" output="" />)
    expect(container.querySelector('pre')).toBeNull()
  })
  it('shows success output + duration', () => {
    render(<ToolCard running={false} success unavailable={false} command="cmd" output="done" duration="7.4s" />)
    expect(screen.getByText('done')).toBeInTheDocument()
    expect(screen.getByText('7.4s')).toBeInTheDocument()
  })
  it('shows an Install button when unavailable', () => {
    render(<ToolCard running={false} success={false} unavailable toolName="pmapper" reason="not installed" installCmd="pip install principalmapper" />)
    expect(screen.getByText(/Install/)).toBeInTheDocument()
    expect(screen.getByText('pip install principalmapper')).toBeInTheDocument()
  })
})
