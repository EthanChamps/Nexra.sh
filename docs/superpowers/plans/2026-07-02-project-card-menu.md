# Project Card Rename/Delete Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rename or delete a project (company) from the Home screen's
project-card grid, via a hover-revealed kebab button or right-click, each
opening the same small menu; delete is gated behind a confirm modal.

**Architecture:** Extend the reducer-only state (`nexra/src/state/reducer.ts`,
`nexra/src/state/types.ts`) with company-scoped rename/delete/context-menu
actions, mirroring the existing chat rename/delete/`ctxMenu` pattern exactly.
Extract the visual shell of the existing chat context menu
(`nexra/src/components/ContextMenu.tsx`) into shared `MenuShell`/`MenuDivider`/
`MenuItem` pieces (`nexra/src/components/Menu.tsx`), reused by both the chat
menu and a new `ProjectContextMenu`. Wire kebab + right-click + inline rename
+ confirm-delete modal into `nexra/src/screens/Home.tsx`.

**Tech Stack:** React + TypeScript (Vite), Vitest + `@testing-library/react`
for tests. No new dependencies.

## Global Constraints

- No new `window.nexra` / IPC surface — all project CRUD stays reducer-only,
  in-memory, unpersisted (persistence is M2-deferred per
  `docs/superpowers/HANDOVER.md`).
- Styling values (hex/px/rgba) must match the existing chat context menu and
  `NewProjectModal` exactly — no snapping to nearest `theme.ts` token if it
  doesn't match exactly (per `CLAUDE.md`).
- Icons (kebab ⋮, pencil ✎, trash 🗑) are meaningful (action/state), not
  decorative — consistent with the icon-usage rule in `CLAUDE.md`.
- Empty name on rename save must revert to the previous name (no blank
  project names).
- Delete must cascade-remove all child engagements/chats from state and
  requires the confirm modal to be accepted first.
- All new reducer actions/cases must follow the exact naming and structural
  pattern of the existing `ctxRename`/`ctxDelete`/`ctxMenu`/`saveName`/
  `startRename` actions in `nexra/src/state/reducer.ts`.

All file paths below are relative to `nexra/` unless stated otherwise.

---

### Task 1: Reducer state + actions for company rename/delete

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/reducer.ts`
- Test: `test/reducer.test.ts`

**Interfaces:**
- Produces: `UIState.renamingCompanyId: string | null`,
  `UIState.companyNameDraft: string`,
  `UIState.confirmDeleteCompanyId: string | null`.
- Produces: reducer actions `{ t: 'startRenameCompany'; id: string }`,
  `{ t: 'setCompanyNameDraft'; value: string }`, `{ t: 'saveCompanyName' }`,
  `{ t: 'cancelRenameCompany' }`, `{ t: 'requestDeleteCompany'; id: string }`,
  `{ t: 'cancelDeleteCompany' }`, `{ t: 'confirmDeleteCompany' }`.
- Consumes: existing `AppState`, `reducer`, `initialUI` from
  `src/state/reducer.ts`; `buildSnapshot` from
  `electron/services/store.mock.ts` (already used by `test/reducer.test.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `test/reducer.test.ts` (inside the existing `describe('reducer', ...)`
block, after the `'deletes a chat and reassigns the active one'` test):

```ts
  it('renames a company', () => {
    let s = reducer(boot(), { t: 'startRenameCompany', id: 'c1' })
    expect(s.ui.renamingCompanyId).toBe('c1')
    expect(s.ui.companyNameDraft).toBe(s.data.companies.find(c => c.id === 'c1')!.name)
    s = reducer(s, { t: 'setCompanyNameDraft', value: 'Renamed Co' })
    s = reducer(s, { t: 'saveCompanyName' })
    expect(s.data.companies.find(c => c.id === 'c1')!.name).toBe('Renamed Co')
    expect(s.ui.renamingCompanyId).toBeNull()
  })
  it('reverts to the previous name when saving an empty rename', () => {
    let s = reducer(boot(), { t: 'startRenameCompany', id: 'c1' })
    const original = s.data.companies.find(c => c.id === 'c1')!.name
    s = reducer(s, { t: 'setCompanyNameDraft', value: '   ' })
    s = reducer(s, { t: 'saveCompanyName' })
    expect(s.data.companies.find(c => c.id === 'c1')!.name).toBe(original)
  })
  it('cancels a company rename without changing the name', () => {
    let s = reducer(boot(), { t: 'startRenameCompany', id: 'c1' })
    const original = s.data.companies.find(c => c.id === 'c1')!.name
    s = reducer(s, { t: 'setCompanyNameDraft', value: 'Should not stick' })
    s = reducer(s, { t: 'cancelRenameCompany' })
    expect(s.data.companies.find(c => c.id === 'c1')!.name).toBe(original)
    expect(s.ui.renamingCompanyId).toBeNull()
  })
  it('deletes a company and cascades its engagements', () => {
    let s = reducer(boot(), { t: 'requestDeleteCompany', id: 'c1' })
    expect(s.ui.confirmDeleteCompanyId).toBe('c1')
    s = reducer(s, { t: 'confirmDeleteCompany' })
    expect(s.data.companies.find(c => c.id === 'c1')).toBeUndefined()
    expect(s.ui.confirmDeleteCompanyId).toBeNull()
  })
  it('cancels a company delete without removing it', () => {
    let s = reducer(boot(), { t: 'requestDeleteCompany', id: 'c1' })
    s = reducer(s, { t: 'cancelDeleteCompany' })
    expect(s.data.companies.find(c => c.id === 'c1')).toBeDefined()
    expect(s.ui.confirmDeleteCompanyId).toBeNull()
  })
  it('clears the active company/view when deleting the currently open company', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'requestDeleteCompany', id: 'c1' })
    s = reducer(s, { t: 'confirmDeleteCompany' })
    expect(s.ui.activeCompanyId).toBeNull()
    expect(s.ui.view).toBe('home')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd nexra && npm test`
