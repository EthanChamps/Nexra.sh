import { useEffect, useReducer, useRef, useCallback } from 'react'
import { reducer, initialUI, initialActiveMap } from './state/reducer'
import type { Action } from './state/reducer'
import type { AppState } from './state/selectors'
import { getSnapshot } from './ipc'
import { Home } from './screens/Home'
import { Workspace } from './screens/Workspace'
import { Settings } from './components/Settings'

const empty: AppState = { data: { companies: [], types: {} as any }, ui: initialUI }

// Persist side-effects for the two destructive actions (autosave only upserts).
export function persistDelete(state: AppState, a: Action): void {
  if (a.t === 'confirmDeleteCompany' && state.ui.confirmDeleteCompanyId)
    window.nexra.store.deleteCompany(state.ui.confirmDeleteCompanyId)
  else if (a.t === 'ctxDelete')
    window.nexra.store.deleteChat(a.chatId)
}

export default function App() {
  const [state, rawDispatch] = useReducer(reducer, empty)
  const stateRef = useRef(state); stateRef.current = state
  const hydratedRef = useRef(false)

  const dispatch = useCallback((a: Action) => {
    persistDelete(stateRef.current, a)   // uses pre-reduction state for the id
    rawDispatch(a)
  }, [])

  useEffect(() => {
    getSnapshot().then(data => {
      const seeded: AppState = { data, ui: initialUI }
      rawDispatch({ t: 'hydrate', data })
      rawDispatch({ t: 'seedActiveMap', map: initialActiveMap(seeded) })
      hydratedRef.current = true
    })
  }, [])

  // Debounced autosave: fires on every structural/message change once hydrated.
  useEffect(() => {
    if (!hydratedRef.current) return
    const id = setTimeout(() => { window.nexra.store.save(state.data.companies) }, 400)
    return () => clearTimeout(id)
  }, [state.data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key === 'Backquote')) {
        e.preventDefault()
        dispatch({ t: 'toggleTerminal' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      {state.ui.view === 'home' ? <Home state={state} dispatch={dispatch} /> : <Workspace state={state} dispatch={dispatch} />}
      {state.ui.settingsOpen && <Settings state={state} dispatch={dispatch} />}
    </>
  )
}
