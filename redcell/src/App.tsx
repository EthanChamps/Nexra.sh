import { useEffect, useReducer } from 'react'
import { reducer, initialUI, initialActiveMap } from './state/reducer'
import type { AppState } from './state/selectors'
import { getSnapshot } from './ipc'
import { Home } from './screens/Home'
import { Workspace } from './screens/Workspace' // added in Task 7

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
  if (state.ui.view === 'home') return <Home state={state} dispatch={dispatch} />
  return <Workspace state={state} dispatch={dispatch} />
}
