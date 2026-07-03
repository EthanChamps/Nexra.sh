import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TypingIndicator } from '../src/components/TypingIndicator'

describe('TypingIndicator', () => {
  it('renders three pulsing dots inside a status region', () => {
    render(<TypingIndicator />)
    const status = screen.getByRole('status', { name: /responding/i })
    expect(status.children).toHaveLength(3)
  })
})
