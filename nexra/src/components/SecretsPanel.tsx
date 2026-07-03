import { useState, useEffect } from 'react'
import type { Secret } from '../../electron/services/store.types'
import { theme } from '../theme'
import { Hoverable } from './Hoverable'

export interface SecretsPanelProps {
  companyId: string
  onCreateClick: () => void
}

export function SecretsPanel({ companyId, onCreateClick }: SecretsPanelProps) {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.nexra.secrets.list(companyId).then(setSecrets).finally(() => setLoading(false))
  }, [companyId])

  const handleDelete = async (id: string) => {
    await window.nexra.secrets.delete(id)
    setSecrets(secrets.filter(s => s.id !== id))
  }

  if (loading) return <div style={{ padding: '12px', color: theme.text3 }}>Loading secrets...</div>
  if (secrets.length === 0) return (
    <div style={{ padding: '12px', color: theme.text3, textAlign: 'center' }}>
      <div>No secrets yet</div>
      <button onClick={onCreateClick} style={{ marginTop: '8px', padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
        Create Secret
      </button>
    </div>
  )

  return (
    <div style={{ padding: '12px' }}>
      {secrets.map(s => (
        <div key={s.id} style={{ marginBottom: '8px', padding: '8px', background: theme.bg2, borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 500 }}>{s.name}</div>
            <div style={{ fontSize: '12px', color: theme.text3 }}>
              {s.status === 'filled' ? '✓ Filled' : '○ Pending'} · {s.fields.length} field{s.fields.length !== 1 ? 's' : ''}
            </div>
          </div>
          <Hoverable
            as="button"
            type="button"
            onClick={() => handleDelete(s.id)}
            baseStyle={{ padding: '4px 8px', background: '#f0616d', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', transition: 'background .12s' }}
            hoverStyle={{ background: 'rgba(240,97,109,0.85)' }}
          >
            Delete
          </Hoverable>
        </div>
      ))}
      <button onClick={onCreateClick} style={{ width: '100%', marginTop: '8px', padding: '6px', background: theme.border, color: theme.text1, border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
        + New Secret
      </button>
    </div>
  )
}
