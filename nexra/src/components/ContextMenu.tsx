import type { Dispatch } from 'react'
import { MenuShell, MenuDivider, MenuItem } from './Menu'
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
    <MenuShell x={x} y={y} onClose={close}>
      <MenuItem icon="✎" label="Rename chat" onClick={() => dispatch({ t: 'ctxRename' })} />

      <MenuDivider />

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

      <MenuDivider />

      <MenuItem
        icon="🗑"
        label="Delete chat"
        destructive
        onClick={() => { if (engId && chatId) dispatch({ t: 'ctxDelete', engId, chatId }) }}
      />
    </MenuShell>
  )
}
