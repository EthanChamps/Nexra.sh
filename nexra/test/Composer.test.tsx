import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Composer } from '../src/components/Composer'

describe('Composer busy-lock', () => {
  it('shows Send (not Stop) when idle and calls onSend', () => {
    const onSend = vi.fn()
    render(<Composer draft="hi" placeholder="p" dispatch={() => {}} onSend={onSend} busy={false} onStop={() => {}} />)
    const send = screen.getByTitle('Send')
    send.click()
    expect(onSend).toHaveBeenCalled()
    expect(screen.queryByTitle('Stop')).toBeNull()
  })
  it('shows Stop and calls onStop when busy', () => {
    const onStop = vi.fn()
    render(<Composer draft="hi" placeholder="p" dispatch={() => {}} onSend={() => {}} busy={true} onStop={onStop} />)
    const stop = screen.getByTitle('Stop')
    stop.click()
    expect(onStop).toHaveBeenCalled()
    expect(screen.queryByTitle('Send')).toBeNull()
  })
})
