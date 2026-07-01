import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolCard } from '../src/components/ToolCard'

describe('ToolCard', () => {
  it('shows Running state with the command', () => {
    render(<ToolCard running success={false} unavailable={false} command="nmap -sn 10.0.0.0/24" />)
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('nmap -sn 10.0.0.0/24')).toBeInTheDocument()
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
