import type { Dispatch } from 'react'
import { Hoverable } from '../Hoverable'
import { theme } from '../../theme'
import type { AppState } from '../../state/selectors'
import { activeCompany } from '../../state/selectors'
import type { Action } from '../../state/reducer'

export function NewEngagementModal({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const close = () => dispatch({ t: 'closeNew' })
  const create = () => dispatch({ t: 'createProject' })
  const company = activeCompany(state)
  const companyName = company ? company.name : ''

  const reviewTypes = Object.keys(state.data.types).map(id => {
    const cfg = state.data.types[id as keyof typeof state.data.types]
    return {
      id,
      label: cfg.label,
      desc: cfg.linear ? 'Recon → Exploit' : cfg.phases.map(x => x.label).join(' · '),
      selected: id === state.ui.selectedType,
    }
  })

  const selectedTypeLabel = state.data.types[state.ui.selectedType as keyof typeof state.data.types].label

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
          width: 472, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', background: theme.card2,
          border: `1px solid ${theme.border2}`, borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ padding: '20px 22px 4px' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>New Engagement</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.muted, marginTop: 5 }}>
            For <span style={{ color: theme.textDim, fontWeight: 500 }}>{companyName}</span>. Pick a review type — its phase focuses are fixed by type.
          </div>
        </div>

        <div style={{ padding: '16px 22px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reviewTypes.map(rt => (
            <Hoverable
              key={rt.id}
              as="button"
              type="button"
              onClick={() => dispatch({ t: 'setSelectedType', id: rt.id })}
              baseStyle={{
                position: 'relative', textAlign: 'left', width: '100%', display: 'flex', gap: 12,
                alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, border: `1px solid ${theme.border2}`,
                background: theme.card, cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', transition: 'border-color .12s',
              }}
              hoverStyle={{ borderColor: 'rgba(255,255,255,0.16)' }}
            >
              {rt.selected && (
                <span style={{ position: 'absolute', inset: 0, borderRadius: 10, border: `1.5px solid ${theme.accent}`, background: 'rgba(111,123,240,0.08)', pointerEvents: 'none' }} />
              )}
              <span style={{ position: 'relative', zIndex: 1, flex: 'none', width: 16, height: 16, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.25)', marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {rt.selected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.accent }} />}
              </span>
              <span style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: theme.text, marginBottom: 3 }}>{rt.label}</span>
                <span style={{ display: 'block', fontFamily: theme.mono, fontSize: 11, color: theme.dim2 }}>{rt.desc}</span>
              </span>
            </Hoverable>
          ))}
        </div>

        <div style={{ padding: '16px 22px 6px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 7 }}>
            Display name (optional)
          </div>
          <input
            value={state.ui.newName}
            onChange={e => dispatch({ t: 'setNewName', value: e.target.value })}
            placeholder={selectedTypeLabel}
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
            Create engagement
          </Hoverable>
        </div>
      </div>
    </div>
  )
}
