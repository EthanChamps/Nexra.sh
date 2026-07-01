import type { Dispatch } from 'react'
import { Hoverable } from './Hoverable'
import { theme } from '../theme'
import type { AppState } from '../state/selectors'
import { chatByIds } from '../state/selectors'
import type { Action } from '../state/reducer'
import { chatColors } from '../../electron/services/seed'

export function ContextMenu({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const { x, y, engId, chatId } = state.ui.ctxMenu
  const close = () => dispatch({ t: 'closeCtx' })
  const chat = engId && chatId ? chatByIds(state, engId, chatId) : null

  const ctxColorOptions = chatColors.map(c => ({ ...c, selected: chat ? c.bg === chat.color : false }))

  return (
    <>
      <div
        onClick={close}
        onContextMenu={e => { e.preventDefault(); close() }}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }}
      />
      <div
        style={{
          position: 'fixed', top: y, left: x, zIndex: 61, width: 198, background: theme.input,
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 11, padding: 6,
          boxShadow: '0 18px 46px rgba(0,0,0,0.6)',
        }}
      >
        <Hoverable
          as="button"
          type="button"
          onClick={() => dispatch({ t: 'ctxRename' })}
          baseStyle={{
            width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
            borderRadius: 7, border: 'none', background: 'transparent', color: '#dfe2e6', fontFamily: 'inherit',
            fontSize: 12.5, cursor: 'pointer', transition: 'background .1s',
          }}
          hoverStyle={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <span style={{ flex: 'none', width: 14, textAlign: 'center', color: theme.muted2 }}>✎</span> Rename chat
        </Hoverable>

        <div style={{ height: 1, background: theme.border, margin: '5px 6px' }} />

        <div style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: '0.08em', color: theme.dim2, textTransform: 'uppercase', padding: '2px 10px 7px' }}>
          Background colour
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 7, padding: '0 8px 6px' }}>
          {ctxColorOptions.map(co => (
            <button
              key={co.id}
              type="button"
              onClick={() => dispatch({ t: 'ctxSetColor', bg: co.bg })}
              title={co.id}
              style={{
                position: 'relative', width: 22, height: 22, borderRadius: 6, background: co.bg,
                border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 2, background: co.dot }} />
              {co.selected && (
                <span style={{ position: 'absolute', inset: -3, border: `1.5px solid ${theme.accent}`, borderRadius: 8 }} />
              )}
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: theme.border, margin: '5px 6px' }} />

        <Hoverable
          as="button"
          type="button"
          onClick={() => { if (engId && chatId) dispatch({ t: 'ctxDelete', engId, chatId }) }}
          baseStyle={{
            width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
            borderRadius: 7, border: 'none', background: 'transparent', color: '#f0616d', fontFamily: 'inherit',
            fontSize: 12.5, cursor: 'pointer', transition: 'background .1s',
          }}
          hoverStyle={{ background: 'rgba(240,97,109,0.12)' }}
        >
          <span style={{ flex: 'none', width: 14, textAlign: 'center' }}>🗑</span> Delete chat
        </Hoverable>
      </div>
    </>
  )
}
