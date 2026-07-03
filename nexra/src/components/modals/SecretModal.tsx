import { useState } from 'react'
import type { Secret, SecretField } from '../../../electron/services/store.types'
import { theme } from '../../theme'

export interface SecretModalProps {
  companyId: string
  onClose: () => void
  onSave: (secret: Secret) => void
}

export function SecretModal({ companyId, onClose, onSave }: SecretModalProps) {
  const [name, setName] = useState('')
  const [fields] = useState<SecretField[]>([{ envVar: 'AWS_ACCESS_KEY_ID' }, { envVar: 'AWS_SECRET_ACCESS_KEY' }])
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (fields.length === 0) { setError('At least one field is required'); return }
    for (const f of fields) if (!values[f.envVar]) { setError(`Value for ${f.envVar} is required`); return }

    setLoading(true)
    try {
      const secret = await window.nexra.secrets.create({ companyId, name, fields, createdBy: 'operator' })
      await window.nexra.secrets.fill(secret.id, values)
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
        {fields.map(f => (
          <div key={f.envVar} style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: theme.muted }}>{f.envVar}</label>
            <input type="password" value={values[f.envVar] || ''} onChange={e => setValues({ ...values, [f.envVar]: e.target.value })} placeholder="Enter value" style={{ width: '100%', padding: '8px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text }} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={{ padding: '8px 16px', background: theme.border, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={loading} style={{ padding: '8px 16px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{loading ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
