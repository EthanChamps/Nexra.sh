import type { Dispatch } from 'react'
import type { Snapshot, Chat, Engagement, Message } from '../electron/services/store.types'
import type { AgentEvent } from '../electron/services/agent.types'
import type { Action } from './state/reducer'
import { phaseLabel } from './state/selectors'

export const getSnapshot = (): Promise<Snapshot> => window.nexra.store.snapshot()

let _cid = 0
const nextCardId = () => 'tc' + Date.now() + '-' + (++_cid)

// Applies a stream of AgentEvents to the reducer for a given chat. Tracks the stable
// client id of the last "running" tool card per tool name (assigned here, not in the
// reducer) so the follow-up success/unavailable event can replace that same card in place.
function applyEvent(dispatch: Dispatch<Action>, chatId: string, runningIds: Map<string, string>) {
  return (e: AgentEvent) => {
    switch (e.type) {
      case 'text':
        dispatch({ t: 'appendText', chatId, text: e.text })
        break
      case 'tool_call': {
        if (e.state === 'running') {
          // Reuse a pre-seeded id (e.g. installTool seeds the clicked card's own
          // id) so the card is transformed in place instead of duplicated; when
          // there is no seed (e.g. sendMessage's fresh, empty map) mint a new one.
          const id = runningIds.get(e.toolName) || nextCardId()
          runningIds.set(e.toolName, id)
          dispatch({
            t: 'upsertToolCard', chatId,
            card: { id, role: 'assistant', kind: 'tool', toolName: e.toolName, command: e.command, state: 'running' },
          })
        } else {
          const id = runningIds.get(e.toolName) || nextCardId()
          dispatch({
            t: 'upsertToolCard', chatId,
            card: { id, role: 'assistant', kind: 'tool', toolName: e.toolName, command: e.command, output: e.output, duration: e.duration, reason: e.reason, installCmd: e.installCmd, state: e.state },
          })
        }
        break
      }
      case 'finding':
        dispatch({ t: 'appendFinding', chatId, finding: { title: e.title, sev: e.sev, phase: e.phase, time: e.time } })
        break
      case 'done':
        break
    }
  }
}

export function sendMessage(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  dispatch({ t: 'appendUserMessage', chatId: chat.id, text: trimmed })
  const primaryTool = chat.tools.find(t => t.available)?.name ?? 'shell'
  const runningIds = new Map<string, string>()
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), primaryTool, text: trimmed },
    applyEvent(dispatch, chat.id, runningIds),
  )
}

export function installTool(dispatch: Dispatch<Action>, chat: Chat, msg: Message): void {
  if (!msg.toolName) return
  // Seed with the clicked card's own id so the install stream's running/success
  // events replace THIS card in place instead of minting a new one alongside it.
  const runningIds = new Map<string, string>([[msg.toolName, msg.id]])
  window.nexra.agent.install(
    { chatId: chat.id, toolName: msg.toolName, installCmd: msg.installCmd },
    e => {
      applyEvent(dispatch, chat.id, runningIds)(e)
      if (e.type === 'tool_call' && e.state === 'success') dispatch({ t: 'markToolAvailable', chatId: chat.id, toolName: e.toolName })
    },
  )
}
