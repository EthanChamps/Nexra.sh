import { useEffect, useReducer } from 'react'
import { reducer, initialUI, initialActiveMap } from './state/reducer'
import type { AppState } from './state/selectors'
import { getSnapshot, rehydrateFindings } from './ipc'
import { Home } from './screens/Home'
import { Workspace } from './screens/Workspace'
import { Settings } from './components/Settings'

const empty: AppState = { data: { companies: [], types: {} as any }, ui: initialUI }

export default function App() {
  const [state, dispatch] = useReducer(reducer, empty)
  useEffect(() => {
    getSnapshot().then(data => {
      const seeded: AppState = { data, ui: initialUI }
      dispatch({ t: 'hydrate', data })
      dispatch({ t: 'seedActiveMap', map: initialActiveMap(seeded) })
      rehydrateFindings(dispatch, data)
    })
  }, [])

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
