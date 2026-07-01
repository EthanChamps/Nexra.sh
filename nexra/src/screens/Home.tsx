import type { Dispatch } from 'react'
import { Hoverable } from '../components/Hoverable'
import { NewProjectModal } from '../components/modals/NewProjectModal'
import { theme } from '../theme'
import type { AppState } from '../state/selectors'
import { statusColor } from '../state/selectors'
import type { Action } from '../state/reducer'

export function Home({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const companies = state.data.companies.map(c => ({
    id: c.id,
    name: c.name,
    engCountLabel: c.engagements.length + (c.engagements.length === 1 ? ' engagement' : ' engagements'),
    updated: c.updated,
    empty: c.engagements.length === 0,
    chips: c.engagements.slice(0, 5).map(e => ({ short: state.data.types[e.type].short, color: statusColor(e.status) })),
  }))

  const openCompany = (id: string) => dispatch({ t: 'openCompany', id })
  const openNewProject = () => dispatch({ t: 'openNewProject' })
  const openSettings = () => dispatch({ t: 'openSettings' })

  return (
    <div style={{ height: '100vh', width: '100vw', overflowY: 'auto', background: theme.bg, display: 'flex', flexDirection: 'column' }}>
      <header style={{ flex: 'none', borderBottom: `1px solid ${theme.border}`, background: theme.panel }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '15px 28px' }}>
          <div
            style={{
              flex: 'none', width: 30, height: 30, borderRadius: 8,
              background: 'linear-gradient(160deg,#7d5cff,#5866f0)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#fff',
            }}
          >
            ◆
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', color: theme.text }}>NEXRA.SH</div>
            <div style={{ fontSize: 10, color: theme.dim, letterSpacing: '0.04em' }}>Security Assistant</div>
          </div>
          <div style={{ flex: 1 }} />
          <Hoverable
            as="button"
            type="button"
            onClick={openSettings}
            title="Settings"
            baseStyle={{
              flex: 'none', width: 32, height: 32, borderRadius: 9, border: `1px solid ${theme.border2}`,
              background: theme.card, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, color: theme.muted2, cursor: 'pointer', transition: 'all .12s',
            }}
            hoverStyle={{ color: theme.textDim, borderColor: 'rgba(255,255,255,0.16)', background: theme.card2 }}
          >
            ⚙
          </Hoverable>
        </div>
      </header>

      <div style={{ flex: 1, width: '100%', maxWidth: 1040, margin: '0 auto', padding: '36px 28px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 23, fontWeight: 600, letterSpacing: '-0.01em', color: theme.text }}>Projects</h1>
            <div style={{ marginTop: 6, fontSize: 13, color: theme.muted }}>
              Each project is a client. Open one to run engagements against it.
            </div>
          </div>
          <Hoverable
            as="button"
            type="button"
            onClick={openNewProject}
            baseStyle={{
              flex: 'none', display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px',
              borderRadius: 10, border: 'none', background: theme.accent, color: '#fff', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'background .12s',
            }}
            hoverStyle={{ background: theme.accentHover }}
          >
            <span style={{ fontSize: 16, lineHeight: 0, marginTop: -1 }}>+</span> New Project
          </Hoverable>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(304px,1fr))', gap: 14 }}>
          {companies.map(c => (
            <Hoverable
              key={c.id}
              as="button"
              type="button"
              onClick={() => openCompany(c.id)}
              baseStyle={{
                textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 14, padding: '17px 17px 15px',
                borderRadius: 13, border: '1px solid rgba(255,255,255,0.08)', background: theme.card, cursor: 'pointer',
                color: 'inherit', fontFamily: 'inherit', transition: 'border-color .14s,background .14s',
              }}
              hoverStyle={{ borderColor: 'rgba(111,123,240,0.4)', background: theme.card2 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 15.5, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {c.name}
                  </div>
                  <div style={{ marginTop: 3, fontFamily: theme.mono, fontSize: 11, color: theme.dim }}>
                    {c.engCountLabel} · {c.updated}
                  </div>
                </div>
                <span style={{ flex: 'none', fontSize: 17, color: theme.dim2, lineHeight: 0 }}>›</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 24 }}>
                {c.chips.map((ch, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 8px', borderRadius: 6,
                      background: theme.input, border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <span style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: ch.color }} />
                    <span style={{ fontFamily: theme.mono, fontSize: 10.5, color: theme.muted2 }}>{ch.short}</span>
                  </span>
                ))}
                {c.empty && (
                  <span style={{ fontSize: 11.5, color: theme.dim2, alignSelf: 'center' }}>No engagements yet</span>
                )}
              </div>
            </Hoverable>
          ))}

          <Hoverable
            as="button"
            type="button"
            onClick={openNewProject}
            baseStyle={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              minHeight: 112, borderRadius: 13, border: '1px dashed rgba(255,255,255,0.13)', background: 'transparent',
              cursor: 'pointer', color: theme.dim, fontFamily: 'inherit', transition: 'all .14s',
            }}
            hoverStyle={{ borderColor: 'rgba(111,123,240,0.4)', color: theme.accentSoft2 }}
          >
            <span style={{ fontSize: 22, lineHeight: 0 }}>+</span>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>New Project</span>
          </Hoverable>
        </div>
      </div>

      {state.ui.newProjectOpen && <NewProjectModal state={state} dispatch={dispatch} />}
    </div>
  )
}
