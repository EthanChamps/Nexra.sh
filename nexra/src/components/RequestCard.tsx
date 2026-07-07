import { useState, useRef } from 'react'
import type { SecretField, InputRequestItem, ScopeItemType } from '../../electron/services/store.types'
import { theme } from '../theme'

export interface RequestCardProps {
  message: any
  companyId?: string
  onFulfill: () => void
  onScopeResolve?: (outcome: 'added' | 'declined') => void
}

export function RequestCard({ message, companyId, onFulfill, onScopeResolve }: RequestCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (message.requestKind === 'inputs') {
    const items = (message.items ?? []) as InputRequestItem[]
    const [values, setValues] = useState<Record<string, string>>({})
    const [sens, setSens] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map(i => [i.key, i.sensitive])))
    const [saved, setSaved] = useState<Record<string, boolean>>({})
    const [continued, setContinued] = useState(false)
    const continuedRef = useRef(false)
    const [err, setErr] = useState('')

    const requiredKeys = items.filter(i => i.required).map(i => i.key)
    const filledCount = requiredKeys.filter(k => saved[k]).length
    const allRequiredFilled = filledCount === requiredKeys.length

    const save = async (key: string) => {
      const value = values[key]
      if (!value) return
      try {
        const res = await window.nexra.inputs.fulfill(companyId!, key, value, sens[key])
        if (res && res.success === false) { setErr(res.error || 'Save failed'); return }
        setSaved(prev => ({ ...prev, [key]: true }))
      } catch (e) { setErr((e as Error).message) }
    }

    // Ref-based guard: a rapid double-click fires both handlers before the
    // first render (which would set `continued`/disable the button) commits,
    // so a plain useState check alone is not reliable here.
    const handleContinue = () => {
      if (continuedRef.current) return
      continuedRef.current = true
      setContinued(true)
      onFulfill()
    }

    return (
      <div style={{ background: theme.card2, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Inputs requested</div>
        {err && <div style={{ color: '#e5566a', fontSize: '12px', marginBottom: '8px' }}>{err}</div>}
        {items.map(it => (
          <div key={it.key} style={{ marginBottom: '10px' }}>
            <label htmlFor={`inp-${it.key}`} style={{ display: 'block', fontSize: '12px', color: theme.muted, marginBottom: '4px' }}>
              {it.label}{it.required ? ' *' : ''}
            </label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                id={`inp-${it.key}`} aria-label={it.label}
                type={sens[it.key] ? 'password' : 'text'}
                value={values[it.key] || ''}
                onChange={e => setValues({ ...values, [it.key]: e.target.value })}
                onBlur={() => save(it.key)}
                placeholder="Enter value"
                style={{ flex: 1, padding: '6px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }}
              />
              <button
                type="button"
                onClick={() => setSens({ ...sens, [it.key]: !sens[it.key] })}
                style={{ padding: '6px 8px', background: theme.border, color: theme.text, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}
              >
                {sens[it.key] ? 'not a secret' : 'mark secret'}
              </button>
              {saved[it.key] && <span style={{ color: theme.accent, fontSize: '12px' }}>saved</span>}
            </div>
          </div>
        ))}
        <div style={{ fontSize: '12px', color: theme.muted, marginTop: '4px', marginBottom: '8px' }}>
          {filledCount} of {requiredKeys.length} required filled
        </div>
        <button
          type="button"
          onClick={handleContinue}
          disabled={!allRequiredFilled || continued}
          style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: allRequiredFilled && !continued ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: allRequiredFilled && !continued ? 1 : 0.5 }}
        >
          {continued ? 'Continuing…' : 'Continue'}
        </button>
      </div>
    )
  }

  if (message.requestKind === 'secret') {
    const { name, fields } = message as any
    const [values, setValues] = useState<Record<string, string>>({})

    const handleFill = async () => {
      if (fields.some((f: SecretField) => !values[f.envVar])) { setError('All fields required'); return }
      setLoading(true)
      try {
        const secretId = (message as any).secretId
        if (!secretId) throw new Error('No secret ID in request')
        await window.nexra.secrets.fulfillPending(secretId, values)
        onFulfill()
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    return (
      <div style={{ background: theme.card, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Secret Requested: {name}</div>
        {error && <div style={{ color: '#f0616d', fontSize: '12px', marginBottom: '8px' }}>{error}</div>}
        {fields.map((f: SecretField) => (
          <div key={f.envVar} style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: theme.muted, marginBottom: '4px' }}>{f.envVar}</label>
            <input type="password" value={values[f.envVar] || ''} onChange={e => setValues({ ...values, [f.envVar]: e.target.value })} placeholder="Enter value" style={{ width: '100%', padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }} />
          </div>
        ))}
        <button onClick={handleFill} disabled={loading} style={{ marginTop: '8px', padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
          {loading ? 'Filling...' : 'Fill Now'}
        </button>
      </div>
    )
  }

  if (message.requestKind === 'scope_proposal') {
    const proposed = (message.proposeItem ?? { type: 'other', value: '' }) as { type: ScopeItemType; value: string }
    const TYPES: ScopeItemType[] = ['cidr', 'ip', 'hostname', 'url', 'cloud_account', 'tenant_id', 'region', 'other']
    const [type, setType] = useState<ScopeItemType>(proposed.type)
    const [value, setValue] = useState(proposed.value)
    const [added, setAdded] = useState(false)
    const resolvedRef = useRef(false)

    const handleAdd = async () => {
      if (!value.trim()) return
      setLoading(true)
      try {
        await window.nexra.projectScope.add(companyId!, { type, value: value.trim(), source: 'agent' })
        setAdded(true)
      } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
    }
    const resolve = (outcome: 'added' | 'declined') => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      onScopeResolve?.(outcome)
    }

    return (
      <div style={{ background: theme.card, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Add to scope?</div>
        {message.reason && <div style={{ fontSize: '12px', color: theme.muted, marginBottom: '8px' }}>{message.reason}</div>}
        {error && <div style={{ color: '#f0616d', fontSize: '12px', marginBottom: '8px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <select aria-label="Proposed scope type" value={type} onChange={e => setType(e.target.value as ScopeItemType)} disabled={added}
            style={{ flex: 'none', padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input aria-label="Proposed scope value" value={value} onChange={e => setValue(e.target.value)} disabled={added}
            style={{ flex: 1, minWidth: 0, padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={handleAdd} disabled={loading || added}
            style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: added ? 'default' : 'pointer', fontSize: '12px' }}>
            {added ? 'Added' : loading ? 'Adding…' : 'Add to scope'}
          </button>
          <button type="button" onClick={() => resolve('added')} disabled={!added}
            style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: added ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: added ? 1 : 0.5 }}>
            Continue
          </button>
          <button type="button" onClick={() => resolve('declined')} disabled={added}
            style={{ padding: '6px 12px', background: 'transparent', color: theme.muted, border: `1px solid ${theme.border}`, borderRadius: '4px', cursor: added ? 'not-allowed' : 'pointer', fontSize: '12px' }}>
            Decline
          </button>
        </div>
      </div>
    )
  }

  return null
}
