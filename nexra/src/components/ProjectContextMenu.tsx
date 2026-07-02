import type { Dispatch } from 'react'
import { MenuShell, MenuDivider, MenuItem } from './Menu'
import type { AppState } from '../state/selectors'
import type { Action } from '../state/reducer'

export function ProjectContextMenu({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const { x, y, companyId } = state.ui.companyCtxMenu
  const close = () => dispatch({ t: 'closeCompanyCtx' })

  return (
    <MenuShell x={x} y={y} onClose={close}>
      <MenuItem
        icon="✎"
        label="Rename project"
        onClick={() => { if (companyId) dispatch({ t: 'startRenameCompany', id: companyId }) }}
      />
      <MenuDivider />
      <MenuItem
        icon="🗑"
        label="Delete project"
        destructive
        onClick={() => { if (companyId) dispatch({ t: 'requestDeleteCompany', id: companyId }) }}
      />
    </MenuShell>
  )
}
