import { useState, useRef } from 'react'
import type { EngagementScope, SecretField, InputRequestItem } from '../../electron/services/store.types'
import { theme } from '../theme'

export interface RequestCardProps {
  message: any
  companyId?: string
  onFulfill: () => void
}

export function RequestCard({ message, companyId, onFulfill }: RequestCardProps) {
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

  if (message.requestKind === 'scope') {
    const [mode, setMode] = useState<'all' | 'allowlist'>('all')
    const [accounts, setAccounts] = useState<string[]>([])
    const [regions, setRegions] = useState<string[]>([])
    const [tenants, setTenants] = useState<string[]>([])
    const [accountInput, setAccountInput] = useState('')
    const [regionInput, setRegionInput] = useState('')
    const [tenantInput, setTenantInput] = useState('')
    const [hosts, setHosts] = useState<string[]>([])
    const [wildcards, setWildcards] = useState<string[]>([])
    const [urlPrefixes, setUrlPrefixes] = useState<string[]>([])
    const [exclusions, setExclusions] = useState<string[]>([])
    const [hostInput, setHostInput] = useState('')
    const [wildcardInput, setWildcardInput] = useState('')
    const [prefixInput, setPrefixInput] = useState('')
    const [exclusionInput, setExclusionInput] = useState('')
    const [scopeSaved, setScopeSaved] = useState(false)
    const [continued, setContinued] = useState(false)
    const continuedRef = useRef(false)
    const isWeb = (message as any).engagementType === 'web'

    // Tag-list input: type a value, Add pins it, × removes it. Reused across every
    // scope dimension (hosts/wildcards/… for web, accounts/regions/… for cloud).
    const tagField = (
      label: string, placeholder: string, list: string[],
      setList: (v: string[]) => void, val: string, setVal: (v: string) => void,
    ) => (
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', fontSize: '12px', color: theme.muted, marginBottom: '4px' }}>{label}</label>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
          <input type="text" value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder} style={{ flex: 1, padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }} />
          <button onClick={() => { if (val) { setList([...list, val]); setVal('') } }} style={{ padding: '6px 8px', background: theme.border, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Add</button>
        </div>
        <div>{list.map(x => <div key={x} style={{ fontSize: '12px', background: theme.bg, padding: '4px', borderRadius: '3px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>{x} <button onClick={() => setList(list.filter(y => y !== x))} style={{ background: 'none', border: 'none', color: '#f0616d', cursor: 'pointer' }}>×</button></div>)}</div>
      </div>
    )

    const handleSetScope = async () => {
      // Fold in any value still sitting in an input box that wasn't "Add"-ed —
      // otherwise a typed-but-unadded host is silently dropped and the scope
      // saves empty, re-triggering the scope request.
      const withPending = (list: string[], pending: string) => {
        const v = pending.trim()
        return v && !list.includes(v) ? [...list, v] : list
      }
      const scope: EngagementScope = isWeb
        ? {
            mode, accounts: [], regions: [], tenants: [],
            hosts: withPending(hosts, hostInput),
            wildcards: withPending(wildcards, wildcardInput),
            urlPrefixes: withPending(urlPrefixes, prefixInput),
            exclusions: withPending(exclusions, exclusionInput),
          }
        : {
            mode,
            accounts: withPending(accounts, accountInput),
            regions: withPending(regions, regionInput),
            tenants: withPending(tenants, tenantInput),
          }
      setLoading(true)
      try {
        const engagementId = (message as any).engagementId
        if (!engagementId) throw new Error('No engagement ID')
        await window.nexra.scope.setAndValidate(engagementId, scope)
        setScopeSaved(true)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    const handleContinue = () => {
      if (continuedRef.current) return
      continuedRef.current = true
      setContinued(true)
      onFulfill()
    }

    return (
      <div style={{ background: theme.card, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Scope Required</div>
        {error && <div style={{ color: '#f0616d', fontSize: '12px', marginBottom: '8px' }}>{error}</div>}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> All (no restrictions)
          </label>
          <label style={{ display: 'block', fontSize: '12px' }}>
            <input type="radio" checked={mode === 'allowlist'} onChange={() => setMode('allowlist')} /> Allowlist
          </label>
        </div>
        {mode === 'allowlist' && (isWeb ? (
          <>
            {tagField('In-scope hosts', 'app.acme.com', hosts, setHosts, hostInput, setHostInput)}
            {tagField('Wildcards', '*.acme.com', wildcards, setWildcards, wildcardInput, setWildcardInput)}
            {tagField('URL prefixes (optional)', 'https://app.acme.com/api', urlPrefixes, setUrlPrefixes, prefixInput, setPrefixInput)}
            {tagField('Exclusions', 'admin.acme.com', exclusions, setExclusions, exclusionInput, setExclusionInput)}
          </>
        ) : (
          <>
            {tagField('AWS Accounts', '111111111111', accounts, setAccounts, accountInput, setAccountInput)}
            {tagField('Regions', 'us-east-1', regions, setRegions, regionInput, setRegionInput)}
            {tagField('Tenant(s)', 'contoso.onmicrosoft.com', tenants, setTenants, tenantInput, setTenantInput)}
          </>
        ))}
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button onClick={handleSetScope} disabled={loading || scopeSaved} style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
            {scopeSaved ? 'Scope set' : loading ? 'Setting...' : 'Set Scope'}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!scopeSaved || continued}
            style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: scopeSaved && !continued ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: scopeSaved && !continued ? 1 : 0.5 }}
          >
            {continued ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </div>
    )
  }

  return null
}