Expected: FAIL — `renamingCompanyId`/`confirmDeleteCompanyId` are `undefined`
and the new action types don't exist yet (TypeScript errors and/or assertion
failures).

- [ ] **Step 3: Add the new UI state fields**

In `src/state/types.ts`, add a new interface and extend `UIState` (full file
after edit):

```ts
export interface CtxMenuState { open: boolean; x: number; y: number; engId: string | null; chatId: string | null }
export interface CompanyCtxMenuState { open: boolean; x: number; y: number; companyId: string | null }

export interface UIState {
  view: 'home' | 'workspace'
  activeCompanyId: string | null
  activeEngagementId: string | null
  activeChatByEngagement: Record<string, string>
  draft: string
  rightOpen: boolean
  editingName: boolean; nameDraft: string
  colorMenuOpen: boolean
  newProjectOpen: boolean; newCompanyName: string
  newOpen: boolean; selectedType: string; newName: string
  ctxMenu: CtxMenuState
  renamingCompanyId: string | null; companyNameDraft: string
  companyCtxMenu: CompanyCtxMenuState
  confirmDeleteCompanyId: string | null
  terminalOpen: boolean; terminalShell: 'pwsh' | 'cmd' | 'kali'; terminalHeight: number; terminalInput: string
  settingsOpen: boolean
}
```

- [ ] **Step 4: Extend `initialUI` in `src/state/reducer.ts`**

Replace the `initialUI` block (currently lines 30-37):

```ts
export const initialUI: UIState = {
  view: 'home', activeCompanyId: null, activeEngagementId: null, activeChatByEngagement: {},
  draft: '', rightOpen: true, editingName: false, nameDraft: '', colorMenuOpen: false,
  newProjectOpen: false, newCompanyName: '', newOpen: false, selectedType: 'aws', newName: '',
  ctxMenu: { open: false, x: 0, y: 0, engId: null, chatId: null },
  renamingCompanyId: null, companyNameDraft: '',
  companyCtxMenu: { open: false, x: 0, y: 0, companyId: null },
  confirmDeleteCompanyId: null,
  terminalOpen: false, terminalShell: 'pwsh', terminalHeight: 346, terminalInput: '',
  settingsOpen: false,
}
```

- [ ] **Step 5: Add the new action types to the `Action` union**

In `src/state/reducer.ts`, in the `Action` union (currently lines 61-82), add
a new line directly after the existing `ctxMenu`-related line (currently
line 72, the one starting `| { t: 'openCtx'; ...`):

```ts
  | { t: 'startRenameCompany'; id: string } | { t: 'setCompanyNameDraft'; value: string } | { t: 'saveCompanyName' } | { t: 'cancelRenameCompany' }
  | { t: 'openCompanyCtx'; x: number; y: number; companyId: string } | { t: 'closeCompanyCtx' }
  | { t: 'requestDeleteCompany'; id: string } | { t: 'cancelDeleteCompany' } | { t: 'confirmDeleteCompany' }
```

- [ ] **Step 6: Update `clone()` to deep-copy the new nested object**

In `src/state/reducer.ts`, the `clone` function (currently line 83) already
spreads `ctxMenu`. Update it to also spread `companyCtxMenu`:

```ts
const clone = (s: AppState): AppState => ({ data: { ...s.data, companies: s.data.companies.map(c => ({ ...c, engagements: c.engagements.map(e => ({ ...e, chats: e.chats.map(ch => ({ ...ch, messages: [...ch.messages], findings: [...ch.findings], tools: [...ch.tools] })) })) })) }, ui: { ...s.ui, activeChatByEngagement: { ...s.ui.activeChatByEngagement }, ctxMenu: { ...s.ui.ctxMenu }, companyCtxMenu: { ...s.ui.companyCtxMenu } } })
```

