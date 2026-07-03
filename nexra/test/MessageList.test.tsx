import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageList } from '../src/components/MessageList'
import type { Chat } from '../electron/services/store.types'

const baseChat = { id: 'c1', name: 'Chat', phaseId: '', color: '#000', tools: [], findings: [] } as unknown as Chat

function mockScrollGeometry(el: HTMLElement, { scrollTop, scrollHeight, clientHeight }: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('MessageList', () => {
  it('renders assistant markdown content with formatting', () => {
    const chat = { ...baseChat, messages: [{ id: 'a1', role: 'assistant', kind: 'text', content: 'Hello **world**' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    expect(screen.getByText('world').tagName).toBe('STRONG')
  })

  it('renders user content as plain text, not markdown', () => {
    const chat = { ...baseChat, messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'Hello **world**' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    expect(screen.getByText('Hello **world**')).toBeInTheDocument()
    expect(screen.queryByText('world')).not.toBeInTheDocument()
  })

  it('shows the typing indicator while streaming and the last message is the user\'s', () => {
    const chat = { ...baseChat, messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'hi' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming />)
    expect(screen.getByRole('status', { name: /responding/i })).toBeInTheDocument()
  })

  it('hides the typing indicator once an assistant message has started', () => {
    const chat = {
      ...baseChat,
      messages: [
        { id: 'u1', role: 'user', kind: 'text', content: 'hi' },
        { id: 'a1', role: 'assistant', kind: 'text', content: 'Hi there' },
      ],
    } as unknown as Chat
    render(<MessageList chat={chat} streaming />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hides the typing indicator when not streaming', () => {
    const chat = { ...baseChat, messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'hi' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a jump-to-bottom button once the user scrolls away from the bottom', () => {
    const chat = { ...baseChat, messages: [{ id: 'a1', role: 'assistant', kind: 'text', content: 'hi' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    const scroller = screen.getByTestId('message-scroll')
    expect(screen.queryByTitle('Jump to bottom')).not.toBeInTheDocument()

    mockScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 })
    fireEvent.scroll(scroller)

    expect(screen.getByTitle('Jump to bottom')).toBeInTheDocument()
  })

  it('hides the jump-to-bottom button once scrolled back near the bottom', () => {
    const chat = { ...baseChat, messages: [{ id: 'a1', role: 'assistant', kind: 'text', content: 'hi' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    const scroller = screen.getByTestId('message-scroll')

    mockScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 })
    fireEvent.scroll(scroller)
    expect(screen.getByTitle('Jump to bottom')).toBeInTheDocument()

    mockScrollGeometry(scroller, { scrollTop: 620, scrollHeight: 1000, clientHeight: 400 })
    fireEvent.scroll(scroller)
    expect(screen.queryByTitle('Jump to bottom')).not.toBeInTheDocument()
  })

  it('does not force-scroll to bottom on new messages once the user has scrolled up', () => {
    const chat = { ...baseChat, messages: [{ id: 'a1', role: 'assistant', kind: 'text', content: 'hi' }] } as unknown as Chat
    const { rerender } = render(<MessageList chat={chat} streaming={false} />)
    const scroller = screen.getByTestId('message-scroll')

    mockScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 })
    fireEvent.scroll(scroller)
    expect(screen.getByTitle('Jump to bottom')).toBeInTheDocument()

    const setScrollTop = vi.fn()
    Object.defineProperty(scroller, 'scrollTop', { get: () => 0, set: setScrollTop, configurable: true })

    const chat2 = { ...baseChat, messages: [...chat.messages, { id: 'a2', role: 'assistant', kind: 'text', content: 'more' }] } as unknown as Chat
    rerender(<MessageList chat={chat2} streaming={false} />)

    expect(setScrollTop).not.toHaveBeenCalled()
  })

  it('clicking jump-to-bottom scrolls the container and hides the button', () => {
    const chat = { ...baseChat, messages: [{ id: 'a1', role: 'assistant', kind: 'text', content: 'hi' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    const scroller = screen.getByTestId('message-scroll')
    mockScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 })
    fireEvent.scroll(scroller)

    const scrollTo = vi.fn()
    ;(scroller as any).scrollTo = scrollTo

    fireEvent.click(screen.getByTitle('Jump to bottom'))

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
    expect(screen.queryByTitle('Jump to bottom')).not.toBeInTheDocument()
  })
})
