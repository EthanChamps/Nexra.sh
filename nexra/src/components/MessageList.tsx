import { useEffect, useRef } from 'react'
import { theme } from '../theme'
import type { Chat, Message } from '../../electron/services/store.types'
import { ToolCard } from './ToolCard'
import { MarkdownMessage } from './MarkdownMessage'
import { TypingIndicator } from './TypingIndicator'

export function MessageList({ chat, streaming, onInstall }: { chat: Chat; streaming: boolean; onInstall?: (msg: Message) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Read scroll layout after paint (matches the prototype's scrollChat), since messages
    // (including streamed tool cards) can change the content height right before this runs.
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [chat.messages, streaming])

  const lastMessage = chat.messages[chat.messages.length - 1]
  const showTyping = streaming && lastMessage?.role === 'user'

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '26px 20px 30px', background: theme.bg }}>
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {chat.messages.map(m => (
          <div key={m.id}>
            {m.kind === 'text' && m.role === 'assistant' && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', width: 26, height: 26, borderRadius: 7, background: 'rgba(111,123,240,0.16)', color: '#9aa2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, marginTop: 1 }}>◆</span>
                <div style={{ maxWidth: 700, paddingTop: 3 }}>
                  <MarkdownMessage content={m.content ?? ''} />
                </div>
              </div>
            )}
            {m.kind === 'text' && m.role === 'user' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: 560, background: theme.input, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '10px 14px', fontSize: 14, lineHeight: 1.55, color: theme.text, whiteSpace: 'pre-wrap' }}>{m.content}</div>
              </div>
            )}
            {m.kind === 'tool' && (
              <ToolCard
                running={m.state === 'running'}
                success={m.state === 'success'}
                unavailable={m.state === 'unavailable'}
                command={m.command}
                output={m.output}
                duration={m.duration}
                toolName={m.toolName}
                reason={m.reason}
                installCmd={m.installCmd}
                onInstall={onInstall ? () => onInstall(m) : undefined}
              />
            )}
          </div>
        ))}
        {showTyping && <TypingIndicator />}
      </div>
    </div>
  )
}
