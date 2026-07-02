import type { Dispatch, KeyboardEvent } from 'react'
import { Hoverable } from './Hoverable'
import { theme } from '../theme'
import type { Action } from '../state/reducer'

export function Composer({
  draft,
  placeholder,
  dispatch,
  onSend = () => {},
  busy = false,
  onStop = () => {},
}: {
  draft: string
  placeholder: string
  dispatch: Dispatch<Action>
  onSend?: () => void
  busy?: boolean
  onStop?: () => void
}) {
  const onDraft = (e: React.ChangeEvent<HTMLInputElement>) => dispatch({ t: 'setDraft', value: e.target.value })
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!busy) onSend()
    }
  }
  const toggleTerminal = () => dispatch({ t: 'toggleTerminal' })

  return (
    <div style={{ flex: 'none', borderTop: `1px solid ${theme.border}`, padding: '14px 20px 18px', background: '#0b0c0f' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 20, border: `1px solid ${theme.border2}`, background: theme.input, padding: '14px 14px 10px 18px' }}>
          <input
            value={draft}
            onChange={onDraft}
            onKeyDown={onKey}
            placeholder={placeholder}
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: theme.text, fontFamily: 'inherit', fontSize: 15, padding: '4px 2px 14px 0' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Hoverable
              as="button"
              type="button"
              title="Attach"
              hoverStyle={{ color: '#c9cdd4', background: 'rgba(255,255,255,0.06)' }}
              baseStyle={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: theme.muted2, fontSize: 19, cursor: 'pointer', transition: 'all .12s' }}
            >
              +
            </Hoverable>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Hoverable
                as="button"
                type="button"
                onClick={toggleTerminal}
                title="Open terminal (Ctrl+`) — shared with the agent"
                hoverStyle={{ borderColor: 'rgba(91,212,147,0.4)', background: '#1b1d23' }}
                baseStyle={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: `1px solid ${theme.border2}`, background: theme.card, cursor: 'pointer', transition: 'all .12s', padding: 0 }}
              >
                <span style={{ fontFamily: theme.mono, fontSize: 13, color: theme.ok2, letterSpacing: '-1px' }}>›_</span>
              </Hoverable>
              {busy ? (
                <Hoverable
                  as="button"
                  type="button"
                  onClick={onStop}
                  title="Stop"
                  hoverStyle={{ background: theme.accentHover }}
                  baseStyle={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', border: 'none', background: theme.accent, color: '#fff', fontSize: 12, cursor: 'pointer', transition: 'background .12s' }}
                >
                  ■
                </Hoverable>
              ) : (
                <Hoverable
                  as="button"
                  type="button"
                  onClick={onSend}
                  title="Send"
                  hoverStyle={{ background: theme.accentHover }}
                  baseStyle={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', border: 'none', background: theme.accent, color: '#fff', fontSize: 15, cursor: 'pointer', transition: 'background .12s' }}
                >
                  ↑
                </Hoverable>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
