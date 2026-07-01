import type { Dispatch } from 'react'
import { Fragment } from 'react'
import { Sidebar } from '../components/Sidebar'
import { Hoverable } from '../components/Hoverable'
import { ChatPane } from '../components/ChatPane'
import { ContextPanel } from '../components/ContextPanel'
import { ContextMenu } from '../components/ContextMenu'
import { NewEngagementModal } from '../components/modals/NewEngagementModal'
import { TerminalDock } from '../components/TerminalDock'
import type { AppState } from '../state/selectors'
import { activeCompany, activeEngagement, activeChat } from '../state/selectors'
import type { Action } from '../state/reducer'

export function Workspace({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const company = activeCompany(state)
  const eng = activeEngagement(state)
  const chat = activeChat(state)

  const companyName = company ? company.name : ''
  const noEngagement = !eng
  const engNoChats = !!eng && !chat
  const hasChat = !!eng && !!chat
  const activeName = eng ? eng.name : ''

  const openNew = () => dispatch({ t: 'openNew' })
  const startNewChat = () => dispatch({ t: 'createChat' })

  return (
    <Fragment>
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar state={state} dispatch={dispatch} />

      <main data-screen-label="Chat" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#0a0b0d' }}>
        {noEngagement && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 13, background: '#101216', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#565c65' }}>◆</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#e7e9ec' }}>No engagements in {companyName} yet</div>
              <div style={{ marginTop: 6, fontSize: 13, color: '#8b929c', maxWidth: 340 }}>Create an engagement, then spin up focused chats inside it.</div>
            </div>
            <Hoverable
              as="button"
              type="button"
              onClick={openNew}
              hoverStyle={{ background: '#5866f0' }}
              baseStyle={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: 10, border: 'none', background: '#6f7bf0', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'background .12s' }}
            >
              <span style={{ fontSize: 16, lineHeight: 0, marginTop: -1 }}>+</span> New Engagement
            </Hoverable>
          </div>
        )}

        {engNoChats && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 13, background: '#101216', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#565c65' }}>✦</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#e7e9ec' }}>No chats in {activeName} yet</div>
              <div style={{ marginTop: 6, fontSize: 13, color: '#8b929c', maxWidth: 380 }}>Spin up a focused chat — recon, a single host, or one config area. Each chat keeps its own context so the window never fills up.</div>
            </div>
            <Hoverable
              as="button"
              type="button"
              onClick={startNewChat}
              hoverStyle={{ background: '#5866f0' }}
              baseStyle={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: 10, border: 'none', background: '#6f7bf0', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'background .12s' }}
            >
              <span style={{ fontSize: 16, lineHeight: 0, marginTop: -1 }}>+</span> New chat
            </Hoverable>
          </div>
        )}

        {hasChat && <ChatPane state={state} dispatch={dispatch} />}
      </main>

      <ContextPanel state={state} dispatch={dispatch} />

      {state.ui.newOpen && <NewEngagementModal state={state} dispatch={dispatch} />}
      {state.ui.ctxMenu.open && <ContextMenu state={state} dispatch={dispatch} />}
    </div>

    {state.ui.terminalOpen && <TerminalDock state={state} dispatch={dispatch} />}
    </Fragment>
  )
}
