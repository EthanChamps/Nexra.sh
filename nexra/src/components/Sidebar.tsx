import type { Dispatch, MouseEvent } from 'react'
import { Hoverable } from './Hoverable'
import type { AppState } from '../state/selectors'
import { activeCompany, phaseLabel, statusColor, colorDot } from '../state/selectors'
import type { Action } from '../state/reducer'

export function Sidebar({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const company = activeCompany(state)

  const engagements = company
    ? company.engagements.map(e => {
        const activeChatId = state.ui.activeChatByEngagement[e.id]
        const isActiveEng = e.id === state.ui.activeEngagementId
        return {
          id: e.id,
          name: e.name,
          typeLabel: state.data.types[e.type].short,
          chatCountLabel: e.chats.length + (e.chats.length === 1 ? ' chat' : ' chats'),
          isActive: isActiveEng,
          statusColor: statusColor(e.status),
          noChats: e.chats.length === 0,
          chats: e.chats.map(ch => {
            const on = isActiveEng && ch.id === activeChatId
            return {
              id: ch.id,
              name: ch.name,
              focusLabel: phaseLabel(e, ch.phaseId),
              dot: colorDot(ch.color),
              color: ch.color,
              isActive: on,
              nameColor: on ? '#e7e9ec' : '#c4c8cf',
            }
          }),
        }
      })
    : []

  const companyName = company ? company.name : ''
  const companyEngCount = engagements.length + (engagements.length === 1 ? ' engagement' : ' engagements')

  const goHome = () => dispatch({ t: 'goHome' })
  const openNew = () => dispatch({ t: 'openNew' })
  const selectEngagement = (id: string) => dispatch({ t: 'selectEngagement', id })
  const selectChat = (id: string) => dispatch({ t: 'selectChat', id })
  const openNewChat = (engId: string) => dispatch({ t: 'openNewChat', engId })
  const onChatContext = (ev: MouseEvent, engId: string, chatId: string) => {
    ev.preventDefault()
    if (ev.stopPropagation) ev.stopPropagation()
    const pad = 12, w = 198, h = 240
    const x = Math.min(ev.clientX, window.innerWidth - w - pad)
    const y = Math.min(ev.clientY, window.innerHeight - h - pad)
    dispatch({ t: 'openCtx', x, y, engId, chatId })
  }

  return (
    <aside
      data-screen-label="Engagements sidebar"
      style={{ width: 274, flex: 'none', background: '#0d0e11', borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ padding: '12px 12px 4px' }}>
        <Hoverable
          as="button"
          type="button"
          onClick={goHome}
          hoverStyle={{ color: '#c9cdd4', background: 'rgba(255,255,255,0.04)' }}
          baseStyle={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 7, border: 'none', background: 'transparent', color: '#8b929c', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', transition: 'all .12s' }}
        >
          <span style={{ fontSize: 14, lineHeight: 0 }}>‹</span> All Projects
        </Hoverable>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 16px 14px' }}>
        <div style={{ lineHeight: 1.15, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e7e9ec', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{companyName}</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: '#656b74' }}>{companyEngCount}</div>
        </div>
      </div>

      <div style={{ padding: '0 12px 12px' }}>
        <Hoverable
          as="button"
          type="button"
          onClick={openNew}
          hoverStyle={{ background: 'rgba(111,123,240,0.16)' }}
          baseStyle={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 9, borderRadius: 9, border: '1px solid rgba(111,123,240,0.32)', background: 'rgba(111,123,240,0.1)', color: '#aab0f7', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: 'background .12s' }}
        >
          <span style={{ fontSize: 15, lineHeight: 0, marginTop: -1 }}>+</span> New Engagement
        </Hoverable>
      </div>

      <div style={{ padding: '4px 20px 6px', fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: '#565c65', textTransform: 'uppercase' }}>Engagements</div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {engagements.map(p => (
          <div key={p.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <Hoverable
              as="button"
              type="button"
              onClick={() => selectEngagement(p.id)}
              hoverStyle={{ background: 'rgba(255,255,255,0.03)' }}
              baseStyle={{ position: 'relative', width: '100%', textAlign: 'left', display: 'flex', gap: 11, alignItems: 'center', padding: '10px 11px', borderRadius: 9, border: '1px solid transparent', background: 'transparent', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', transition: 'background .12s' }}
            >
              {p.isActive && (
                <>
                  <span style={{ position: 'absolute', inset: 0, borderRadius: 9, background: 'rgba(111,123,240,0.08)', border: '1px solid rgba(111,123,240,0.2)', pointerEvents: 'none' }} />
                  <span style={{ position: 'absolute', left: 0, top: 9, bottom: 9, width: 2.5, borderRadius: '0 2px 2px 0', background: '#6f7bf0' }} />
                </>
              )}
              <span style={{ position: 'relative', zIndex: 1, flex: 'none', width: 7, height: 7, borderRadius: '50%', background: p.statusColor }} />
              <span style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: '#dfe2e6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                <span style={{ fontSize: 10.5, color: '#656b74' }}>{p.typeLabel} · {p.chatCountLabel}</span>
              </span>
            </Hoverable>

            {p.isActive && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '3px 0 9px', paddingLeft: 19, borderLeft: '1px solid rgba(255,255,255,0.06)', marginLeft: 15 }}>
                {p.chats.map(ch => (
                  <Hoverable
                    key={ch.id}
                    as="button"
                    type="button"
                    onClick={() => selectChat(ch.id)}
                    onContextMenu={(ev: MouseEvent) => onChatContext(ev, p.id, ch.id)}
                    hoverStyle={{ borderColor: 'rgba(255,255,255,0.16)' }}
                    baseStyle={{ position: 'relative', width: '100%', textAlign: 'left', display: 'flex', gap: 9, alignItems: 'center', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: ch.color, cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', transition: 'border-color .12s' }}
                  >
                    {ch.isActive && (
                      <span style={{ position: 'absolute', inset: 0, borderRadius: 8, background: 'rgba(111,123,240,0.12)', border: '1px solid rgba(111,123,240,0.26)', pointerEvents: 'none' }} />
                    )}
                    <span style={{ position: 'relative', zIndex: 1, flex: 'none', width: 7, height: 7, borderRadius: 2, background: ch.dot }} />
                    <span style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: ch.nameColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.name}</span>
                      <span style={{ fontSize: 10, color: '#565c65' }}>{ch.focusLabel}</span>
                    </span>
                  </Hoverable>
                ))}
                {p.noChats && (
                  <div style={{ padding: '6px 10px', fontSize: 11, color: '#565c65' }}>No chats yet</div>
                )}
                <Hoverable
                  as="button"
                  type="button"
                  onClick={() => openNewChat(p.id)}
                  hoverStyle={{ color: '#aab0f7', background: 'rgba(111,123,240,0.08)', borderColor: 'rgba(111,123,240,0.28)' }}
                  baseStyle={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3, padding: '7px 10px', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.12)', background: 'transparent', color: '#7d838c', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500, cursor: 'pointer', transition: 'all .12s' }}
                >
                  <span style={{ fontSize: 13, lineHeight: 0 }}>+</span> New chat
                </Hoverable>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
