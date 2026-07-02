import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageList } from '../src/components/MessageList'
import type { Chat } from '../electron/services/store.types'

const baseChat = { id: 'c1', name: 'Chat', phaseId: '', color: '#000', tools: [], findings: [] } as unknown as Chat

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
})
