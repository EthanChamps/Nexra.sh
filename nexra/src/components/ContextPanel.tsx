import { useState, type Dispatch } from 'react'
import { Hoverable } from './Hoverable'
import { SecretsPanel } from './SecretsPanel'
import { SecretModal } from './modals/SecretModal'
import { theme } from '../theme'
import type { AppState } from '../state/selectors'
import { activeEngagement, activeChat, phaseLabel, sevColor } from '../state/selectors'
import type { Action } from '../state/reducer'

export function ContextPanel({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const eng = activeEngagement(state)
  const chat = activeChat(state)
  const hasChat = !!eng && !!chat
  if (!hasChat) return null

  const [tab, setTab] = useState<'scope' | 'secrets' | 'findings' | 'tools'>('scope')
  const [secretModalOpen, setSecretModalOpen] = useState(false)
  const { rightOpen } = state.ui
  const toggleRight = () => dispatch({ t: 'toggleRight' })

  if (!rightOpen) {
    return (
      <Hoverable
        as="button"
        type="button"
        onClick={toggleRight}
        title="Show context panel"
        hoverStyle={{ background: theme.card }}
        baseStyle={{ width: 40, flex: 'none', background: theme.panel, border: 'none', borderLeft: `1px solid ${theme.border}`, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 16, color: theme.dim, transition: 'background .12s' }}
      >
        <span style={{ fontSize: 14 }}>‹</span>
        <span style={{ writingMode: 'vertical-rl', fontSize: 10.5, letterSpacing: '0.14em', color: theme.dim2 }}>CONTEXT</span>
      </Hoverable>
    )
  }

  const chatFocusLabel = phaseLabel(eng, chat!.phaseId)
  const scope = eng!.scope
  const findings = chat!.findings.map(f => ({ ...f, color: sevColor(f.sev) }))
  const findingsCount = findings.length
  const findingsEmpty = findings.length === 0
  const tools = chat!.tools.map(t => ({
    name: t.name,
    statusLabel: t.available ? 'available' : 'missing',
    color: t.available ? '#46c47f' : '#e6a23c',
  }))

  return (
    <aside data-screen-label="Context panel" style={{ width: 322, flex: 'none', background: theme.panel, borderLeft: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 16px 13px', borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', color: theme.textDim }}>{chatFocusLabel ? 'CONTEXT · ' + chatFocusLabel : 'CONTEXT'}</div>
        <Hoverable
          as="button"
          type="button"
          onClick={toggleRight}
          title="Collapse"
          hoverStyle={{ color: theme.textDim, background: 'rgba(255,255,255,0.05)' }}
          baseStyle={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: theme.dim, cursor: 'pointer', fontSize: 14, transition: 'all .12s' }}
        >
          ›
        </Hoverable>
      </div>

      <div style={{ flex: 'none', display: 'flex', gap: 1, borderBottom: `1px solid ${theme.border}`, background: theme.bg2 }}>
        {['scope', 'secrets', 'findings', 'tools'].map(tabName => (
          <button
            key={tabName}
            onClick={() => setTab(tabName as any)}
            style={{
              flex: 1,
              padding: '10px 8px',
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              border: 'none',
              background: tab === tabName ? theme.accent : 'transparent',
              color: tab === tabName ? theme.bg : theme.dim,
              cursor: 'pointer',
              transition: 'all .12s',
            }}
          >
            {tabName}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {tab === 'scope' && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 10 }}>Scope</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, overflow: 'hidden', marginBottom: 24 }}>
              {scope.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ flex: 'none', width: 82, fontSize: 11.5, color: theme.dim }}>{s.label}</span>
                  <span style={{ flex: 1, fontFamily: theme.mono, fontSize: 11.5, color: theme.textDim, wordBreak: 'break-word' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'secrets' && eng && (
          <>
            <SecretsPanel companyId={eng.companyId} onCreateClick={() => setSecretModalOpen(true)} />
            {secretModalOpen && <SecretModal companyId={eng.companyId} onClose={() => setSecretModalOpen(false)} onSave={() => { setSecretModalOpen(false) }} />}
          </>
        )}

        {tab === 'findings' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: theme.dim2, textTransform: 'uppercase' }}>Findings</span>
              <span style={{ fontFamily: theme.mono, fontSize: 10.5, color: theme.dim, background: 'rgba(255,255,255,0.05)', padding: '1px 7px', borderRadius: 5 }}>{findingsCount}</span>
            </div>
            {findingsEmpty && (
              <div style={{ padding: '16px 12px', border: '1px dashed rgba(255,255,255,0.09)', borderRadius: 9, textAlign: 'center', fontSize: 12, color: theme.dim2, marginBottom: 24 }}>No findings logged in this chat yet.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 24 }}>
              {findings.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9 }}>
                  <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: f.color, marginTop: 5 }}></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#dfe2e6', marginBottom: 5 }}>{f.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: f.color }}>{f.sev}</span>
                      <span style={{ fontSize: 10.5, color: theme.dim2 }}>{f.phase} · {f.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'tools' && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 10 }}>Chat Tools</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {tools.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: theme.card, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
                  <span style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: t.color }}></span>
                  <span style={{ flex: 1, fontFamily: theme.mono, fontSize: 12, color: theme.textDim }}>{t.name}</span>
                  <span style={{ fontSize: 10.5, color: t.color }}>{t.statusLabel}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
