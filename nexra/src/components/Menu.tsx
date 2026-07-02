import type { ReactNode } from 'react'
import { Hoverable } from './Hoverable'
import { theme } from '../theme'

export function MenuShell({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div
        onClick={onClose}
        onContextMenu={e => { e.preventDefault(); onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }}
      />
      <div
        style={{
          position: 'fixed', top: y, left: x, zIndex: 61, width: 198, background: theme.input,
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 11, padding: 6,
          boxShadow: '0 18px 46px rgba(0,0,0,0.6)',
        }}
      >
        {children}
      </div>
    </>
  )
}

export function MenuDivider() {
  return <div style={{ height: 1, background: theme.border, margin: '5px 6px' }} />
}

export function MenuItem({ icon, label, onClick, destructive }: { icon: string; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <Hoverable
      as="button"
      type="button"
      onClick={onClick}
      baseStyle={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
        borderRadius: 7, border: 'none', background: 'transparent',
        color: destructive ? '#f0616d' : '#dfe2e6', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', transition: 'background .1s',
      }}
      hoverStyle={{ background: destructive ? 'rgba(240,97,109,0.12)' : 'rgba(255,255,255,0.06)' }}
    >
      <span style={{ flex: 'none', width: 14, textAlign: 'center', color: destructive ? undefined : theme.muted2 }}>{icon}</span> {label}
    </Hoverable>
  )
}