- [ ] **Step 7: Add the new reducer cases**

In `src/state/reducer.ts`, insert the following cases directly after the
existing `case 'ctxDelete': ...` line (currently line 140) and before
`case 'setDraft': ...`:

```ts
    case 'startRenameCompany': { const c = s.data.companies.find(x => x.id === a.id); if (!c) return state; U.renamingCompanyId = a.id; U.companyNameDraft = c.name; U.companyCtxMenu = { ...U.companyCtxMenu, open: false }; return s }
    case 'setCompanyNameDraft': U.companyNameDraft = a.value; return s
    case 'saveCompanyName': { if (!U.renamingCompanyId) return state; const name = U.companyNameDraft.trim(); const c = s.data.companies.find(x => x.id === U.renamingCompanyId); if (c && name) c.name = name; U.renamingCompanyId = null; return s }
    case 'cancelRenameCompany': U.renamingCompanyId = null; return s
    case 'openCompanyCtx': U.companyCtxMenu = { open: true, x: a.x, y: a.y, companyId: a.companyId }; return s
    case 'closeCompanyCtx': U.companyCtxMenu = { ...U.companyCtxMenu, open: false }; return s
    case 'requestDeleteCompany': U.confirmDeleteCompanyId = a.id; U.companyCtxMenu = { ...U.companyCtxMenu, open: false }; return s
    case 'cancelDeleteCompany': U.confirmDeleteCompanyId = null; return s
    case 'confirmDeleteCompany': {
      if (!U.confirmDeleteCompanyId) return state
      const id = U.confirmDeleteCompanyId
      s.data.companies = s.data.companies.filter(c => c.id !== id)
      if (U.activeCompanyId === id) { U.activeCompanyId = null; U.activeEngagementId = null; U.view = 'home' }
      U.confirmDeleteCompanyId = null
      return s
    }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd nexra && npm test`
Expected: PASS — all prior tests plus the 6 new ones (26/26 total after this
task; more tests are added in later tasks).

- [ ] **Step 9: Commit**

```bash
git add nexra/src/state/types.ts nexra/src/state/reducer.ts nexra/test/reducer.test.ts
git commit -m "feat: add reducer actions for project rename/delete"
```

---

### Task 2: `Hoverable` render-prop support (hover-conditional children)

The project card needs to reveal a kebab button only while the card is
hovered. `Hoverable` (`src/components/Hoverable.tsx`) already tracks its own
hover boolean internally but doesn't expose it. Add optional render-prop
support without changing any existing call site's behavior.

**Files:**
- Modify: `src/components/Hoverable.tsx`
- Test: `test/Hoverable.test.tsx` (new)

**Interfaces:**
- Produces: `Hoverable`'s `children` prop now accepts
  `React.ReactNode | ((hovered: boolean) => React.ReactNode)`, in addition to
  the plain `ReactNode` it already accepted.
- Consumes: existing `Hoverable` component signature (`as`, `baseStyle`,
  `hoverStyle`, `children`, `...rest`).

- [ ] **Step 1: Write the failing test**

Create `test/Hoverable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Hoverable } from '../src/components/Hoverable'

describe('Hoverable', () => {
  it('passes plain children through unchanged', () => {
    render(<Hoverable as="div" baseStyle={{}}>plain child</Hoverable>)
    expect(screen.getByText('plain child')).toBeInTheDocument()
  })
  it('invokes function children with the current hover state', () => {
    render(
      <Hoverable as="div" baseStyle={{}} data-testid="card">
        {(hovered: boolean) => <span>{hovered ? 'hovered' : 'idle'}</span>}
      </Hoverable>
    )
    expect(screen.getByText('idle')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByTestId('card'))
    expect(screen.getByText('hovered')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('card'))
    expect(screen.getByText('idle')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npm test -- Hoverable`
Expected: FAIL — function children renders as `[object Function]`/nothing
useful, or a React warning; the `hovered`/`idle` text is not found.

- [ ] **Step 3: Implement render-prop support**

Replace `src/components/Hoverable.tsx` in full:

