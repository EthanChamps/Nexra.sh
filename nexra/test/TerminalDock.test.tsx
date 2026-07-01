import { describe, it, expect, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { runShell, shellTabs, shellColor, shellPromptStored, inlinePrompt } from '../electron/services/shell.mock'
import { TerminalDock } from '../src/components/TerminalDock'

beforeEach(() => {
  ;(window as any).nexra = {
    shell: {
      tabs: async () => shellTabs(),
      run: async (s: any, r: any) => runShell(s, r),
      prompt: async (s: any) => ({ stored: shellPromptStored(s), inline: inlinePrompt(s), color: shellColor(s) }),
    },
  }
})

// TerminalDock reads/writes its command buffer through state.ui.terminalInput and the
// setTerminalInput dispatch action rather than local state, so the harness needs a tiny
// reducer-backed wrapper to make typing actually round-trip into the rendered input.
function Harness() {
  const [ui, setUi] = useState<any>({ terminalOpen: true, terminalShell: 'pwsh', terminalHeight: 346, terminalInput: '' })
  const dispatch = (action: any) => {
    setUi((prev: any) => {
      switch (action.t) {
        case 'setTerminalInput': return { ...prev, terminalInput: action.value }
        case 'setTerminalShell': return { ...prev, terminalShell: action.id }
        case 'setTerminalHeight': return { ...prev, terminalHeight: action.h }
        case 'closeTerminal': return { ...prev, terminalOpen: false }
        default: return prev
      }
    })
  }
  return <TerminalDock state={{ ui } as any} dispatch={dispatch} />
}

describe('TerminalDock', () => {
  it('runs a command through the real shell mock, then clears the buffer on `cls`', async () => {
    render(<Harness />)
    const input = await screen.findByPlaceholderText(/type a command/i)

    fireEvent.change(input, { target: { value: 'whoami' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // the literal whoami output, not just the inline prompt (which also contains
    // "pentester" as part of "PS C:\Users\pentester>")
    await screen.findByText('desktop-pt01\\pentester')
    expect(screen.getByText('whoami')).toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe('')

    fireEvent.change(input, { target: { value: 'cls' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.queryByText('desktop-pt01\\pentester')).not.toBeInTheDocument()
      expect(screen.queryByText('whoami')).not.toBeInTheDocument()
    })
  })
})
