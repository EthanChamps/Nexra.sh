# Project card rename/delete (kebab + right-click) — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorming), pending spec review
**Milestone context:** Nexra.sh M1 (UI shell, mock backends). See `docs/superpowers/HANDOVER.md`.

## Problem

Project cards on the Home screen (`src/screens/Home.tsx`) have no way to rename
or delete a project — clicking a card only opens it. Chats already have a
right-click context menu (`src/components/ContextMenu.tsx`) with rename/delete;
projects need the equivalent, plus a discoverable kebab (3-dot) trigger since
right-click alone isn't discoverable.

## Behaviour

Each project card gets two ways to open the same menu:

- **Kebab button** (⋮), visible only on card hover, top-right corner of the
  tile. Click opens the menu anchored under the button.
- **Right-click** anywhere on the card opens the same menu at the cursor,
  matching the existing chat context-menu convention.

Menu items (same visual style as the chat context menu: `#15171c` background,
198px wide, 11px radius, destructive item in red):

- **Rename project** (pencil icon) — turns the card's name into an inline
  `<input>` in place (same pattern as `ChatPane.tsx`'s inline rename). Save on
  blur/Enter, cancel on Escape. Card navigation (`onClick` → open project) is
  suppressed while editing. Empty name on save reverts to the previous name.
- **Delete project** (trash icon, destructive/red) — opens a confirm modal
  (styled consistently with `NewProjectModal.tsx`'s overlay/card treatment):
  > Delete "{name}" and all its engagements and chats? This can't be undone.

  Cancel closes the modal with no changes. Delete dispatches the delete action
  and closes the modal.

Menu position is clamped to viewport bounds, reusing the clamp logic already in
`Sidebar.tsx`'s `onChatContext`.

## Changes

### 1. Generalize `ContextMenu.tsx`

Currently chat-specific. Change it to accept a list of menu items and a
position, decoupled from chat dispatch:

```ts
type ContextMenuItem = {
  icon: string
  label: string
  onClick: () => void
  destructive?: boolean
}
```

Both the chat context menu (`Sidebar.tsx`) and the new project card menu
(`Home.tsx`) render through this shared component. No visual changes to the
existing chat menu.

### 2. Kebab + right-click trigger on project cards (`Home.tsx`)

- Add a kebab button per card, shown only via hover (existing `Hoverable`
  pattern), positioned top-right of the tile.
- Add `onContextMenu` on the card to open the same menu at cursor position.
- Both triggers open the generalized context menu with `Rename project` /
  `Delete project` items.

### 3. Inline rename on the card

- New local/reducer state to mark a company as "being renamed" (mirrors
  chat's `editingName` pattern), rendering an `<input>` in place of the name.
- New reducer action `renameCompany(id, name)` in `src/state/reducer.ts`,
  following the exact shape of the existing `ctxRename`/`saveName` actions.

### 4. Delete confirm modal + cascade delete

- New small modal component (or a generalized confirm-modal reused across the
  app if one is trivial to extract from `NewProjectModal.tsx`'s
  overlay/card styling) showing the cascade-warning copy above, with
  Cancel / Delete buttons.
- New reducer action `deleteCompany(id)` in `src/state/reducer.ts`, following
  the existing `ctxDelete` pattern: removes the company and cascades removal
  of its child engagements and chats from state.
- No new `window.nexra` / IPC surface — consistent with current M1 reality
  that all project/engagement/chat CRUD is reducer-only, in-memory, and
  unpersisted (persistence is explicitly M2-deferred per HANDOVER.md).

## Out of scope

- Persistence of rename/delete across app restarts (M2, per HANDOVER.md).
- Deleting the currently-open project from elsewhere in the UI while it's
  open — this feature only touches the Home project grid.
- Undo/trash for deleted projects.

## Testing

Follow the existing reducer-test style (project currently 20/20 passing).

- `renameCompany`: updates the name; empty-name input is rejected/reverted.
- `deleteCompany`: removes the company and cascades removal of its
  engagements and chats.
- Component-level: kebab click opens menu; right-click opens menu at cursor;
  confirm-delete modal Cancel leaves state unchanged; confirm-delete modal
  Delete removes the project.

## Fidelity note

Per `CLAUDE.md`, styling source of truth is
`nexra/design-reference/Nexra.dc.html`. The design reference has no kebab
icon markup and no project-level menu — this feature introduces a new kebab
affordance (not ported from the reference) and reuses the reference's
existing right-click context menu styling (`#15171c` bg, `rgba(255,255,255,0.12)`
border, `11px` radius, `#f0616d` destructive) exactly, per the icon-usage rule
in CLAUDE.md (icons only where they convey meaning — kebab = "more actions",
pencil = rename, trash = delete, all meaningful, not decorative).