```tsx
import React, { useState } from 'react'
type Props = React.HTMLAttributes<HTMLElement> & {
  as?: 'button' | 'div' | 'span'; baseStyle: React.CSSProperties; hoverStyle?: React.CSSProperties
  title?: string; onClick?: (e: any) => void; onContextMenu?: (e: any) => void; disabled?: boolean; type?: 'button'
  children?: React.ReactNode | ((hovered: boolean) => React.ReactNode)
}
export function Hoverable({ as = 'div', baseStyle, hoverStyle, children, ...rest }: Props) {
  const [h, setH] = useState(false)
  const Tag = as as any
  const content = typeof children === 'function' ? (children as (hovered: boolean) => React.ReactNode)(h) : children
  return <Tag {...rest} style={{ ...baseStyle, ...(h && hoverStyle ? hoverStyle : {}) }}
    onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}>{content}</Tag>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nexra && npm test -- Hoverable`
Expected: PASS (2/2 in this file).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `cd nexra && npm test`
Expected: PASS — all existing call sites (`Home.tsx`, `Sidebar.tsx`,
`ChatPane.tsx`, etc.) pass plain `ReactNode` children, unaffected by the
`typeof children === 'function'` branch.

- [ ] **Step 6: Commit**

```bash
git add nexra/src/components/Hoverable.tsx nexra/test/Hoverable.test.tsx
git commit -m "feat: support hover-aware render-prop children in Hoverable"
```

---

### Task 3: Extract shared `Menu.tsx` (shell/divider/item) from `ContextMenu.tsx`

Pulls the pure-presentational chrome (backdrop, positioned panel, item
button, divider) out of `ContextMenu.tsx` so the same visual menu can be
reused for the new project menu, with zero visual change to the existing
chat context menu.

**Files:**
- Create: `src/components/Menu.tsx`
- Modify: `src/components/ContextMenu.tsx`
- Test: `test/ContextMenu.test.tsx` (new)

**Interfaces:**
- Produces: `MenuShell({ x, y, onClose, children }): JSX.Element`,
  `MenuDivider(): JSX.Element`,
  `MenuItem({ icon, label, onClick, destructive? }): JSX.Element`.
- Consumes: `theme` from `../theme`, `Hoverable` from `./Hoverable`.

- [ ] **Step 1: Write the failing test**

Create `test/ContextMenu.test.tsx` (exercises the existing chat menu to lock
in current behavior before refactoring underneath it):

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu } from '../src/components/ContextMenu'
import { reducer, initialUI } from '../src/state/reducer'
import { buildSnapshot } from '../electron/services/store.mock'
import { useReducer } from 'react'

// Engagement/chat ids are generated at seed time (an incrementing counter in
// electron/services/seed.ts), not fixed literals — pull real ids out of a
// fresh snapshot rather than hardcoding them, so `chatByIds` resolves a chat.
function Harness() {
  const data = buildSnapshot()
  const eng = data.companies[0].engagements[0]
  const chat = eng.chats[0]
  const boot = { data, ui: { ...initialUI, ctxMenu: { open: true, x: 40, y: 40, engId: eng.id, chatId: chat.id } } }
  const [state, dispatch] = useReducer(reducer, boot)
  return <ContextMenu state={state as any} dispatch={dispatch} />
}

