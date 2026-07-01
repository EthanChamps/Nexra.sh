import type { Dispatch } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { AppState } from '../state/selectors'
import type { Action } from '../state/reducer'
import type { ShellId, ShellLine, ShellTab } from '../../electron/services/shell.types'
import { buildTerminalSessions } from '../../electron/services/seed'
import { theme } from '../theme'

type Sessions = Record<ShellId, ShellLine[]>
type PromptInfo = { stored: string; inline: string; color: string }

export function TerminalDock({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const shell = state.ui.terminalShell
  const [sessions, setSessions] = useState<Sessions>(() => buildTerminalSessions() as Sessions)
  const [tabs, setTabs] = useState<ShellTab[]>([])
  const [promptInfo, setPromptInfo] = useState<PromptInfo | null>(null)

  const termRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const resizing = useRef(false)
  const startY = useRef(0)
  const startH = useRef(state.ui.terminalHeight)

  useEffect(() => { window.redcell.shell.tabs().then(setTabs) }, [])

  useEffect(() => {
    window.redcell.shell.prompt(shell).then(setPromptInfo)
    requestAnimationFrame(() => { if (inputRef.current) inputRef.current.focus() })
  }, [shell])

  useEffect(() => {
    const el = termRef.current
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [sessions, shell])

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
  const focusTerm = () => requestAnimationFrame(() => { if (inputRef.current) inputRef.current.focus() })

  const onTerminalInput = (e: React.ChangeEvent<HTMLInputElement>) => dispatch({ t: 'setTerminalInput', value: e.target.value })

  const runTerminal = async () => {
    const raw = (state.ui.terminalInput || '').trim()
    const p = promptInfo || (await window.redcell.shell.prompt(shell))
    const cmdLine: ShellLine = { kind: 'cmd', prompt: p.stored, promptColor: p.color, text: raw }
    const res = await window.redcell.shell.run(shell, raw)
    if (res.clear) {
      setSessions(s => ({ ...s, [shell]: [] }))
    } else {
      setSessions(s => ({ ...s, [shell]: [...(s[shell] || []), cmdLine, ...res.lines] }))
    }
    dispatch({ t: 'setTerminalInput', value: '' })
  }

  const onTerminalKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); runTerminal() }
  }

  const termLines = sessions[shell] || []
  const termPromptColor = promptInfo?.color || '#5bd493'
  const termInlinePrompt = promptInfo?.inline || ''
  const termKaliHeader = shell === 'kali'

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

      <div ref={termRef} onClick={focusTerm} style={{ flex: 1, overflowY: 'auto', padding: '12px 15px 16px', background: theme.term, cursor: 'text' }}>
        {termLines.map((ln, i) => (
          <div key={shell + '-' + i} style={{ marginBottom: 2 }}>
            {ln.kind === 'cmd' && (
              <div style={{ display: 'flex', gap: 9, fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.55 }}>
                <span style={{ color: ln.promptColor || '#5bd493', whiteSpace: 'pre' }}>{ln.prompt || ''}</span>
                <span style={{ flex: 1, minWidth: 0, color: theme.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ln.text}</span>
              </div>
            )}
            {ln.kind === 'out' && (
              <pre style={{ margin: 0, fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.55, color: '#a4abb4', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ln.text}</pre>
            )}
            {ln.kind === 'sys' && (
              <div style={{ fontFamily: theme.mono, fontSize: 11.5, lineHeight: 1.5, color: theme.dim2, whiteSpace: 'pre-wrap' }}>{ln.text}</div>
            )}
          </div>
        ))}

        <div style={{ marginTop: 5 }}>
          {termKaliHeader && (
            <div style={{ fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.55, color: theme.ok2 }}>{'┌──(kali㉿kali)-[~]'}</div>
          )}
          <div style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
            <span style={{ fontFamily: theme.mono, fontSize: 12.5, color: termPromptColor, whiteSpace: 'pre' }}>{termInlinePrompt}</span>
            <input
              ref={inputRef}
              value={state.ui.terminalInput}
              onChange={onTerminalInput}
              onKeyDown={onTerminalKey}
              autoFocus
              spellCheck={false}
              placeholder="type a command — try `help`"
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: theme.text, fontFamily: theme.mono, fontSize: 12.5, padding: 0 }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
