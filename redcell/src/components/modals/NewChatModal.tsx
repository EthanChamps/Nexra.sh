import type { Dispatch } from 'react'
import { Hoverable } from '../Hoverable'
import { theme } from '../../theme'
import type { AppState } from '../../state/selectors'
import { activeEngagement, phaseLabel } from '../../state/selectors'
import type { Action } from '../../state/reducer'
import { chatColors } from '../../../electron/services/seed'

export function NewChatModal({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const close = () => dispatch({ t: 'closeNewChat' })
  const create = () => dispatch({ t: 'createChat' })
  const eng = activeEngagement(state)
  const activeName = eng ? eng.name : ''

  const chatFocusOptions = (eng ? eng.phases : []).map(p => ({
    id: p.id, label: p.label, selected: p.id === state.ui.newChatFocus,
  }))

  const selectedFocusLabel = phaseLabel(eng, state.ui.newChatFocus)

  const newChatColorOptions = chatColors.map(c => ({
    ...c, selected: c.bg === state.ui.newChatColor,
  }))

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(6,7,9,0.68)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 452, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', background: theme.card2,
          border: `1px solid ${theme.border2}`, borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ padding: '20px 22px 4px' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>New Chat</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.muted, marginTop: 5 }}>
            In <span style={{ color: theme.textDim, fontWeight: 500 }}>{activeName}</span>. Each chat is its own context window with its own agent thread.
          </div>
        </div>

        <div style={{ padding: '16px 22px 4px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 8 }}>
            Focus
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {chatFocusOptions.map(fo => (
              fo.selected ? (
                <button
                  key={fo.id}
                  type="button"
                  onClick={() => dispatch({ t: 'setNewChatFocus', id: fo.id })}
                  style={{
                    padding: '7px 13px', borderRadius: 8, border: '1px solid rgba(111,123,240,0.45)',
                    background: 'rgba(111,123,240,0.14)', color: theme.accentSoft2, fontFamily: 'inherit',
                    fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {fo.label}
                </button>
              ) : (
                <Hoverable
                  key={fo.id}
                  as="button"
                  type="button"
                  onClick={() => dispatch({ t: 'setNewChatFocus', id: fo.id })}
                  baseStyle={{
                    padding: '7px 13px', borderRadius: 8, border: `1px solid ${theme.border2}`, background: 'transparent',
                    color: theme.muted2, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: 'all .12s',
                  }}
                  hoverStyle={{ background: 'rgba(255,255,255,0.04)', color: theme.textDim }}
                >
                  {fo.label}
                </Hoverable>
              )
            ))}
          </div>
        </div>

        <div style={{ padding: '16px 22px 4px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 7 }}>
            Chat name (optional)
          </div>
          <input
            value={state.ui.newChatName}
            onChange={e => dispatch({ t: 'setNewChatName', value: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') create() }}
            autoFocus
            placeholder={selectedFocusLabel}
            style={{
              width: '100%', background: theme.input, border: `1px solid ${theme.border2}`, borderRadius: 9,
              padding: '9px 12px', fontFamily: 'inherit', fontSize: 13, color: theme.text, outline: 'none',
            }}
          />
        </div>

        <div style={{ padding: '16px 22px 6px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 9 }}>
            Background colour
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {newChatColorOptions.map(co => (
              <button
                key={co.id}
                type="button"
                onClick={() => dispatch({ t: 'setNewChatColor', bg: co.bg })}
                title={co.id}
                style={{
                  position: 'relative', width: 34, height: 34, borderRadius: 9, background: co.bg,
                  border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: 0,
                }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 3, background: co.dot }} />
                {co.selected && (
                  <span style={{ position: 'absolute', inset: -3, border: `1.5px solid ${theme.accent}`, borderRadius: 12 }} />
                )}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '16px 22px 20px' }}>
          <Hoverable
            as="button"
            type="button"
            onClick={close}
            baseStyle={{
              padding: '8px 15px', borderRadius: 9, border: `1px solid ${theme.border2}`, background: 'transparent',
              color: theme.muted2, fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', transition: 'all .12s',
            }}
            hoverStyle={{ color: theme.textDim, borderColor: 'rgba(255,255,255,0.16)' }}
          >
            Cancel
          </Hoverable>
          <Hoverable
            as="button"
            type="button"
            onClick={create}
            baseStyle={{
              padding: '8px 17px', borderRadius: 9, border: 'none', background: theme.accent, color: '#fff',
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: 'background .12s',
            }}
            hoverStyle={{ background: theme.accentHover }}
          >
            Create chat
          </Hoverable>
        </div>
      </div>
    </div>
  )
}