describe('ContextMenu', () => {
  it('renders Rename chat and Delete chat items', () => {
    render(<Harness />)
    expect(screen.getByText('Rename chat')).toBeInTheDocument()
    expect(screen.getByText('Delete chat')).toBeInTheDocument()
  })
  it('closes when the backdrop is clicked', () => {
    render(<Harness />)
    fireEvent.click(document.querySelectorAll('div[style*="inset: 0px"]')[0]!)
    expect(screen.queryByText('Rename chat')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes against current code**

Run: `cd nexra && npm test -- ContextMenu`
Expected: PASS against the *current* (pre-refactor) `ContextMenu.tsx` — this
test's job is to catch regressions during the refactor in Step 3, not to
fail first (there's no new behavior yet, only extraction).

- [ ] **Step 3: Create `src/components/Menu.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Hoverable } from './Hoverable'
import { theme } from '../theme'

export function MenuShell({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div
        onClick={onClose}
        onContextMenu={e => { e.preventDefault(); onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }}
      />
      <div
        style={{
          position: 'fixed', top: y, left: x, zIndex: 61, width: 198, background: theme.input,
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 11, padding: 6,
          boxShadow: '0 18px 46px rgba(0,0,0,0.6)',
        }}
      >
        {children}
      </div>
    </>
  )
}

export function MenuDivider() {
  return <div style={{ height: 1, background: theme.border, margin: '5px 6px' }} />
}

export function MenuItem({ icon, label, onClick, destructive }: { icon: string; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <Hoverable
      as="button"
      type="button"
      onClick={onClick}
      baseStyle={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
        borderRadius: 7, border: 'none', background: 'transparent',
        color: destructive ? '#f0616d' : '#dfe2e6', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', transition: 'background .1s',
      }}
      hoverStyle={{ background: destructive ? 'rgba(240,97,109,0.12)' : 'rgba(255,255,255,0.06)' }}
    >
      <span style={{ flex: 'none', width: 14, textAlign: 'center', color: destructive ? undefined : theme.muted2 }}>{icon}</span> {label}
    </Hoverable>
  )
}
```

- [ ] **Step 4: Refactor `ContextMenu.tsx` to use the shared pieces**

Replace `src/components/ContextMenu.tsx` in full:

```tsx
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
```

- [ ] **Step 5: Run tests to verify no regressions**

Run: `cd nexra && npm test -- ContextMenu`
Expected: PASS (both tests from Step 1, unchanged).

Run: `cd nexra && npm test`
Expected: PASS — full suite green.

- [ ] **Step 6: Commit**

```bash
git add nexra/src/components/Menu.tsx nexra/src/components/ContextMenu.tsx nexra/test/ContextMenu.test.tsx
git commit -m "refactor: extract shared Menu shell/item from ContextMenu"
```

---

### Task 4: `ProjectContextMenu` + kebab/right-click wiring on project cards

**Files:**
- Create: `src/components/ProjectContextMenu.tsx`
- Modify: `src/screens/Home.tsx`
- Test: `test/Home.test.tsx` (new)

**Interfaces:**
- Produces: `ProjectContextMenu({ state, dispatch }): JSX.Element`.
- Consumes: `MenuShell`, `MenuDivider`, `MenuItem` from `./Menu` (Task 3);
  `UIState.companyCtxMenu` (Task 1); dispatches `closeCompanyCtx`,
  `startRenameCompany`, `requestDeleteCompany` (Task 1).
- Consumes in `Home.tsx`: `Hoverable`'s render-prop children (Task 2).

- [ ] **Step 1: Write the failing test**

Create `test/Home.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { useReducer } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Home } from '../src/screens/Home'
import { reducer, initialUI } from '../src/state/reducer'
import { buildSnapshot } from '../electron/services/store.mock'

function Harness() {
  const [state, dispatch] = useReducer(reducer, { data: buildSnapshot(), ui: initialUI })
  return <Home state={state} dispatch={dispatch} />
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
})
```

Note: `data-testid="project-card"` is added to the card element in Step 4
below (Task 4's `Home.tsx` markup change) — this test relies on it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npm test -- Home`
Expected: FAIL — no element with title "Project actions", no "Rename
project"/"Delete project" text yet.

- [ ] **Step 3: Create `src/components/ProjectContextMenu.tsx`**

```tsx
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
```

- [ ] **Step 4: Wire kebab + right-click + menu render into `Home.tsx`**

Modify `src/screens/Home.tsx`. First, update imports (top of file):

```tsx
import type { Dispatch, MouseEvent, KeyboardEvent } from 'react'
import { Hoverable } from '../components/Hoverable'
import { NewProjectModal } from '../components/modals/NewProjectModal'
import { ProjectContextMenu } from '../components/ProjectContextMenu'
import { theme } from '../theme'
import type { AppState } from '../state/selectors'
import { statusColor } from '../state/selectors'
import type { Action } from '../state/reducer'
```

Then, inside the `Home` component, add a context-menu handler next to the
existing `openCompany`/`openNewProject`/`openSettings` (currently lines
19-21):

```tsx
  const openCompany = (id: string) => dispatch({ t: 'openCompany', id })
  const openNewProject = () => dispatch({ t: 'openNewProject' })
  const openSettings = () => dispatch({ t: 'openSettings' })
  const onCompanyContext = (ev: MouseEvent, companyId: string) => {
    ev.preventDefault()
    if (ev.stopPropagation) ev.stopPropagation()
    const pad = 12, w = 198, h = 100
    const x = Math.min(ev.clientX, window.innerWidth - w - pad)
    const y = Math.min(ev.clientY, window.innerHeight - h - pad)
    dispatch({ t: 'openCompanyCtx', x, y, companyId })
  }
```

Then replace the project-card `Hoverable` block (currently lines 82-127,
the `{companies.map(c => ( <Hoverable key={c.id} as="button" ... )}` block)
with the following. This changes the card's root element from `as="button"`
to `as="div"` (with `role="button"`/`tabIndex`/`onKeyDown` added to preserve
keyboard activation) so the kebab `<button>` and — in Task 5 — an `<input>`
can legally live inside it without nesting interactive elements inside a
real `<button>`:

```tsx
          {companies.map(c => (
            <Hoverable
              key={c.id}
              as="div"
              role="button"
              tabIndex={0}
              data-testid="project-card"
              onClick={() => openCompany(c.id)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCompany(c.id) }
              }}
              onContextMenu={(ev: MouseEvent) => onCompanyContext(ev, c.id)}
              baseStyle={{
                position: 'relative', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 14, padding: '17px 17px 15px',
                borderRadius: 13, border: '1px solid rgba(255,255,255,0.08)', background: theme.card, cursor: 'pointer',
                color: 'inherit', fontFamily: 'inherit', transition: 'border-color .14s,background .14s',
              }}
              hoverStyle={{ borderColor: 'rgba(111,123,240,0.4)', background: theme.card2 }}
            >
              {(hovered: boolean) => (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        data-testid="project-name"
                        style={{
                          fontSize: 15.5, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {c.name}
                      </div>
                      <div style={{ marginTop: 3, fontFamily: theme.mono, fontSize: 11, color: theme.dim }}>
                        {c.engCountLabel} · {c.updated}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 24 }}>
                    {c.chips.map((ch, i) => (
                      <span
                        key={i}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 8px', borderRadius: 6,
                          background: theme.input, border: '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <span style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: ch.color }} />
                        <span style={{ fontFamily: theme.mono, fontSize: 10.5, color: theme.muted2 }}>{ch.short}</span>
                      </span>
                    ))}
                    {c.empty && (
                      <span style={{ fontSize: 11.5, color: theme.dim2, alignSelf: 'center' }}>No engagements yet</span>
                    )}
                  </div>
                  {hovered && (
                    <Hoverable
                      as="button"
                      type="button"
                      title="Project actions"
                      onClick={(ev: MouseEvent) => { ev.stopPropagation(); onCompanyContext(ev, c.id) }}
                      baseStyle={{
                        position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: 7,
                        border: `1px solid ${theme.border2}`, background: theme.card2, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', color: theme.muted2, fontSize: 14,
                        cursor: 'pointer', transition: 'all .12s', zIndex: 2,
                      }}
                      hoverStyle={{ color: theme.textDim, background: theme.card, borderColor: 'rgba(255,255,255,0.16)' }}
                    >
                      ⋮
                    </Hoverable>
                  )}
                </>
              )}
            </Hoverable>
          ))}
```

Finally, add the menu render site next to the existing modal render (currently
line 147, `{state.ui.newProjectOpen && <NewProjectModal .../>}`):

```tsx
      {state.ui.newProjectOpen && <NewProjectModal state={state} dispatch={dispatch} />}
      {state.ui.companyCtxMenu.open && <ProjectContextMenu state={state} dispatch={dispatch} />}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd nexra && npm test -- Home`
Expected: PASS (both tests).

Run: `cd nexra && npm test`
Expected: PASS — full suite green (no regressions to `ContextMenu`/`Sidebar`
behavior, which are untouched).

- [ ] **Step 6: Commit**

```bash
git add nexra/src/components/ProjectContextMenu.tsx nexra/src/screens/Home.tsx nexra/test/Home.test.tsx
git commit -m "feat: add kebab + right-click project menu on Home cards"
```

---

### Task 5: Inline rename on the project card

**Files:**
- Modify: `src/screens/Home.tsx`
- Test: `test/Home.test.tsx`

**Interfaces:**
- Consumes: `UIState.renamingCompanyId`, `UIState.companyNameDraft` (Task 1);
  dispatches `setCompanyNameDraft`, `saveCompanyName`, `cancelRenameCompany`
  (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `test/Home.test.tsx`, inside the existing `describe` block:

```tsx
  it('renames a project via the menu + inline input', () => {
    render(<Harness />)
    const card = screen.getAllByTestId('project-card')[0]
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByTitle('Project actions'))
    fireEvent.click(screen.getByText('Rename project'))

    const input = screen.getByDisplayValue(/./) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Acme Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('Acme Renamed')).toBeInTheDocument()
  })
  it('cancels an inline rename on Escape, leaving the name unchanged', () => {
    render(<Harness />)
    const card = screen.getAllByTestId('project-card')[0]
    const originalName = screen.getAllByTestId('project-name')[0].textContent
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByTitle('Project actions'))
    fireEvent.click(screen.getByText('Rename project'))

    const input = screen.getByDisplayValue(/./) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Should not stick' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByText('Should not stick')).not.toBeInTheDocument()
    expect(screen.getByText(originalName!)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npm test -- Home`
Expected: FAIL — clicking "Rename project" currently only dispatches
`startRenameCompany`, but the card doesn't render an `<input>` yet.

- [ ] **Step 3: Render the inline input when `renamingCompanyId` matches**

In `src/screens/Home.tsx`, inside the render-prop `(hovered: boolean) => (...)`
added in Task 4, replace the card-name `<div>`:

```tsx
                      <div
                        style={{
                          fontSize: 15.5, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {c.name}
                      </div>
```

with a conditional block:

```tsx
                      {state.ui.renamingCompanyId === c.id ? (
                        <input
                          value={state.ui.companyNameDraft}
                          onChange={e => dispatch({ t: 'setCompanyNameDraft', value: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); dispatch({ t: 'saveCompanyName' }) }
                            if (e.key === 'Escape') dispatch({ t: 'cancelRenameCompany' })
                          }}
                          onBlur={() => dispatch({ t: 'saveCompanyName' })}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                          style={{
                            width: '100%', background: theme.input, border: '1px solid rgba(111,123,240,0.5)',
                            borderRadius: 7, padding: '4px 8px', fontFamily: 'inherit', fontSize: 15.5,
                            fontWeight: 600, color: theme.text, outline: 'none',
                          }}
                        />
                      ) : (
                        <div
                          data-testid="project-name"
                          style={{
                            fontSize: 15.5, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                          }}
                        >
                          {c.name}
                        </div>
                      )}
```

Also guard card-open and kebab-visibility against the editing state — update
the card's `onClick` and the kebab's render condition:

```tsx
              onClick={() => { if (state.ui.renamingCompanyId !== c.id) openCompany(c.id) }}
```

```tsx
                  {hovered && state.ui.renamingCompanyId !== c.id && (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd nexra && npm test -- Home`
Expected: PASS (4/4 in this file).

Run: `cd nexra && npm test`
Expected: PASS — full suite green.

- [ ] **Step 5: Commit**

```bash
git add nexra/src/screens/Home.tsx nexra/test/Home.test.tsx
git commit -m "feat: inline rename on project cards"
```

---

### Task 6: Delete confirm modal + wiring

**Files:**
- Create: `src/components/modals/DeleteProjectModal.tsx`
- Modify: `src/screens/Home.tsx`
- Test: `test/Home.test.tsx`

**Interfaces:**
- Produces: `DeleteProjectModal({ state, dispatch }): JSX.Element | null`.
- Consumes: `UIState.confirmDeleteCompanyId` (Task 1); dispatches
  `cancelDeleteCompany`, `confirmDeleteCompany` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `test/Home.test.tsx`:

```tsx
  it('cancelling the delete-confirm modal keeps the project', () => {
    render(<Harness />)
    const before = screen.getAllByTestId('project-card').length
    const card = screen.getAllByTestId('project-card')[0]
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByTitle('Project actions'))
    fireEvent.click(screen.getByText('Delete project'))

    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText(/can't be undone/i)).not.toBeInTheDocument()
    expect(screen.getAllByTestId('project-card')).toHaveLength(before)
  })
  it('confirming delete removes the project card', () => {
    render(<Harness />)
    const before = screen.getAllByTestId('project-card').length
    const card = screen.getAllByTestId('project-card')[0]
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByTitle('Project actions'))
    fireEvent.click(screen.getByText('Delete project'))

    // The description text and the modal's "Delete project" button share a
    // common ancestor two levels up (the modal card div) — the description
    // is nested one level deeper than the button row, so a single
    // `.parentElement` isn't enough to reach a shared container.
    const dialog = screen.getByText(/can't be undone/i).parentElement!.parentElement!
    fireEvent.click(within(dialog).getByText('Delete project'))

    expect(screen.getAllByTestId('project-card')).toHaveLength(before - 1)
  })
```

Add `within` to the `@testing-library/react` import at the top of the file:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npm test -- Home`
Expected: FAIL — clicking "Delete project" in the menu currently dispatches
`requestDeleteCompany`, but no modal renders yet, so the "can't be undone"
text is never found.

- [ ] **Step 3: Create `src/components/modals/DeleteProjectModal.tsx`**

```tsx
import type { Dispatch } from 'react'
import { Hoverable } from '../Hoverable'
import { theme } from '../../theme'
import type { AppState } from '../../state/selectors'
import type { Action } from '../../state/reducer'

export function DeleteProjectModal({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const id = state.ui.confirmDeleteCompanyId
  const company = state.data.companies.find(c => c.id === id)
  const close = () => dispatch({ t: 'cancelDeleteCompany' })
  const confirm = () => dispatch({ t: 'confirmDeleteCompany' })
  if (!company) return null

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(6,7,9,0.68)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 440, maxWidth: '100%', background: theme.card2, border: `1px solid ${theme.border2}`,
          borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ padding: '20px 22px 4px' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>Delete project</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.muted, marginTop: 5 }}>
            Delete "{company.name}" and all its engagements and chats? This can't be undone.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '18px 22px 20px' }}>
          <Hoverable
            as="button"
            type="button"
            onClick={close}
            baseStyle={{
              padding: '8px 15px', borderRadius: 9, border: `1px solid ${theme.border2}`, background: 'transparent',
              color: theme.muted2, fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', transition: 'all .12s',
            }}
            hoverStyle={{ color: theme.textDim, borderColor: 'rgba(255,255,255,0.16)' }}
          >
            Cancel
          </Hoverable>
          <Hoverable
            as="button"
            type="button"
            onClick={confirm}
            baseStyle={{
              padding: '8px 17px', borderRadius: 9, border: 'none', background: '#f0616d', color: '#fff',
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: 'background .12s',
            }}
            hoverStyle={{ background: 'rgba(240,97,109,0.85)' }}
          >
            Delete project
          </Hoverable>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire it into `Home.tsx`**

Add the import near the other component imports:

```tsx
import { DeleteProjectModal } from '../components/modals/DeleteProjectModal'
```

Add the render site next to `ProjectContextMenu`'s (added in Task 4):

```tsx
      {state.ui.newProjectOpen && <NewProjectModal state={state} dispatch={dispatch} />}
      {state.ui.companyCtxMenu.open && <ProjectContextMenu state={state} dispatch={dispatch} />}
      {state.ui.confirmDeleteCompanyId && <DeleteProjectModal state={state} dispatch={dispatch} />}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd nexra && npm test -- Home`
Expected: PASS (6/6 in this file).

Run: `cd nexra && npm test`
Expected: PASS — full suite green, all tests across all files pass.

- [ ] **Step 6: Commit**

```bash
git add nexra/src/components/modals/DeleteProjectModal.tsx nexra/src/screens/Home.tsx nexra/test/Home.test.tsx
git commit -m "feat: add delete-project confirm modal"
```

---

### Task 7: Manual verification pass

**Files:** none (manual QA only, no code changes)

- [ ] **Step 1: Launch the app**

Run: `cd nexra && npm run dev`
(Requires a display; if running headless, skip this task and note it in the
final report — the automated tests from Tasks 1-6 are the primary
verification.)

- [ ] **Step 2: Verify kebab hover/click**

Hover a project card on the Home screen — a kebab (⋮) button should fade in
at the top-right corner. Click it — the menu should open with "Rename
project" and "Delete project", styled identically to the existing chat
right-click menu (dark panel, red delete item).

- [ ] **Step 3: Verify right-click**

Right-click anywhere on a project card (not the kebab) — the same menu
should open at the cursor position, clamped to stay on-screen near
viewport edges.

- [ ] **Step 4: Verify rename**

Click "Rename project" — the name should become an editable input in place.
Type a new name and press Enter — it should save and display. Repeat and
press Escape — it should revert to the prior name. Repeat and clear the
field entirely before blurring — it should revert to the prior name (not go
blank).

- [ ] **Step 5: Verify delete**

Click "Delete project" — a confirm modal should appear naming the project
and warning about cascading deletion. Click Cancel — the project should
remain. Repeat and click "Delete project" in the modal — the card should be
removed from the grid.

- [ ] **Step 6: Report findings**

If any visual mismatch or interaction bug is found, fix it in the relevant
task's file before proceeding; re-run `npm test` after any fix.

---

## Plan Self-Review Notes

- **Spec coverage:** kebab-on-hover ✓ (Task 4), right-click ✓ (Task 4),
  shared menu styling reused from `ContextMenu` ✓ (Task 3), inline rename ✓
  (Task 5), confirm-delete modal with cascade wording ✓ (Task 6), cascade
  delete of engagements/chats ✓ (Task 1, filtering `s.data.companies`
  removes the whole `Company` including its nested `engagements`/`chats`),
  no new IPC/persistence ✓ (no task touches `electron/` service files or
  `global.d.ts`), reducer-test coverage ✓ (Task 1), component-test coverage
  ✓ (Tasks 2, 3, 4, 5, 6).
- **Type consistency:** `renamingCompanyId`/`companyNameDraft`/
  `confirmDeleteCompanyId`/`companyCtxMenu` are introduced once in Task 1
  (`types.ts` + `initialUI`) and referenced with the same names in every
  later task (`ProjectContextMenu.tsx`, `Home.tsx`, `DeleteProjectModal.tsx`).
  Action type names (`startRenameCompany`, `setCompanyNameDraft`,
  `saveCompanyName`, `cancelRenameCompany`, `openCompanyCtx`,
  `closeCompanyCtx`, `requestDeleteCompany`, `cancelDeleteCompany`,
  `confirmDeleteCompany`) match between the Task 1 `Action` union, the Task 1
  reducer `case` labels, and every `dispatch({ t: '...' })` call site in
  later tasks.
- **Known trade-off:** the project card's root element changes from a real
  `<button>` to a `<div role="button" tabIndex={0}>` (Task 4) because a
  `<button>` cannot legally contain nested interactive elements (the kebab
  `<button>` and, later, the rename `<input>`). `onKeyDown` for Enter/Space
  is added to preserve keyboard activation; this was not explicitly
  requested but avoids silently regressing existing keyboard support.
