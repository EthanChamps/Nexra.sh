import { useState, useEffect } from 'react'
import type { ProjectScope, ScopeItem, ScopeItemType } from '../../electron/services/store.types'
import { theme } from '../theme'
import { Hoverable } from './Hoverable'

const TYPES: ScopeItemType[] = ['cidr', 'ip', 'hostname', 'url', 'cloud_account', 'tenant_id', 'region', 'other']
const PLACEHOLDER: Record<ScopeItemType, string> = {
  cidr: '10.0.0.0/24', ip: '10.0.0.5', hostname: 'app.acme.com', url: 'https://app.acme.com',
  cloud_account: '111111111111', tenant_id: 'contoso.onmicrosoft.com', region: 'us-east-1', other: 'note',
}

export function ScopePanel({ companyId }: { companyId: string }) {
  const [scope, setScope] = useState<ProjectScope>({ companyId, items: [], notes: '' })
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<ScopeItemType>('cloud_account')
  const [value, setValue] = useState('')

  useEffect(() => {
    let live = true
    window.nexra.projectScope.get(companyId).then(s => { if (live) { setScope(s); setLoading(false) } })
    return () => { live = false }
  }, [companyId])

  const add = async () => {
    const v = value.trim()
    if (!v) return
    const item = await window.nexra.projectScope.add(companyId, { type, value: v, source: 'user' })
    setScope(s => ({ ...s, items: [...s.items, item] }))
    setValue('')
  }
  const remove = async (id: string) => {
    await window.nexra.projectScope.remove(companyId, id)
    setScope(s => ({ ...s, items: s.items.filter(i => i.id !== id) }))
  }
  const saveNotes = (notes: string) => {
    setScope(s => ({ ...s, notes }))
    window.nexra.projectScope.setNotes(companyId, notes)
  }

  if (loading) return <div style={{ padding: '12px', color: theme.dim }}>Loading scope…</div>

  const dot = (i: ScopeItem) => (i.source === 'agent' ? theme.accent : theme.dim2)

  return (
    <>
      <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 10 }}>Scope</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, overflow: 'hidden', marginBottom: 12 }}>
        {scope.items.length === 0 && <div style={{ padding: '10px 12px', fontSize: 11.5, color: theme.dim2 }}>No scope yet. Add an authorized target below.</div>}
        {scope.items.map(i => (
          <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span title={i.source === 'agent' ? 'Added by agent' : 'Added by you'} style={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', background: dot(i) }} />
            <span style={{ flex: 'none', width: 82, fontSize: 11.5, color: theme.dim }}>{i.type}</span>
            <span style={{ flex: 1, fontFamily: theme.mono, fontSize: 11.5, color: theme.textDim, wordBreak: 'break-word' }}>{i.value}</span>
            <Hoverable as="button" type="button" title="Remove scope item" aria-label="Remove scope item" onClick={() => remove(i.id)}
              baseStyle={{ flex: 'none', width: 20, height: 20, borderRadius: 5, border: 'none', background: 'transparent', color: theme.dim2, cursor: 'pointer', fontSize: 13 }}
              hoverStyle={{ color: '#f0616d', background: 'rgba(240,97,109,0.1)' }}>×</Hoverable>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        <select aria-label="New scope type" value={type} onChange={e => setType(e.target.value as ScopeItemType)}
          style={{ flex: 'none', padding: '6px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: 4, color: theme.text, fontSize: 11.5 }}>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input aria-label="New scope value" value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder={PLACEHOLDER[type]}
          style={{ flex: 1, minWidth: 0, padding: '6px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: 4, color: theme.text, fontFamily: theme.mono, fontSize: 11.5 }} />
        <button type="button" onClick={add}
          style={{ flex: 'none', padding: '6px 10px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11.5 }}>Add</button>
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 10 }}>Notes</div>
      <textarea aria-label="Scope notes" value={scope.notes} onChange={e => saveNotes(e.target.value)}
        placeholder="Rules of engagement, exclusions, caveats…"
        style={{ width: '100%', minHeight: 90, resize: 'vertical', padding: '8px 10px', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, color: theme.textDim, fontSize: 12, lineHeight: 1.5, boxSizing: 'border-box' }} />
    </>
  )
}
