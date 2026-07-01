import { useEffect, useReducer } from 'react'
import { reducer, initialUI, initialActiveMap } from './state/reducer'
import type { AppState } from './state/selectors'
import { getSnapshot } from './ipc'
import { Home } from './screens/Home'
import { Workspace } from './screens/Workspace'

const empty: AppState = { data: { companies: [], types: {} as any }, ui: initialUI }

export default function App() {
  const [state, dispatch] = useReducer(reducer, empty)
  useEffect(() => {
    getSnapshot().then(data => {
      const seeded: AppState = { data, ui: initialUI }
      dispatch({ t: 'hydrate', data })
      dispatch({ t: 'seedActiveMap', map: initialActiveMap(seeded) })
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
  if (state.ui.view === 'home') return <Home state={state} dispatch={dispatch} />
  return <Workspace state={state} dispatch={dispatch} />
}
