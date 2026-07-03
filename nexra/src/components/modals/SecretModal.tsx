import { useState } from 'react'
import type { Secret } from '../../../electron/services/store.types'
import { theme } from '../../theme'

export interface SecretModalProps {
  companyId: string
  onClose: () => void
  onSave: (secret: Secret) => void
}

// Env vars must be `[A-Za-z_][A-Za-z0-9_]*` — derive one from the free-text
// name the operator types (e.g. "aws-prod" -> "AWS_PROD").
function envVarFromName(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SECRET'
}

export function SecretModal({ companyId, onClose, onSave }: SecretModalProps) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (!value) { setError('Secret value is required'); return }

    setLoading(true)
    try {
      const envVar = envVarFromName(name)
      const secret = await window.nexra.secrets.create({ companyId, name, fields: [{ envVar }], createdBy: 'operator' })
      await window.nexra.secrets.fill(secret.id, { [envVar]: value })
      const filled = await window.nexra.secrets.list(companyId).then(ss => ss.find(s => s.id === secret.id)!)
      onSave(filled)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '8px', padding: '20px', maxWidth: '400px', width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Create Secret</div>
        {error && <div style={{ color: '#f0616d', marginBottom: '12px', fontSize: '12px' }}>{error}</div>}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: theme.muted }}>Secret Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., aws-prod" style={{ width: '100%', padding: '8px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text }} />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: theme.muted }}>Secret</label>
          <input type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="Enter value" style={{ width: '100%', padding: '8px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text }} />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={{ padding: '8px 16px', background: theme.border, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={loading} style={{ padding: '8px 16px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{loading ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
