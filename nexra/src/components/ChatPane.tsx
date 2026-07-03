import type { Dispatch, KeyboardEvent } from 'react'
import { Hoverable } from './Hoverable'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { theme } from '../theme'
import type { AppState } from '../state/selectors'
import { activeCompany, activeEngagement, activeChat, phaseLabel } from '../state/selectors'
import type { Action } from '../state/reducer'
import type { Message } from '../../electron/services/store.types'
import { sendMessage, installTool, cancelStream } from '../ipc'

export function ChatPane({
  state,
  dispatch,
}: {
  state: AppState
  dispatch: Dispatch<Action>
}) {
  const company = activeCompany(state)
  const eng = activeEngagement(state)
  const chat = activeChat(state)
  if (!eng || !chat) return null

  const onSend = () => {
    sendMessage(dispatch, chat, eng, state.ui.draft, company?.id)
    dispatch({ t: 'setDraft', value: '' })
  }
  const onInstall = (msg: Message) => installTool(dispatch, chat, msg)

  const companyName = company ? company.name : ''
  const activeName = eng.name
  const activeTypeLabel = state.data.types[eng.type].label
  const chatFocusLabel = phaseLabel(eng, chat.phaseId)
  const composerPlaceholder = chatFocusLabel ? 'Message the ' + chatFocusLabel + ' agent…' : 'Message the agent…'

  const { editingName, nameDraft, rightOpen } = state.ui

  const onNameDraft = (e: React.ChangeEvent<HTMLInputElement>) => dispatch({ t: 'setNameDraft', value: e.target.value })
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); dispatch({ t: 'saveName' }) }
    if (e.key === 'Escape') dispatch({ t: 'cancelRename' })
  }
  const saveName = () => dispatch({ t: 'saveName' })
  const startRename = () => dispatch({ t: 'startRename' })
  const toggleRight = () => dispatch({ t: 'toggleRight' })

  return (
    <>
      <header style={{ flex: 'none', borderBottom: `1px solid ${theme.border}`, background: theme.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {editingName && (
              <input
                value={nameDraft}
                onChange={onNameDraft}
                onKeyDown={onNameKey}
                onBlur={saveName}
                autoFocus
                style={{ width: '100%', maxWidth: 420, background: theme.input, border: '1px solid rgba(111,123,240,0.5)', borderRadius: 7, padding: '5px 9px', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: theme.text, outline: 'none' }}
              />
            )}
            {!editingName && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.name}</span>
                <Hoverable
                  as="button"
                  type="button"
                  onClick={startRename}
                  title="Rename chat"
                  hoverStyle={{ color: '#c9cdd4', background: 'rgba(255,255,255,0.05)' }}
                  baseStyle={{ flex: 'none', width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: theme.dim2, cursor: 'pointer', fontSize: 11, transition: 'all .12s' }}
                >
                  ✎
                </Hoverable>
                {chatFocusLabel && <span style={{ flex: 'none', fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', color: theme.accentSoft, background: 'rgba(111,123,240,0.14)', border: '1px solid rgba(111,123,240,0.24)', padding: '2px 9px', borderRadius: 20 }}>{chatFocusLabel}</span>}
              </div>
            )}
            <span style={{ fontFamily: theme.mono, fontSize: 11, color: theme.dim2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{companyName} · {activeName} · {activeTypeLabel}</span>
          </div>

          {rightOpen && (
            <Hoverable
              as="button"
              type="button"
              onClick={toggleRight}
              title="Hide context panel"
              hoverStyle={{ color: '#c9cdd4', borderColor: 'rgba(255,255,255,0.16)' }}
              baseStyle={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.09)', background: 'transparent', color: theme.muted2, fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', transition: 'all .12s' }}
            >
              Context <span style={{ fontSize: 14, lineHeight: 0 }}>›</span>
            </Hoverable>
          )}
        </div>
      </header>

      <MessageList chat={chat} streaming={!!state.ui.streamingChats[chat.id]} onInstall={onInstall} />

      <Composer
        draft={state.ui.draft}
        placeholder={composerPlaceholder}
        dispatch={dispatch}
        onSend={onSend}
        busy={!!state.ui.streamingChats[chat.id]}
        onStop={() => cancelStream(dispatch, chat.id)}
      />
    </>
  )
}
