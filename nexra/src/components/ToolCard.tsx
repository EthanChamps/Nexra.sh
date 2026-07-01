import { Hoverable } from './Hoverable'

export interface ToolCardProps {
  running: boolean; success: boolean; unavailable: boolean
  command?: string; output?: string; duration?: string
  toolName?: string; reason?: string; installCmd?: string
  onInstall?: () => void
}

export function ToolCard(props: ToolCardProps) {
  const { running, success, unavailable, command, output, duration, toolName, reason, installCmd, onInstall } = props

  return (
    <div style={{ marginLeft: 38, maxWidth: 720 }}>
      {running && (
        <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, background: '#101216', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px' }}>
          <span style={{ flex: 'none', width: 13, height: 13, border: '2px solid rgba(111,123,240,0.3)', borderTopColor: '#6f7bf0', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: '#c9cdd4', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{command}</span>
          <span style={{ fontSize: 11, color: '#9aa2f5', fontWeight: 500, animation: 'pulse 1.4s ease-in-out infinite' }}>Running</span>
        </div>
      )}

      {success && (
        <div style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, background: '#101216', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ flex: 'none', width: 16, height: 16, borderRadius: 5, background: 'rgba(70,196,127,0.16)', color: '#5bd493', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>✓</span>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: '#c9cdd4', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{command}</span>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#565c65' }}>{duration}</span>
          </div>
          <pre style={{ margin: 0, padding: '11px 13px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, lineHeight: 1.55, color: '#8b929c', whiteSpace: 'pre-wrap', maxHeight: 230, overflow: 'auto', background: '#0c0d10' }}>{output}</pre>
        </div>
      )}

      {unavailable && (
        <div style={{ border: '1px solid rgba(230,162,60,0.36)', borderRadius: 10, background: 'rgba(230,162,60,0.055)', display: 'flex', gap: 11, padding: '12px 13px' }}>
          <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 5, background: 'rgba(230,162,60,0.2)', color: '#e6a23c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>!</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e7c98a', marginBottom: 4 }}>Tool not available — <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{toolName}</span></div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#ab9d7d' }}>{reason}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 11, flexWrap: 'wrap' }}>
              <Hoverable
                as="button"
                type="button"
                onClick={onInstall}
                hoverStyle={{ background: 'rgba(230,162,60,0.26)' }}
                baseStyle={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(230,162,60,0.42)', background: 'rgba(230,162,60,0.16)', color: '#e6a23c', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'background .12s' }}
              >
                ↓ Install
              </Hoverable>
              <Hoverable
                as="button"
                type="button"
                hoverStyle={{ color: '#c9cdd4', borderColor: 'rgba(255,255,255,0.16)' }}
                baseStyle={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9096a0', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', transition: 'all .12s' }}
              >
                Learn more
              </Hoverable>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: '#565c65' }}>{installCmd}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
