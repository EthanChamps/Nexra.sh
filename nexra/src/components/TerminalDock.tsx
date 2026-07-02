import type { Dispatch } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AppState } from '../state/selectors'
import type { Action } from '../state/reducer'
import type { ShellId, ShellTab } from '../../electron/services/shell.types'
import { theme } from '../theme'

export function TerminalDock({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const shell = state.ui.terminalShell
  const [tabs, setTabs] = useState<ShellTab[]>([])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const writeRef = useRef<(data: string) => void>(() => {})
  const sessionIdRef = useRef<ShellId | null>(null)

  const resizing = useRef(false)
  const startY = useRef(0)
  const startH = useRef(state.ui.terminalHeight)

  useEffect(() => {
    window.nexra.shell.tabs().then(ts => {
      setTabs(ts)
      if (ts.length && !ts.some(t => t.id === shell)) dispatch({ t: 'setTerminalShell', id: ts[0].id })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mounts once: TerminalDock only exists in the DOM while the dock is open
  // (see Workspace.tsx's `{ui.terminalOpen && <TerminalDock .../>}`), so this
  // effect's lifetime is exactly "dock is open".
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const term = new Terminal({
      fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.4, cursorBlink: true,
      theme: { background: theme.term, foreground: theme.text, cursor: theme.ok2, selectionBackground: 'rgba(111,123,240,0.35)' },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)
    fitAddon.fit()
    term.onData(data => writeRef.current(data))
    termRef.current = term
    fitAddonRef.current = fitAddon
    return () => {
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  // Attach/detach xterm to the session for the active tab. Sessions live in the
  // main process and outlive this component (docs/superpowers/specs/2026-07-01-redcell-m0-m2-design.md,
  // "Buffer persistence") — this only re-points the local view at whichever
  // session is active, replaying its scrollback and subscribing to live output.
  useEffect(() => {
    const term = termRef.current
    const fitAddon = fitAddonRef.current
    if (!term || !fitAddon) return
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    fitAddon.fit()
    // Small accepted race: there's a brief window between the main process
    // snapshotting `scrollback` here and `onData` actually registering below,
    // during which live output could be pushed to the session's buffer but
    // arrive at a not-yet-subscribed listener. Nothing is lost from the
    // session's buffer (a later reattach will show it) — it's only possibly
    // missing from this view for a moment. Not fixed structurally; would need
    // a larger atomic-handoff redesign not justified at this milestone's scope.
    window.nexra.shell.create(shell, term.cols, term.rows).then(({ sessionId, scrollback }) => {
      if (cancelled) return
      sessionIdRef.current = sessionId
      writeRef.current = data => window.nexra.shell.write(sessionId, data)
      term.reset()
      term.write(scrollback)
      unsubscribe = window.nexra.shell.onData(sessionId, data => term.write(data))
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [shell])

  // Refit + propagate size on dock resize (drag handle) ...
  useEffect(() => {
    const term = termRef.current
    const fitAddon = fitAddonRef.current
    const sessionId = sessionIdRef.current
    if (!term || !fitAddon || !sessionId) return
    fitAddon.fit()
    window.nexra.shell.resize(sessionId, term.cols, term.rows)
  }, [state.ui.terminalHeight])

  // ...and on window resize.
  useEffect(() => {
    const onResize = () => {
      const term = termRef.current
      const fitAddon = fitAddonRef.current
      const sessionId = sessionIdRef.current
      if (!term || !fitAddon || !sessionId) return
      fitAddon.fit()
      window.nexra.shell.resize(sessionId, term.cols, term.rows)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const dy = startY.current - e.clientY
      let h = startH.current + dy
      const max = Math.max(200, window.innerHeight - 120)
      h = Math.max(160, Math.min(max, h))
      dispatch({ t: 'setTerminalHeight', h })
    }
    const onUp = () => { if (resizing.current) { resizing.current = false; document.body.style.userSelect = '' } }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dispatch])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    startY.current = e.clientY
    startH.current = state.ui.terminalHeight
    document.body.style.userSelect = 'none'
  }

  const closeTerminal = () => dispatch({ t: 'closeTerminal' })
  const setTerminalShell = (id: ShellId) => dispatch({ t: 'setTerminalShell', id })
  const focusTerm = () => termRef.current?.focus()

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: state.ui.terminalHeight + 'px', zIndex: 70, display: 'flex', flexDirection: 'column', background: theme.term, borderTop: '1px solid rgba(255,255,255,0.13)', boxShadow: '0 -20px 60px rgba(0,0,0,0.6)' }}>

      <div onMouseDown={startResize} style={{ flex: 'none', height: 8, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.panel, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ width: 40, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
      </div>

      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: theme.panel, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontFamily: theme.mono, fontSize: 12, color: theme.ok2, letterSpacing: '-1px', marginRight: 5 }}>{'›_'}</span>
        {tabs.map(t => {
          const active = t.id === shell
          return (
            <button
              key={t.id}
              onClick={() => setTerminalShell(t.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 8, border: '1px solid transparent', background: active ? theme.term : 'transparent', color: active ? theme.text : theme.muted, fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color }} />
              {t.label}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: theme.muted2, padding: '3px 10px', borderRadius: 20, background: 'rgba(111,123,240,0.1)', border: '1px solid rgba(111,123,240,0.22)' }}>
          <span style={{ color: theme.accentSoft, fontSize: 9 }}>{'◆'}</span> Shared with agent
        </span>
        <button
          onClick={closeTerminal}
          title="Close terminal"
          onMouseEnter={e => { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#7d838c'; e.currentTarget.style.background = 'transparent' }}
          style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', color: '#7d838c', fontSize: 13, cursor: 'pointer', transition: 'all .12s' }}
        >
          {'✕'}
        </button>
      </div>

      <div ref={containerRef} onClick={focusTerm} style={{ flex: 1, minHeight: 0, padding: '12px 15px 16px', background: theme.term, cursor: 'text' }} />
    </div>
  )
}
