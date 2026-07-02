import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu } from '../src/components/ContextMenu'
import { reducer, initialUI } from '../src/state/reducer'
import { buildSnapshot } from '../electron/services/store.mock'
import { useReducer } from 'react'

// Engagement/chat ids are generated at seed time (an incrementing counter in
// electron/services/seed.ts), not fixed literals — pull real ids out of a
// fresh snapshot rather than hardcoding them, so `chatByIds` resolves a chat.
function Harness() {
  const data = buildSnapshot()
  const eng = data.companies[0].engagements[0]
  const chat = eng.chats[0]
  const boot = { data, ui: { ...initialUI, ctxMenu: { open: true, x: 40, y: 40, engId: eng.id, chatId: chat.id } } }
  const [state, dispatch] = useReducer(reducer, boot)
  // Mirror production gating (src/screens/Workspace.tsx): ContextMenu itself
  // does not check `open`, the caller conditionally mounts/unmounts it.
  return state.ui.ctxMenu.open ? <ContextMenu state={state as any} dispatch={dispatch} /> : null
}

describe('ContextMenu', () => {
  it('renders Rename chat and Delete chat items', () => {
    render(<Harness />)
    expect(screen.getByText('Rename chat')).toBeInTheDocument()
    expect(screen.getByText('Delete chat')).toBeInTheDocument()
  })
  it('closes when the backdrop is clicked', () => {
    render(<Harness />)
    fireEvent.click(document.querySelectorAll('div[style*="inset: 0"]')[0]!)
    expect(screen.queryByText('Rename chat')).not.toBeInTheDocument()
  })
})
