import type { Dispatch } from 'react'
import { Hoverable } from '../Hoverable'
import { theme } from '../../theme'
import type { AppState } from '../../state/selectors'
import type { Action } from '../../state/reducer'

export function DeleteProjectModal({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const id = state.ui.confirmDeleteCompanyId
  const company = state.data.companies.find(c => c.id === id)
  const close = () => dispatch({ t: 'cancelDeleteCompany' })
  const confirm = () => dispatch({ t: 'confirmDeleteCompany' })
  if (!company) return null

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
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>Delete project</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.muted, marginTop: 5 }}>
            Delete "{company.name}" and all its engagements and chats? This can't be undone.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '18px 22px 20px' }}>
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
            onClick={confirm}
            baseStyle={{
              padding: '8px 17px', borderRadius: 9, border: 'none', background: '#f0616d', color: '#fff',
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: 'background .12s',
            }}
            hoverStyle={{ background: 'rgba(240,97,109,0.85)' }}
          >
            Delete project
          </Hoverable>
        </div>
      </div>
    </div>
  )
}
