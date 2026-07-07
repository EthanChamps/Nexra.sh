const DOT_DELAYS = [0, 0.15, 0.3]

export function TypingIndicator({ label }: { label?: string } = {}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span
        style={{
          flex: 'none', width: 26, height: 26, borderRadius: 7, background: 'rgba(111,123,240,0.16)',
          color: '#9aa2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
        }}
      >
        ◆
      </span>
      {label && <span style={{ fontSize: 13, color: '#9096a0' }}>{label}</span>}
      <div style={{ display: 'flex', gap: 4 }} role="status" aria-label="Assistant is responding">
        {DOT_DELAYS.map(delay => (
          <span
            key={delay}
            style={{
              width: 6, height: 6, borderRadius: '50%', background: '#9aa2f5',
              animation: `pulse 1.4s ease-in-out ${delay}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
