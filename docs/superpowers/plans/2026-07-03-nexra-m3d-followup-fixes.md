# M3d Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five bugs surfaced by manual testing of the M3d agent-requested-inputs feature: secrets filled via chat don't appear in the Secrets side panel, no loading feedback after resuming the agent, raw `SKILL_CALL[...]` syntax leaks into the chat, garbled/interleaved duplicate text after resuming, and auto-resume should become a manual "Continue" button.

**Architecture:** Each fix is independent and root-caused (not a guess):
1. `ContextPanel.tsx` passes a field (`eng.companyId`) that has never existed on `Engagement`, so the Secrets panel/modal always operate on `companyId: undefined` — fix by deriving the real id via `activeCompany(state)`.
2. There is no guard against two concurrent `agent:send` streams for the same chat (confirmed gap, documented in `HANDOVER.md`) — extract a small `track`/`untrack` pair into a new pure module and wire it into `main.ts` so a new send aborts any stream already in flight for that chat.
3. `MessageList.tsx`'s typing indicator only shows when the trailing message has `role: 'user'`, which is never true after a resume (no user bubble is posted) — broaden the condition to "streaming and no assistant prose has started yet".
4. The model's raw `SKILL_CALL[...]` control syntax streams straight into the chat bubble unfiltered — add a small render-time formatter that replaces complete occurrences with a friendly label, without touching stored message content.
5. Replace the auto-resume in `RequestCard.tsx` with an explicit "Continue" button for both the `inputs` and `scope` request cards, guarded by a `useRef` so a rapid double-click can't fire the resume twice.

**Tech Stack:** Electron (main + preload + renderer), React, TypeScript, Vitest, `@testing-library/react`.

## Global Constraints

- No renderer component may import a service directly — always go through `window.nexra.*`.
- Tests run with `npm test` (`vitest run`) from `nexra/`. All existing tests must stay green throughout (baseline: 173 passing, confirmed at the start of this plan).
- Every code step is TDD: failing test first, minimal implementation, green, commit.
- Do not fix the unrelated pre-existing `tsc` baseline (theme property mismatches in `SecretModal.tsx`/`SecretsPanel.tsx`, and the OTHER `bg2` reference at `ContextPanel.tsx:65` which is cosmetic and not part of this bug report) — only touch what each task specifies.
- Do not touch the legacy `requestKind === 'secret'` branch in `RequestCard.tsx` — grep confirms no code path creates that message shape anymore (dead since Task 3 of the M3d plan replaced `secret_request` with `input_request`); it is out of scope here.

---

## File-by-file responsibility map

- `electron/services/inflight.ts` — new. Pure `track`/`untrack` helpers implementing the overlapping-stream guard.
- `electron/main.ts` — wire `track`/`untrack` into the `agent:send` handler.
- `src/components/ContextPanel.tsx` — derive the real company id via `activeCompany(state)` instead of `eng.companyId`.
- `src/components/MessageList.tsx` — fix `showTyping`; apply the friendly skill-call formatter to assistant text.
- `src/lib/friendlySkillCalls.ts` — new. Pure text formatter, replaces `SKILL_CALL[...]` with a friendly label.
- `src/components/RequestCard.tsx` — replace auto-resume with a manual Continue button in the `inputs` and `scope` branches.

---

## Task 1: Fix the Secrets panel's companyId (real bug, not a guess)

**Files:**
- Modify: `nexra/src/components/ContextPanel.tsx:7,104-108` (import + companyId source)
- Test: `nexra/test/ContextPanel.test.tsx`

**Interfaces:**
- Consumes: `activeCompany` from `../state/selectors` (already exports it; `ContextPanel.tsx` just never imported it).
- Produces: `SecretsPanel`/`SecretModal` now receive the real `Company.id` instead of `undefined`.

- [ ] **Step 1: Write the failing test**

Append to `nexra/test/ContextPanel.test.tsx` — it already imports everything this test needs (`render`, `screen`, `fireEvent`, `reducer`, `initialUI`, `buildSnapshot`, `ContextPanel`); just add `vi` to the existing `import { describe, it, expect } from 'vitest'` line:

