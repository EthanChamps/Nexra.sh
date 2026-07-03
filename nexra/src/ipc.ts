import type { Dispatch } from 'react'
import type { Snapshot, Chat, Engagement, Message } from '../electron/services/store.types'
import type { AgentEvent } from '../electron/services/agent.types'
import { deriveTitle, type Action } from './state/reducer'
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
      case 'text_delta':
        dispatch({ t: 'appendTextDelta', chatId, delta: e.delta })
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
        dispatch({ t: 'upsertFinding', chatId, finding: { id: e.id, title: e.title, sev: e.sev, phase: e.phase, time: e.time, rationale: e.rationale, evidence: e.evidence, verified: e.verified } })
        break
      case 'input_request':
        dispatch({ t: 'appendInputRequest', chatId, requestId: e.requestId, items: e.items })
        break
      case 'scope_request':
        dispatch({ t: 'appendScopeRequest', chatId, engagementId: e.engagementId })
        break
      case 'skill':
        dispatch({ t: 'appendSkillEvent', chatId, skillEvent: e })
        break
      case 'error':
        dispatch({ t: 'appendError', chatId, message: e.message })
        dispatch({ t: 'setStreaming', chatId, on: false })
        break
      case 'done':
        dispatch({ t: 'setStreaming', chatId, on: false })
        break
    }
  }
}

export function sendMessage(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, text: string, companyId?: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const history = chat.messages
    .filter(m => m.kind === 'text' && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content as string }))
  const isFirstUserMessage = !chat.messages.some(m => m.role === 'user')
  const isProvisional = chat.name === 'New chat'
  dispatch({ t: 'appendUserMessage', chatId: chat.id, text: trimmed })
  dispatch({ t: 'setStreaming', chatId: chat.id, on: true })
  const primaryTool = chat.tools.find(t => t.available)?.name ?? 'shell'
  const runningIds = new Map<string, string>()
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), primaryTool, text: trimmed, history, companyId, engagementId: eng.id },
    applyEvent(dispatch, chat.id, runningIds),
  ).catch((err: unknown) => {
    // Only fires when the IPC invoke promise genuinely rejects with no terminal
    // error/done event delivered (e.g. an upstream main-process throw). On the
    // normal path runSend emits error/done and the promise resolves, so this
    // does not double-report. Without it a reject would leave the chat stuck
    // streaming forever with a locked composer and no user recovery.
    dispatch({ t: 'appendError', chatId: chat.id, message: err instanceof Error ? err.message : 'Request failed to start' })
    dispatch({ t: 'setStreaming', chatId: chat.id, on: false })
  })
  // Fire-and-forget: runs concurrently with the reply above, never blocks or
  // delays it. Falls back to the deterministic heuristic on any failure (no
  // key, network error, provider error) so the chat is never stuck untitled.
  if (isFirstUserMessage && isProvisional) {
    window.nexra.agent.title({ engagementType: eng.type, text: trimmed })
      .then(title => dispatch({ t: 'setChatTitle', chatId: chat.id, title }))
      .catch(() => dispatch({ t: 'setChatTitle', chatId: chat.id, title: deriveTitle(trimmed) }))
  }
}

// Resume the agent after the operator has filled a requested-input card. Unlike
// sendMessage this appends NO visible user bubble — it feeds the model a synthetic
// "continue" turn and streams the reply. The request card message is kind:'request',
// so it is naturally excluded from the text-only history below.
export function resumeAfterInputs(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, companyId?: string): void {
  const history = chat.messages
    .filter(m => m.kind === 'text' && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content as string }))
  dispatch({ t: 'setStreaming', chatId: chat.id, on: true })
  const primaryTool = chat.tools.find(t => t.available)?.name ?? 'shell'
  const runningIds = new Map<string, string>()
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), primaryTool, text: 'The requested inputs have been provided. Continue.', history, companyId, engagementId: eng.id },
    applyEvent(dispatch, chat.id, runningIds),
  ).catch((err: unknown) => {
    dispatch({ t: 'appendError', chatId: chat.id, message: err instanceof Error ? err.message : 'Resume failed' })
    dispatch({ t: 'setStreaming', chatId: chat.id, on: false })
  })
}

// Clears busy state immediately instead of waiting on the abort/done IPC
// round trip — Stop must free up the composer on click, not once the
// in-flight request has finished unwinding on the main-process side.
export function cancelStream(dispatch: Dispatch<Action>, chatId: string): void {
  window.nexra.agent.cancel(chatId)
  dispatch({ t: 'setStreaming', chatId, on: false })
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
