import { describe, it, expect } from 'vitest'
import { useReducer } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Home } from '../src/screens/Home'
import { Workspace } from '../src/screens/Workspace'
import { reducer, initialUI } from '../src/state/reducer'
import { buildSnapshot } from '../electron/services/store.mock'

function Harness() {
  const [state, dispatch] = useReducer(reducer, { data: buildSnapshot(), ui: initialUI })
  return <Home state={state} dispatch={dispatch} />
}

// Mirrors App.tsx's view-switching so navigation away from Home is observable.
function NavHarness() {
  const [state, dispatch] = useReducer(reducer, { data: buildSnapshot(), ui: initialUI })
  return state.ui.view === 'home' ? <Home state={state} dispatch={dispatch} /> : <Workspace state={state} dispatch={dispatch} />
}

describe('Home project card menu', () => {
  it('opens the project menu via the kebab button on hover', () => {
    render(<Harness />)
    const card = screen.getAllByTestId('project-card')[0]
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByTitle('Project actions'))
    expect(screen.getByText('Rename project')).toBeInTheDocument()
    expect(screen.getByText('Delete project')).toBeInTheDocument()
  })
  it('opens the project menu via right-click', () => {
    render(<Harness />)
    const card = screen.getAllByTestId('project-card')[0]
    fireEvent.contextMenu(card, { clientX: 50, clientY: 50 })
    expect(screen.getByText('Rename project')).toBeInTheDocument()
  })
  it('does not navigate into the project when Enter is pressed on the kebab button', () => {
    render(<NavHarness />)
    const card = screen.getAllByTestId('project-card')[0]
    fireEvent.mouseEnter(card)
    const kebab = screen.getByTitle('Project actions')
    fireEvent.keyDown(kebab, { key: 'Enter' })
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0)
  })
})
