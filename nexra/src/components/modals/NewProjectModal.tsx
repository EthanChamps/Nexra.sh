import type { Dispatch } from 'react'
import { Hoverable } from '../Hoverable'
import { theme } from '../../theme'
import type { AppState } from '../../state/selectors'
import type { Action } from '../../state/reducer'

export function NewProjectModal({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const close = () => dispatch({ t: 'closeNewProject' })
  const create = () => dispatch({ t: 'createCompany' })
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
          width: 440, maxWidth: '100%', background: theme.card2, border: `1px solid ${theme.border2}`,
          borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ padding: '20px 22px 4px' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>New Project</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.muted, marginTop: 5 }}>
            Create a client workspace. You'll add engagements to it next.
          </div>
        </div>
        <div style={{ padding: '18px 22px 6px' }}>
          <div
            style={{
              fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', color: theme.dim2,
              textTransform: 'uppercase', marginBottom: 7,
            }}
          >
            Company / client name
          </div>
          <input
            value={state.ui.newCompanyName}
            onChange={e => dispatch({ t: 'setNewCompanyName', value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') create()
              else if (e.key === 'Escape') close()
            }}
            autoFocus
            placeholder="Acme Corp"
            style={{
              width: '100%', background: theme.input, border: `1px solid ${theme.border2}`, borderRadius: 9,
              padding: '9px 12px', fontFamily: 'inherit', fontSize: 13, color: theme.text, outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 22px 20px' }}>
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
            Create project
          </Hoverable>
        </div>
      </div>
    </div>
  )
}
