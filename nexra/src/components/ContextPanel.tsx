import { useState, useEffect, type Dispatch } from 'react'
import { Hoverable } from './Hoverable'
import { SecretsPanel } from './SecretsPanel'
import { SecretModal } from './modals/SecretModal'
import { theme } from '../theme'
import type { AppState } from '../state/selectors'
import { activeEngagement, activeCompany, activeChat, phaseLabel, sevColor } from '../state/selectors'
import type { Action } from '../state/reducer'
import type { EngagementScope } from '../../electron/services/store.types'

// Render the REAL, enforced scope record (never a placeholder). Only non-empty
// dimensions are shown; `mode:'all'` means the gate is off.
function toScopeRows(sc: EngagementScope | undefined): { label: string; value: string }[] {
  if (!sc) return []
  if (sc.mode === 'all') return [{ label: 'Mode', value: 'All (no restrictions)' }]
  const rows: { label: string; value: string }[] = []
  const add = (label: string, arr?: string[]) => { if (arr && arr.length) rows.push({ label, value: arr.join(', ') }) }
  add('Hosts', sc.hosts); add('Wildcards', sc.wildcards); add('URL prefixes', sc.urlPrefixes)
  add('Accounts', sc.accounts); add('Regions', sc.regions); add('Tenants', sc.tenants)
  add('Exclusions', sc.exclusions)
  return rows
}

export function ContextPanel({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const eng = activeEngagement(state)
  const company = activeCompany(state)
  const chat = activeChat(state)
  const hasChat = !!eng && !!chat
  if (!hasChat) return null

  const [tab, setTab] = useState<'scope' | 'secrets' | 'findings'>('scope')
  const [secretModalOpen, setSecretModalOpen] = useState(false)
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null)
  const [realScope, setRealScope] = useState<EngagementScope | undefined>(undefined)
  useEffect(() => {
    let off = false
    const id = eng?.id
    const p = id ? window.nexra?.scope?.get(id) : undefined
    if (p) p.then(sc => { if (!off) setRealScope(sc) })
    else setRealScope(undefined)
    return () => { off = true }
  }, [eng?.id, chat?.id])
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
  const scopeRows = toScopeRows(realScope)
  const findings = chat!.findings.map(f => ({ ...f, color: sevColor(f.sev) }))
  const findingsCount = findings.length
  const findingsEmpty = findings.length === 0

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

      <div style={{ flex: 'none', display: 'flex', gap: 1, borderBottom: `1px solid ${theme.border}`, background: theme.card }}>
        {['scope', 'secrets', 'findings'].map(tabName => (
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
            {scopeRows.length === 0 ? (
              <div style={{ padding: '16px 12px', border: '1px dashed rgba(255,255,255,0.09)', borderRadius: 9, textAlign: 'center', fontSize: 12, color: theme.dim2, marginBottom: 24 }}>No scope set yet — the agent will ask before it runs.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, overflow: 'hidden', marginBottom: 24 }}>
                {scopeRows.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ flex: 'none', width: 82, fontSize: 11.5, color: theme.dim }}>{s.label}</span>
                    <span style={{ flex: 1, fontFamily: theme.mono, fontSize: 11.5, color: theme.textDim, wordBreak: 'break-word' }}>{s.value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'secrets' && eng && company && (
          <>
            <SecretsPanel companyId={company.id} onCreateClick={() => setSecretModalOpen(true)} />
            {secretModalOpen && <SecretModal companyId={company.id} onClose={() => setSecretModalOpen(false)} onSave={() => { setSecretModalOpen(false) }} />}
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
              {findings.map(f => {
                const open = expandedFinding === f.id
                return (
                  <div key={f.id} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, overflow: 'hidden' }}>
                    <div onClick={() => setExpandedFinding(open ? null : f.id)} style={{ display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
                      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: f.color, marginTop: 5 }}></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#dfe2e6', marginBottom: 5 }}>{f.title}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: f.color }}>{f.sev}</span>
                          <span style={{ fontSize: 10.5, color: theme.dim2 }}>{f.phase} · {f.time}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: f.verified ? theme.ok : theme.warn }}>{f.verified ? 'Verified' : 'Unverified'}</span>
                        </div>
                      </div>
                    </div>
                    {open && (
                      <div style={{ padding: '0 12px 11px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        {f.rationale && <div style={{ fontSize: 11.5, color: theme.dim, margin: '9px 0' }}>{f.rationale}</div>}
                        {f.evidence.map((ev, ei) => (
                          <div key={ei} style={{ marginTop: 8 }}>
                            {ev.kind === 'tool_output' && (
                              <pre style={{ margin: 0, padding: '8px 10px', background: theme.card2, border: `1px solid ${theme.border}`, borderRadius: 7, fontFamily: theme.mono, fontSize: 11, color: theme.textDim, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflowY: 'auto' }}>{ev.excerpt}</pre>
                            )}
                            {ev.kind === 'code_block' && (
                              <div style={{ padding: '8px 10px', background: theme.card2, border: `1px solid ${theme.border}`, borderRadius: 7 }}>
                                <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.textDim }}>{ev.host}</div>
                                <div style={{ fontSize: 11.5, color: theme.dim, marginTop: 3 }}>{ev.detail}</div>
                              </div>
                            )}
                          </div>
                        ))}
                        {f.evidence.length === 0 && <div style={{ fontSize: 11.5, color: theme.warn, marginTop: 9 }}>Awaiting evidence.</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
