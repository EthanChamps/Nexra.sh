import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TerminalDock } from '../src/components/TerminalDock'

const fakeTerm = {
  cols: 80, rows: 24,
  loadAddon: vi.fn(),
  open: vi.fn(),
  onData: vi.fn(),
  write: vi.fn((_data: string, cb?: () => void) => cb?.()),
  reset: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
}

vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn(() => fakeTerm) }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn(() => ({ fit: vi.fn() })) }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

function Harness() {
  const [ui, setUi] = useState<any>({ terminalOpen: true, terminalShell: 'pwsh', terminalHeight: 346 })
  const dispatch = (action: any) => {
    setUi((prev: any) => {
      switch (action.t) {
        case 'setTerminalShell': return { ...prev, terminalShell: action.id }
        case 'setTerminalHeight': return { ...prev, terminalHeight: action.h }
        case 'closeTerminal': return { ...prev, terminalOpen: false }
        default: return prev
      }
    })
  }
  return <TerminalDock state={{ ui } as any} dispatch={dispatch} />
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).nexra = {
    shell: {
      tabs: vi.fn(async () => [
        { id: 'pwsh', label: 'PowerShell', color: '#9aa2f5' },
        { id: 'cmd', label: 'Command Prompt', color: '#c9cdd4' },
      ]),
      create: vi.fn(async (s: string) => ({ sessionId: s, scrollback: 'PS C:\\Users\\pentester> ' })),
      write: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      onData: vi.fn(() => () => {}),
    },
  }
})

describe('TerminalDock', () => {
  it('creates a session for the active tab and replays its scrollback into xterm', async () => {
    render(<Harness />)
    await screen.findByText('PowerShell')
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalledWith('pwsh', 80, 24))
    await waitFor(() => expect(fakeTerm.write).toHaveBeenCalledWith('PS C:\\Users\\pentester> ', expect.any(Function)))
    expect((window as any).nexra.shell.onData).toHaveBeenCalledWith('pwsh', expect.any(Function))
  })

  it('does not forward cursor-position-report auto-responses fired mid-replay into the live session', async () => {
    // Simulates xterm.js's real behavior: parsing a stored `ESC[6n` query from
    // scrollback triggers its own onData handler synchronously, before the
    // write() callback signals the replay is flushed.
    fakeTerm.write.mockImplementation((_data: string, cb?: () => void) => {
      const onDataHandler = fakeTerm.onData.mock.calls[0][0]
      onDataHandler('\x1b[24;1R')
      cb?.()
    })
    render(<Harness />)
    await waitFor(() => expect(fakeTerm.write).toHaveBeenCalled())
    expect((window as any).nexra.shell.write).not.toHaveBeenCalled()
  })

  it('forwards keystrokes from xterm straight to the pty session', async () => {
    render(<Harness />)
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalled())
    const onDataHandler = fakeTerm.onData.mock.calls[0][0]
    onDataHandler('ls\r')
    await waitFor(() => expect((window as any).nexra.shell.write).toHaveBeenCalledWith('pwsh', 'ls\r'))
  })

  it('switches tabs on click, attaching xterm to the newly selected shell', async () => {
    render(<Harness />)
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalledWith('pwsh', 80, 24))
    fireEvent.click(screen.getByText('Command Prompt'))
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalledWith('cmd', 80, 24))
  })
})