```tsx
describe('ContextPanel secrets tab', () => {
  it('passes the real company id to SecretsPanel, not the (nonexistent) Engagement.companyId', () => {
    let s = reducer({ data: buildSnapshot(), ui: initialUI }, { t: 'openCompany', id: 'c1' })
    const list = vi.fn(() => Promise.resolve([]))
    ;(window as any).nexra = { secrets: { list } }
    const dispatch = () => {}
    render(<ContextPanel state={s} dispatch={dispatch as any} />)
    fireEvent.click(screen.getByText('secrets'))
    expect(list).toHaveBeenCalledWith('c1')
  })
})
```

Add `vi` to the existing `import { describe, it, expect } from 'vitest'` at the top of the file (change to `import { describe, it, expect, vi } from 'vitest'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/ContextPanel.test.tsx -t "real company id"`
Expected: FAIL — `list` is called with `undefined`, not `'c1'`.

- [ ] **Step 3: Fix the source of the id**

In `ContextPanel.tsx`, update the import (line 7):

```tsx
import { activeEngagement, activeCompany, activeChat, phaseLabel, sevColor } from '../state/selectors'
```

Add a `company` lookup near the top of the component (after `const eng = activeEngagement(state)` at line 11):

```tsx
  const eng = activeEngagement(state)
  const company = activeCompany(state)
  const chat = activeChat(state)
```

Update the `'secrets'` tab block (lines 104-108) to use `company?.id`:

```tsx
        {tab === 'secrets' && eng && company && (
          <>
            <SecretsPanel companyId={company.id} onCreateClick={() => setSecretModalOpen(true)} />
            {secretModalOpen && <SecretModal companyId={company.id} onClose={() => setSecretModalOpen(false)} onSave={() => { setSecretModalOpen(false) }} />}
          </>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nexra && npx vitest run test/ContextPanel.test.tsx`
Expected: PASS (new test + the 2 existing findings tests).

- [ ] **Step 5: Commit**

```bash
git add nexra/src/components/ContextPanel.tsx nexra/test/ContextPanel.test.tsx
git commit -m "fix(m3d): Secrets panel used a companyId field that never existed on Engagement"
```

---

## Task 2: Overlapping-stream guard

**Files:**
- Create: `nexra/electron/services/inflight.ts`
- Modify: `nexra/electron/main.ts:9,47,68-76` (import + wiring)
- Test: `nexra/test/inflight.test.ts`

**Interfaces:**
- Produces:
  - `track(inflight: Map<string, AbortController>, chatId: string): AbortController` — aborts any existing controller for `chatId`, registers and returns a fresh one.
  - `untrack(inflight: Map<string, AbortController>, chatId: string, ctrl: AbortController): void` — deletes the map entry only if it is still `ctrl` (guards against a late-resolving aborted stream's cleanup deleting a newer stream's live entry).

- [ ] **Step 1: Write the failing test**

Create `nexra/test/inflight.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { track, untrack } from '../electron/services/inflight'

describe('inflight — overlapping-stream guard', () => {
  it('aborts the previous controller when a new stream starts for the same chat', () => {
    const inflight = new Map<string, AbortController>()
    const ctrlA = track(inflight, 'c1')
    expect(ctrlA.signal.aborted).toBe(false)
    const ctrlB = track(inflight, 'c1')
    expect(ctrlA.signal.aborted).toBe(true)     // old stream cancelled
    expect(ctrlB.signal.aborted).toBe(false)    // new stream is live
    expect(inflight.get('c1')).toBe(ctrlB)
  })

  it('does not abort or interfere with a different chat', () => {
    const inflight = new Map<string, AbortController>()
    const ctrlA = track(inflight, 'c1')
    const ctrlOther = track(inflight, 'c2')
    expect(ctrlA.signal.aborted).toBe(false)
    expect(ctrlOther.signal.aborted).toBe(false)
  })

  it('untrack only removes the map entry if it still belongs to the caller (stale cleanup guard)', () => {
    const inflight = new Map<string, AbortController>()
    const ctrlA = track(inflight, 'c1')
    const ctrlB = track(inflight, 'c1')   // supersedes A; inflight.get('c1') === ctrlB
    untrack(inflight, 'c1', ctrlA)        // A's own (late) cleanup — must NOT remove B's entry
    expect(inflight.get('c1')).toBe(ctrlB)
    untrack(inflight, 'c1', ctrlB)        // B's own cleanup — removes it
    expect(inflight.get('c1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/inflight.test.ts`
Expected: FAIL — `../electron/services/inflight` does not exist.

- [ ] **Step 3: Implement**

Create `nexra/electron/services/inflight.ts`:

```ts
// Tracks at most one in-flight AbortController per chat. A second `track()` for
// the same chatId aborts the previous stream before registering the new one —
// this is the guard against overlapping agent streams on one chat (previously
// missing; see docs/superpowers/HANDOVER.md's "No guard against overlapping
// agent streams on one chat" gap). Without it, two concurrent streams for the
// same chat both append into the same trailing message and their tokens
// interleave into garbled, duplicated text.
export function track(inflight: Map<string, AbortController>, chatId: string): AbortController {
  inflight.get(chatId)?.abort()
  const ctrl = new AbortController()
  inflight.set(chatId, ctrl)
  return ctrl
}

// Only deletes if the map's CURRENT entry is still this caller's own controller
// — an aborted stream's cleanup can resolve AFTER a newer stream has already
// registered its own controller for the same chatId, and must not clobber it.
export function untrack(inflight: Map<string, AbortController>, chatId: string, ctrl: AbortController): void {
  if (inflight.get(chatId) === ctrl) inflight.delete(chatId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nexra && npx vitest run test/inflight.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into `main.ts`**

In `main.ts`, add the import (near line 9, alongside the other service imports):

```ts
import { track, untrack } from './services/inflight'
```

Replace the `agent:send` handler (currently around line 68-76):

```ts
  ipcMain.handle('agent:send', async (ev, req) => {
    const ctrl = track(inflight, req.chatId)
    try {
      await runSend(req, loadConfig(), e => ev.sender.send('agent:event:' + req.chatId, e), ctrl.signal, req.companyId, req.engagementId)
    } finally {
      untrack(inflight, req.chatId, ctrl)
    }
  })
```

(The `const inflight = new Map<string, AbortController>()` declaration above this handler stays unchanged — only the body of the handler changes.)

- [ ] **Step 6: Verify no regressions**

Run: `cd nexra && npx tsc --noEmit 2>&1 | grep -v "ContextPanel.tsx\|SecretModal.tsx\|SecretsPanel.tsx\|RequestCard.tsx"`
Expected: no output (no new errors beyond the pre-existing baseline in those three files — note Task 1 already removed the `companyId` error from `ContextPanel.tsx`, so re-check that file's remaining errors are only the unrelated `bg2` one at line 65).

- [ ] **Step 7: Commit**

```bash
git add nexra/electron/services/inflight.ts nexra/electron/main.ts nexra/test/inflight.test.ts
git commit -m "fix(m3d): guard against overlapping agent streams on one chat"
```

---

## Task 3: Fix the typing indicator for non-text trailing messages

**Files:**
- Modify: `nexra/src/components/MessageList.tsx:46` (the `showTyping` line)
- Test: `nexra/test/MessageList.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `showTyping` now also covers "streaming, and the trailing message is a request card or tool card" (i.e. anything other than in-progress assistant prose), not just "trailing message is from the user".

- [ ] **Step 1: Write the failing test**

Append to `nexra/test/MessageList.test.tsx`, inside the existing `describe('MessageList', ...)` block (after the `'hides the typing indicator once an assistant message has started'` test):

```tsx
  it('shows the typing indicator while streaming and the last message is a request card (e.g. resuming after Continue)', () => {
    const chat = {
      ...baseChat,
      messages: [{ id: 'r1', role: 'assistant', kind: 'request', requestKind: 'inputs', requestId: 'req1', items: [] }],
    } as unknown as Chat
    render(<MessageList chat={chat} streaming />)
    expect(screen.getByRole('status', { name: /responding/i })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/MessageList.test.tsx -t "request card"`
Expected: FAIL — `showTyping` is `false` because `lastMessage.role === 'assistant'`, not `'user'`.

- [ ] **Step 3: Fix the condition**

In `MessageList.tsx`, replace line 46:

```tsx
  const showTyping = streaming && lastMessage?.role === 'user'
```

with:

```tsx
  // Show the indicator whenever a stream is active and the trailing message
  // isn't yet in-progress assistant prose — covers the normal user-message
  // case AND resuming after a request card (which posts no user bubble), so
  // the operator sees SOMETHING is happening rather than a dead chat.
  const showTyping = streaming && !(lastMessage?.role === 'assistant' && lastMessage?.kind === 'text')
```

- [ ] **Step 4: Run tests to verify pass, including the pre-existing ones**

Run: `cd nexra && npx vitest run test/MessageList.test.tsx`
Expected: PASS (all existing tests plus the new one — verify specifically that "hides the typing indicator once an assistant message has started" and "hides the typing indicator when not streaming" still pass, since the new condition must not regress those).

- [ ] **Step 5: Commit**

```bash
git add nexra/src/components/MessageList.tsx nexra/test/MessageList.test.tsx
git commit -m "fix(m3d): show typing indicator when resuming (no user bubble is posted)"
```

---

## Task 4: Friendly skill-call labels instead of raw `SKILL_CALL[...]` syntax

**Files:**
- Create: `nexra/src/lib/friendlySkillCalls.ts`
- Modify: `nexra/src/components/MessageList.tsx:7,59` (import + apply at render)
- Test: `nexra/test/friendlySkillCalls.test.ts`

**Interfaces:**
- Produces: `friendlySkillCalls(text: string): string` — replaces every complete `SKILL_CALL[name|...]` substring with `→ <friendly label>`; text without any skill call passes through unchanged.
- Consumes: nothing new. Applied only at render time — stored message `content` is never mutated, so nothing downstream (parsing, persistence) is affected.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/friendlySkillCalls.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { friendlySkillCalls } from '../src/lib/friendlySkillCalls'

describe('friendlySkillCalls', () => {
  it('replaces a known skill call with its friendly label', () => {
    const input = 'Please provide the Account IDs and Regions. SKILL_CALL[request_inputs|items=AWS_ACCOUNT_ID:Account ID:s:r]'
    expect(friendlySkillCalls(input)).toBe('Please provide the Account IDs and Regions. → Requesting inputs')
  })

  it('replaces multiple calls in the same message', () => {
    const input = 'SKILL_CALL[log_finding|title=X|sev=High] then SKILL_CALL[attach_evidence|finding=f1|tool_output=t1]'
    expect(friendlySkillCalls(input)).toBe('→ Logging finding then → Attaching evidence')
  })

  it('falls back to a humanized name for an unmapped skill', () => {
    expect(friendlySkillCalls('SKILL_CALL[some_new_skill|arg=1]')).toBe('→ some new skill')
  })

  it('leaves text with no skill call unchanged', () => {
    expect(friendlySkillCalls('Just a normal reply, no calls here.')).toBe('Just a normal reply, no calls here.')
  })

  it('does not touch an incomplete (still-streaming) call missing its closing bracket', () => {
    const input = 'Working on it. SKILL_CALL[request_inp'
    expect(friendlySkillCalls(input)).toBe(input)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/friendlySkillCalls.test.ts`
Expected: FAIL — `../src/lib/friendlySkillCalls` does not exist.

- [ ] **Step 3: Implement**

Create `nexra/src/lib/friendlySkillCalls.ts`:

```ts
// Skill names the agent can invoke, mirrored from the SKILL_CALL grammar
// documented in electron/services/agent.live.ts's systemPrompt(). Keep this
// map in sync if a new skill is added there.
const SKILL_LABELS: Record<string, string> = {
  request_inputs: 'Requesting inputs',
  run_prowler: 'Running Prowler scan',
  run_scoutsuite: 'Running ScoutSuite scan',
  run_pmapper: 'Running PMapper',
  probe: 'Running test probe',
  log_finding: 'Logging finding',
  attach_evidence: 'Attaching evidence',
}

// Matches a COMPLETE SKILL_CALL[...] occurrence only — an in-progress call
// still streaming in (no closing bracket yet) is deliberately left alone and
// briefly shows its raw form until the bracket arrives, rather than flickering
// a label on partial text.
const SKILL_CALL_RE = /SKILL_CALL\[([a-z_]+)\|[^\]]*\]/g

// Renders the model's control syntax as a short human label instead of the raw
// SKILL_CALL[...] grammar. Render-time only — never mutates stored message
// content, so parsing/persistence upstream is unaffected.
export function friendlySkillCalls(text: string): string {
  return text.replace(SKILL_CALL_RE, (_match, name: string) => {
    const label = SKILL_LABELS[name] ?? name.replace(/_/g, ' ')
    return `→ ${label}`
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nexra && npx vitest run test/friendlySkillCalls.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire it into MessageList.tsx**

In `MessageList.tsx`, add the import (near the top, alongside the other component imports):

```tsx
import { friendlySkillCalls } from '../lib/friendlySkillCalls'
```

Update the assistant-text render (around line 59):

```tsx
                  <MarkdownMessage content={friendlySkillCalls(m.content ?? '')} />
```

- [ ] **Step 6: Run the full MessageList + friendlySkillCalls suites**

Run: `cd nexra && npx vitest run test/MessageList.test.tsx test/friendlySkillCalls.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nexra/src/lib/friendlySkillCalls.ts nexra/src/components/MessageList.tsx nexra/test/friendlySkillCalls.test.ts
git commit -m "feat(m3d): render SKILL_CALL syntax as a friendly label instead of raw text"
```

---

## Task 5: Manual "Continue" button replacing auto-resume

**Files:**
- Modify: `nexra/src/components/RequestCard.tsx:1,15-73,111-170` (`inputs` and `scope` branches)
- Test: `nexra/test/RequestCard.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: neither branch calls `onFulfill()` automatically anymore. Each renders its own "Continue" button: disabled until the branch's own save condition is met (all required inputs filled / scope successfully set), and guarded by a `useRef` so a rapid double-click cannot call `onFulfill()` twice.

- [ ] **Step 1: Update the existing test that asserted auto-resume**

In `nexra/test/RequestCard.test.tsx`, replace the test named `'calls onFulfill once all REQUIRED items are saved (optionals may stay blank)'` (lines 31-39) with:

```tsx
it('does NOT auto-continue once required items are saved — shows an enabled Continue button instead', async () => {
  const onFulfill = vi.fn()
  render(<RequestCard message={msg} companyId="co1" onFulfill={onFulfill} />)
  const input = screen.getByLabelText('AWS access key')       // the only required item
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  await Promise.resolve(); await Promise.resolve()
  expect(onFulfill).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
})

it('Continue is disabled until all required fields are filled (optional REGION may stay blank)', () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

it('clicking Continue calls onFulfill exactly once even on a rapid double-click', async () => {
  const onFulfill = vi.fn()
  render(<RequestCard message={msg} companyId="co1" onFulfill={onFulfill} />)
  const input = screen.getByLabelText('AWS access key')
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  await Promise.resolve(); await Promise.resolve()
  const continueBtn = screen.getByRole('button', { name: 'Continue' })
  fireEvent.click(continueBtn)
  fireEvent.click(continueBtn)
  expect(onFulfill).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd nexra && npx vitest run test/RequestCard.test.tsx`
Expected: FAIL — there is no "Continue" button yet, and the old auto-resume test's replacement expects `onFulfill` NOT to have been called (it currently IS called automatically).

- [ ] **Step 3: Update imports**

In `RequestCard.tsx`, change line 1:

```tsx
import { useState, useRef } from 'react'
```

- [ ] **Step 4: Rewrite the `inputs` branch**

Replace the entire `if (message.requestKind === 'inputs') { ... }` block (lines 15-73) with:

```tsx
  if (message.requestKind === 'inputs') {
    const items = (message.items ?? []) as InputRequestItem[]
    const [values, setValues] = useState<Record<string, string>>({})
    const [sens, setSens] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map(i => [i.key, i.sensitive])))
    const [saved, setSaved] = useState<Record<string, boolean>>({})
    const [continued, setContinued] = useState(false)
    const continuedRef = useRef(false)
    const [err, setErr] = useState('')

    const requiredKeys = items.filter(i => i.required).map(i => i.key)
    const filledCount = requiredKeys.filter(k => saved[k]).length
    const allRequiredFilled = filledCount === requiredKeys.length

    const save = async (key: string) => {
      const value = values[key]
      if (!value) return
      try {
        const res = await window.nexra.inputs.fulfill(companyId!, key, value, sens[key])
        if (res && res.success === false) { setErr(res.error || 'Save failed'); return }
        setSaved(prev => ({ ...prev, [key]: true }))
      } catch (e) { setErr((e as Error).message) }
    }

    // Ref-based guard: a rapid double-click fires both handlers before the
    // first render (which would set `continued`/disable the button) commits,
    // so a plain useState check alone is not reliable here.
    const handleContinue = () => {
      if (continuedRef.current) return
      continuedRef.current = true
      setContinued(true)
      onFulfill()
    }

    return (
      <div style={{ background: theme.card2, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Inputs requested</div>
        {err && <div style={{ color: '#e5566a', fontSize: '12px', marginBottom: '8px' }}>{err}</div>}
        {items.map(it => (
          <div key={it.key} style={{ marginBottom: '10px' }}>
            <label htmlFor={`inp-${it.key}`} style={{ display: 'block', fontSize: '12px', color: theme.muted, marginBottom: '4px' }}>
              {it.label}{it.required ? ' *' : ''}
            </label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                id={`inp-${it.key}`} aria-label={it.label}
                type={sens[it.key] ? 'password' : 'text'}
                value={values[it.key] || ''}
                onChange={e => setValues({ ...values, [it.key]: e.target.value })}
                onBlur={() => save(it.key)}
                placeholder="Enter value"
                style={{ flex: 1, padding: '6px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }}
              />
              <button
                type="button"
                onClick={() => setSens({ ...sens, [it.key]: !sens[it.key] })}
                style={{ padding: '6px 8px', background: theme.border, color: theme.text, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}
              >
                {sens[it.key] ? 'not a secret' : 'mark secret'}
              </button>
              {saved[it.key] && <span style={{ color: theme.accent, fontSize: '12px' }}>saved</span>}
            </div>
          </div>
        ))}
        <div style={{ fontSize: '12px', color: theme.muted, marginTop: '4px', marginBottom: '8px' }}>
          {filledCount} of {requiredKeys.length} required filled
        </div>
        <button
          type="button"
          onClick={handleContinue}
          disabled={!allRequiredFilled || continued}
          style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: allRequiredFilled && !continued ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: allRequiredFilled && !continued ? 1 : 0.5 }}
        >
          {continued ? 'Continuing…' : 'Continue'}
        </button>
      </div>
    )
  }
```

- [ ] **Step 5: Run the inputs-branch tests**

Run: `cd nexra && npx vitest run test/RequestCard.test.tsx`
Expected: the 3 new/updated tests plus the 3 unmodified tests from before (masked/plain rendering, auto-save-on-blur, sensitivity toggle) all PASS — 6 total.

- [ ] **Step 6: Rewrite the `scope` branch**

Replace the entire `if (message.requestKind === 'scope') { ... }` block (now around lines 111-170 in the file as it stood before this task) with:

```tsx
  if (message.requestKind === 'scope') {
    const [mode, setMode] = useState<'all' | 'allowlist'>('all')
    const [accounts, setAccounts] = useState<string[]>([])
    const [regions, setRegions] = useState<string[]>([])
    const [accountInput, setAccountInput] = useState('')
    const [regionInput, setRegionInput] = useState('')
    const [scopeSaved, setScopeSaved] = useState(false)
    const [continued, setContinued] = useState(false)
    const continuedRef = useRef(false)

    const handleSetScope = async () => {
      const scope: EngagementScope = { mode, accounts, regions }
      setLoading(true)
      try {
        const engagementId = (message as any).engagementId
        if (!engagementId) throw new Error('No engagement ID')
        await window.nexra.scope.setAndValidate(engagementId, scope)
        setScopeSaved(true)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    const handleContinue = () => {
      if (continuedRef.current) return
      continuedRef.current = true
      setContinued(true)
      onFulfill()
    }

    return (
      <div style={{ background: theme.bg2, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Scope Required</div>
        {error && <div style={{ color: theme.error, fontSize: '12px', marginBottom: '8px' }}>{error}</div>}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> All (no restrictions)
          </label>
          <label style={{ display: 'block', fontSize: '12px' }}>
            <input type="radio" checked={mode === 'allowlist'} onChange={() => setMode('allowlist')} /> Allowlist
          </label>
        </div>
        {mode === 'allowlist' && (
          <>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: theme.text3, marginBottom: '4px' }}>AWS Accounts</label>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                <input type="text" value={accountInput} onChange={e => setAccountInput(e.target.value)} placeholder="111111111111" style={{ flex: 1, padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text1, fontSize: '12px' }} />
                <button onClick={() => { if (accountInput) { setAccounts([...accounts, accountInput]); setAccountInput('') } }} style={{ padding: '6px 8px', background: theme.border, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Add</button>
              </div>
              <div>{accounts.map(a => <div key={a} style={{ fontSize: '12px', background: theme.bg, padding: '4px', borderRadius: '3px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>{a} <button onClick={() => setAccounts(accounts.filter(x => x !== a))} style={{ background: 'none', border: 'none', color: theme.error, cursor: 'pointer' }}>×</button></div>)}</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: theme.text3, marginBottom: '4px' }}>Regions</label>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                <input type="text" value={regionInput} onChange={e => setRegionInput(e.target.value)} placeholder="us-east-1" style={{ flex: 1, padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text1, fontSize: '12px' }} />
                <button onClick={() => { if (regionInput) { setRegions([...regions, regionInput]); setRegionInput('') } }} style={{ padding: '6px 8px', background: theme.border, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Add</button>
              </div>
              <div>{regions.map(r => <div key={r} style={{ fontSize: '12px', background: theme.bg, padding: '4px', borderRadius: '3px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>{r} <button onClick={() => setRegions(regions.filter(x => x !== r))} style={{ background: 'none', border: 'none', color: theme.error, cursor: 'pointer' }}>×</button></div>)}</div>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button onClick={handleSetScope} disabled={loading || scopeSaved} style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
            {scopeSaved ? 'Scope set' : loading ? 'Setting...' : 'Set Scope'}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!scopeSaved || continued}
            style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: scopeSaved && !continued ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: scopeSaved && !continued ? 1 : 0.5 }}
          >
            {continued ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </div>
    )
  }
```

- [ ] **Step 7: Add scope-branch tests**

Append to `nexra/test/RequestCard.test.tsx`:

```tsx
it('scope: Continue is disabled until Set Scope succeeds, then enabled', async () => {
  ;(window as any).nexra = { ...(window as any).nexra, scope: { setAndValidate: vi.fn(() => Promise.resolve({ success: true })) } }
  const scopeMsg = { id: 'm2', role: 'assistant', kind: 'request', requestKind: 'scope', engagementId: 'e1' }
  render(<RequestCard message={scopeMsg} companyId="co1" onFulfill={() => {}} />)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Set Scope' }))
  await screen.findByRole('button', { name: 'Scope set' })
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
})

it('scope: clicking Continue calls onFulfill exactly once, not automatically on Set Scope', async () => {
  ;(window as any).nexra = { ...(window as any).nexra, scope: { setAndValidate: vi.fn(() => Promise.resolve({ success: true })) } }
  const onFulfill = vi.fn()
  const scopeMsg = { id: 'm2', role: 'assistant', kind: 'request', requestKind: 'scope', engagementId: 'e1' }
  render(<RequestCard message={scopeMsg} companyId="co1" onFulfill={onFulfill} />)
  fireEvent.click(screen.getByRole('button', { name: 'Set Scope' }))
  await screen.findByRole('button', { name: 'Scope set' })
  expect(onFulfill).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onFulfill).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 8: Run the full RequestCard suite**

Run: `cd nexra && npx vitest run test/RequestCard.test.tsx`
Expected: PASS — 8 tests total (3 unmodified + 3 from Step 1 + 2 from Step 7).

- [ ] **Step 9: Full regression pass**

Run: `cd nexra && npm test`
Expected: all tests PASS (baseline 173 + this plan's additions: 1 ContextPanel + 3 inflight + 1 MessageList + 5 friendlySkillCalls + 5 net-new RequestCard = 188).

Run: `cd nexra && npx tsc --noEmit 2>&1 | grep -v "ContextPanel.tsx\|SecretModal.tsx\|SecretsPanel.tsx\|RequestCard.tsx"`
Expected: no output beyond the pre-existing baseline (note: after Task 1, `ContextPanel.tsx`'s only remaining error should be the unrelated `bg2` one at line 65 — still filtered out here since it's out of scope).

- [ ] **Step 10: Commit**

```bash
git add nexra/src/components/RequestCard.tsx nexra/test/RequestCard.test.tsx
git commit -m "feat(m3d): replace auto-resume with a manual Continue button"
```

---

## Manual smoke test (once a display + provider key are available)

Ask the agent to run a CIS review requiring both an input card and a scope card; confirm: (1) filling a chat card's secret shows up in the Secrets side panel under the same company; (2) the typing indicator appears the moment Continue is clicked, before any new text arrives; (3) the chat shows "→ Requesting inputs" etc. instead of raw `SKILL_CALL[...]`; (4) resuming produces clean, non-garbled text with no duplication; (5) Continue only fires the resume once even if double-clicked.

## Spec coverage check

- Secrets panel not reflecting chat-filled creds → Task 1.
- No loading feedback after filling inputs / Set Scope → Task 3 (indicator) + Task 5 (button click is the moment `streaming` flips true).
- Raw `SKILL_CALL[...]` visible → Task 4.
- Garbled/tripled interleaved text → Task 2 (root cause: overlapping streams) + Task 5 (removes the auto-resume race that was the most likely trigger).
- Switch to manual Continue button (explicit user decision) → Task 5.
