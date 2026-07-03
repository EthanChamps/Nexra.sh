import { useEffect, useRef, useState } from 'react'
import { theme } from '../theme'
import type { Chat, Message } from '../../electron/services/store.types'
import { ToolCard } from './ToolCard'
import { MarkdownMessage } from './MarkdownMessage'
import { TypingIndicator } from './TypingIndicator'
import { RequestCard } from './RequestCard'
import { Hoverable } from './Hoverable'

const BOTTOM_THRESHOLD = 64

export function MessageList({ chat, streaming, onInstall, companyId, onResume }: { chat: Chat; streaming: boolean; onInstall?: (msg: Message) => void; companyId?: string; onResume?: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
    atBottomRef.current = atBottom
    setShowJump(!atBottom)
  }

  const jumpToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    atBottomRef.current = true
    setShowJump(false)
  }

  useEffect(() => {
    // Only auto-follow if the user was already at the bottom — otherwise a streamed
    // token would yank them back down every time they try to scroll up to read history.
    if (!atBottomRef.current) return
    // Read scroll layout after paint (matches the prototype's scrollChat), since messages
    // (including streamed tool cards) can change the content height right before this runs.
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [chat.messages, streaming])

  const lastMessage = chat.messages[chat.messages.length - 1]
  // Show the indicator whenever a stream is active and the trailing message
  // isn't yet in-progress assistant prose — covers the normal user-message
  // case AND resuming after a request card (which posts no user bubble), so
  // the operator sees SOMETHING is happening rather than a dead chat.
  const showTyping = streaming && !(lastMessage?.role === 'assistant' && lastMessage?.kind === 'text')

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
      <div ref={scrollRef} onScroll={handleScroll} data-testid="message-scroll" style={{ flex: 1, overflowY: 'auto', padding: '26px 20px 30px', background: theme.bg }}>
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
            {m.kind === 'request' && (
              <RequestCard message={m} companyId={companyId} onFulfill={onResume ?? (() => {})} />
            )}
          </div>
        ))}
        {showTyping && <TypingIndicator />}
      </div>
      </div>
      {showJump && (
        <Hoverable
          as="button"
          type="button"
          onClick={jumpToBottom}
          title="Jump to bottom"
          hoverStyle={{ color: theme.text, background: 'rgba(255,255,255,0.1)' }}
          baseStyle={{
            position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px',
            borderRadius: 20, border: '1px solid rgba(255,255,255,0.09)', background: theme.panel,
            color: theme.muted2, fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)', transition: 'all .12s',
          }}
        >
          ↓ Jump to bottom
        </Hoverable>
      )}
    </div>
  )
}
