import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Hoverable } from '../src/components/Hoverable'

describe('Hoverable', () => {
  it('passes plain children through unchanged', () => {
    render(<Hoverable as="div" baseStyle={{}}>plain child</Hoverable>)
    expect(screen.getByText('plain child')).toBeInTheDocument()
  })
  it('invokes function children with the current hover state', () => {
    render(
      <Hoverable as="div" baseStyle={{}} data-testid="card">
        {(hovered: boolean) => <span>{hovered ? 'hovered' : 'idle'}</span>}
      </Hoverable>
    )
    expect(screen.getByText('idle')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByTestId('card'))
    expect(screen.getByText('hovered')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('card'))
    expect(screen.getByText('idle')).toBeInTheDocument()
  })
})
