# Chat Markdown Rendering + Typing Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant chat messages as styled markdown, and show a typing indicator in the assistant's row from the moment the user sends a message until the first token (or tool call) arrives.

**Architecture:** Two independent, additive renderer-side changes in `nexra/src/components/`: a new `MarkdownMessage` component (wraps `react-markdown` with theme-styled element renderers) swapped in for the assistant-text branch of `MessageList`, and a new `TypingIndicator` component conditionally rendered by `MessageList` off a new `streaming` prop threaded down from `ChatPane`'s existing `state.ui.streamingChats` lookup. No reducer, IPC, or transport changes.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Vitest + @testing-library/react (jsdom). New dependencies: `react-markdown` (^10.1.0), `remark-gfm` (^4.0.1), `remark-breaks` (^4.0.0).

## Global Constraints

- Styling convention: every element is styled via inline `style={}` objects keyed off `src/theme.ts` — no CSS files/classes are introduced (per `CLAUDE.md`: match the design system, and per the spec: keep the existing all-inline-styles convention intact).
- No syntax highlighting in code blocks — plain monospace, matching `ToolCard`'s existing uncolored `pre`/output styling exactly (`#0c0d10` background, `'IBM Plex Mono',monospace`, border `1px solid rgba(255,255,255,0.09)`, `borderRadius: 10`).
- Markdown rendering applies to assistant text messages only; user messages keep their current plain-text `pre-wrap` rendering, untouched.
- No new `@keyframes` — reuse the existing `pulse` keyframe already defined in `nexra/index.html` (also used by `ToolCard`'s "Running" label).
- No new reducer actions/state — the typing indicator's visibility is fully derived from existing `chat.messages` + `state.ui.streamingChats`.
- Tests live in the top-level `nexra/test/` directory (not colocated with source), following the existing convention (see `test/ToolCard.test.tsx`, `test/ipc.test.ts`).
- Run all commands from `nexra/` (the app subdirectory), e.g. `cd nexra && npm test`.

---

### Task 1: Add markdown dependencies and build `MarkdownMessage`

**Files:**
- Modify: `nexra/package.json` (via `npm install`)
- Create: `nexra/src/components/MarkdownMessage.tsx`
- Test: `nexra/test/MarkdownMessage.test.tsx`

**Interfaces:**
- Produces: `export function MarkdownMessage({ content }: { content: string }): JSX.Element` — later tasks (Task 2) import this from `../src/components/MarkdownMessage`.

- [ ] **Step 1: Install the markdown dependencies**

```bash
cd nexra && npm install react-markdown@^10.1.0 remark-gfm@^4.0.1 remark-breaks@^4.0.0
```

Expected: `package.json`'s `dependencies` gains `react-markdown`, `remark-gfm`, `remark-breaks`; `package-lock.json` updates; install completes with no errors.

- [ ] **Step 2: Write the failing test**

Create `nexra/test/MarkdownMessage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownMessage } from '../src/components/MarkdownMessage'

describe('MarkdownMessage', () => {
  it('renders bold and italic text', () => {
    render(<MarkdownMessage content="**bold** and _italic_" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
  })

  it('renders a bullet list', () => {
    render(<MarkdownMessage content={'- one\n- two'} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders inline code as a code element', () => {
    render(<MarkdownMessage content="use `npm install`" />)
    expect(screen.getByText('npm install').tagName).toBe('CODE')
  })

  it('renders a fenced code block inside a pre element', () => {
    render(<MarkdownMessage content={'```\nconst x = 1\n```'} />)
    expect(screen.getByText('const x = 1').closest('pre')).not.toBeNull()
  })

  it('renders a link that opens in a new tab', () => {
    render(<MarkdownMessage content="[docs](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('breaks single newlines into separate lines', () => {
    const { container } = render(<MarkdownMessage content={'line one\nline two'} />)
    expect(container.querySelector('br')).not.toBeNull()
  })

  it('renders a GFM table', () => {
    render(<MarkdownMessage content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('A').tagName).toBe('TH')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd nexra && npx vitest run test/MarkdownMessage.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/components/MarkdownMessage"` (file does not exist yet).

- [ ] **Step 4: Write the implementation**

Create `nexra/src/components/MarkdownMessage.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { theme } from '../theme'

const blockSpacing = { margin: '0 0 10px' } as const
const bodyText = { fontSize: 14, lineHeight: 1.65, color: theme.textDim } as const
const headingBase = { color: theme.text, fontWeight: 600, margin: '14px 0 6px' } as const

function isBlockCode(children: unknown): boolean {
  return /\n/.test(String(children))
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        p: ({ children }) => <p style={{ ...bodyText, ...blockSpacing }}>{children}</p>,
        strong: ({ children }) => <strong style={{ color: theme.text, fontWeight: 600 }}>{children}</strong>,
        em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" style={{ color: theme.accentSoft, textDecoration: 'underline' }}>
            {children}
          </a>
        ),
        ul: ({ children }) => <ul style={{ paddingLeft: 22, ...blockSpacing }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ paddingLeft: 22, ...blockSpacing }}>{children}</ol>,
        li: ({ children }) => <li style={{ ...bodyText, marginBottom: 4 }}>{children}</li>,
        code: ({ className, children }) =>
          isBlockCode(children) ? (
            <code className={className} style={{ fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.55, color: '#c9cdd4' }}>
              {children}
            </code>
          ) : (
            <code style={{ background: theme.card2, padding: '1px 5px', borderRadius: 4, fontFamily: theme.mono, fontSize: 12.5, color: theme.textDim }}>
              {children}
            </code>
          ),
        pre: ({ children }) => (
          <pre
            style={{
              border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, background: '#0c0d10',
              padding: '11px 13px', overflow: 'auto', ...blockSpacing,
            }}
          >
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote style={{ borderLeft: `3px solid ${theme.border2}`, paddingLeft: 12, color: theme.muted, ...blockSpacing }}>
            {children}
          </blockquote>
        ),
        hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${theme.border}`, margin: '14px 0' }} />,
        table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, ...blockSpacing }}>{children}</table>,
        th: ({ children }) => (
          <th style={{ padding: '6px 10px', border: `1px solid ${theme.border}`, textAlign: 'left', color: theme.text, background: 'rgba(255,255,255,0.03)' }}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td style={{ padding: '6px 10px', border: `1px solid ${theme.border}`, textAlign: 'left', color: theme.textDim }}>{children}</td>
        ),
        h1: ({ children }) => <h1 style={{ ...headingBase, fontSize: 18 }}>{children}</h1>,
        h2: ({ children }) => <h2 style={{ ...headingBase, fontSize: 16 }}>{children}</h2>,
        h3: ({ children }) => <h3 style={{ ...headingBase, fontSize: 15 }}>{children}</h3>,
        h4: ({ children }) => <h4 style={{ ...headingBase, fontSize: 15 }}>{children}</h4>,
        h5: ({ children }) => <h5 style={{ ...headingBase, fontSize: 15 }}>{children}</h5>,
        h6: ({ children }) => <h6 style={{ ...headingBase, fontSize: 15 }}>{children}</h6>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd nexra && npx vitest run test/MarkdownMessage.test.tsx
```

Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck and full test suite**

```bash
cd nexra && npm run build && npm test
```

Expected: `tsc` and `vite build` succeed with no type errors; full test suite passes (previous count + 7 new).

- [ ] **Step 7: Commit**

```bash
git add nexra/package.json nexra/package-lock.json nexra/src/components/MarkdownMessage.tsx nexra/test/MarkdownMessage.test.tsx
git commit -m "feat(chat): add MarkdownMessage component for styled markdown rendering"
```

---

### Task 2: Integrate `MarkdownMessage` into `MessageList` for assistant text

**Files:**
- Modify: `nexra/src/components/MessageList.tsx:24-29` (assistant text branch)
- Test: `nexra/test/MessageList.test.tsx` (new file)

**Interfaces:**
- Consumes: `MarkdownMessage` from Task 1 (`export function MarkdownMessage({ content }: { content: string })`).
- Produces: no new exports; `MessageList`'s existing exported signature `MessageList({ chat, onInstall })` is unchanged in this task (the `streaming` prop is added in Task 4).

- [ ] **Step 1: Write the failing test**

Create `nexra/test/MessageList.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageList } from '../src/components/MessageList'
import type { Chat } from '../electron/services/store.types'

const baseChat = { id: 'c1', name: 'Chat', phaseId: '', color: '#000', tools: [], findings: [] } as unknown as Chat

describe('MessageList', () => {
  it('renders assistant markdown content with formatting', () => {
    const chat = { ...baseChat, messages: [{ id: 'a1', role: 'assistant', kind: 'text', content: 'Hello **world**' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    expect(screen.getByText('world').tagName).toBe('STRONG')
  })

  it('renders user content as plain text, not markdown', () => {
    const chat = { ...baseChat, messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'Hello **world**' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    expect(screen.getByText('Hello **world**')).toBeInTheDocument()
    expect(screen.queryByText('world')).not.toBeInTheDocument()
  })
})
```

Note: this test passes `streaming={false}` even though `MessageList` doesn't accept that prop yet — `vitest` transpiles TS via esbuild without type-checking, so the extra prop is silently ignored at runtime; the assertions are what actually fail (see Step 2). The prop will be added properly to the type signature in Step 3, and full type-checking happens later via `npm run build` (Step 6 of this task, and again in Task 4).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd nexra && npx vitest run test/MessageList.test.tsx
```

Expected: FAIL — `screen.getByText('world').tagName).toBe('STRONG')` throws "Unable to find an element with the text: world" because the assistant branch still renders raw `{m.content}` as one plain-text node ("Hello **world**"), not parsed markdown.

- [ ] **Step 3: Add the `streaming` prop and swap in `MarkdownMessage`**

In `nexra/src/components/MessageList.tsx`, add the import and prop, and replace the assistant text content:

```tsx
import { useEffect, useRef } from 'react'
import { theme } from '../theme'
import type { Chat, Message } from '../../electron/services/store.types'
import { ToolCard } from './ToolCard'
import { MarkdownMessage } from './MarkdownMessage'

export function MessageList({ chat, streaming, onInstall }: { chat: Chat; streaming: boolean; onInstall?: (msg: Message) => void }) {
```

Replace the assistant text branch (the block starting `{m.kind === 'text' && m.role === 'assistant' && (`):

```tsx
            {m.kind === 'text' && m.role === 'assistant' && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', width: 26, height: 26, borderRadius: 7, background: 'rgba(111,123,240,0.16)', color: '#9aa2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, marginTop: 1 }}>◆</span>
                <div style={{ maxWidth: 700, paddingTop: 3 }}>
                  <MarkdownMessage content={m.content ?? ''} />
                </div>
              </div>
            )}
```

(The user text branch directly below is unchanged — still raw `{m.content}` with `whiteSpace: 'pre-wrap'`.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd nexra && npx vitest run test/MessageList.test.tsx
```

Expected: PASS (2 tests). Note: this step will still show a TS prop-shape complaint from `ChatPane.tsx` (which calls `<MessageList chat={chat} onInstall={onInstall} />` without `streaming`) until Task 4 — that's expected and resolved there; it does not block `vitest run` on this single test file.

- [ ] **Step 5: Commit**

```bash
git add nexra/src/components/MessageList.tsx nexra/test/MessageList.test.tsx
git commit -m "feat(chat): render assistant messages as markdown"
```

---

### Task 3: Build `TypingIndicator`

**Files:**
- Create: `nexra/src/components/TypingIndicator.tsx`
- Test: `nexra/test/TypingIndicator.test.tsx`

**Interfaces:**
- Produces: `export function TypingIndicator(): JSX.Element` — Task 4 imports this from `../src/components/TypingIndicator` and renders it inside `MessageList`.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/TypingIndicator.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TypingIndicator } from '../src/components/TypingIndicator'

describe('TypingIndicator', () => {
  it('renders three pulsing dots inside a status region', () => {
    render(<TypingIndicator />)
    const status = screen.getByRole('status', { name: /responding/i })
    expect(status.children).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd nexra && npx vitest run test/TypingIndicator.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/components/TypingIndicator"`.

- [ ] **Step 3: Write the implementation**

Create `nexra/src/components/TypingIndicator.tsx`:

```tsx
const DOT_DELAYS = [0, 0.15, 0.3]

export function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span
        style={{
          flex: 'none', width: 26, height: 26, borderRadius: 7, background: 'rgba(111,123,240,0.16)',
          color: '#9aa2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
        }}
      >
        ◆
      </span>
      <div style={{ display: 'flex', gap: 4 }} role="status" aria-label="Assistant is responding">
        {DOT_DELAYS.map(delay => (
          <span
            key={delay}
            style={{
              width: 6, height: 6, borderRadius: '50%', background: '#9aa2f5',
              animation: `pulse 1.4s ease-in-out ${delay}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd nexra && npx vitest run test/TypingIndicator.test.tsx
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add nexra/src/components/TypingIndicator.tsx nexra/test/TypingIndicator.test.tsx
git commit -m "feat(chat): add TypingIndicator component"
```

---

### Task 4: Wire `streaming` through `ChatPane` and show the typing indicator

**Files:**
- Modify: `nexra/src/components/MessageList.tsx` (render `TypingIndicator`, extend scroll-effect deps)
- Modify: `nexra/src/components/ChatPane.tsx:96` (pass `streaming` prop)
- Modify: `nexra/test/MessageList.test.tsx` (add indicator-visibility tests)

**Interfaces:**
- Consumes: `TypingIndicator` from Task 3 (`export function TypingIndicator()`); `streaming` prop already added to `MessageList` in Task 2.
- Produces: `MessageList`'s full props type is now `{ chat: Chat; streaming: boolean; onInstall?: (msg: Message) => void }` — stable for any future callers.

- [ ] **Step 1: Write the failing tests**

Append to `nexra/test/MessageList.test.tsx` (inside the existing `describe('MessageList', ...)` block):

```tsx
  it('shows the typing indicator while streaming and the last message is the user\'s', () => {
    const chat = { ...baseChat, messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'hi' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming />)
    expect(screen.getByRole('status', { name: /responding/i })).toBeInTheDocument()
  })

  it('hides the typing indicator once an assistant message has started', () => {
    const chat = {
      ...baseChat,
      messages: [
        { id: 'u1', role: 'user', kind: 'text', content: 'hi' },
        { id: 'a1', role: 'assistant', kind: 'text', content: 'Hi there' },
      ],
    } as unknown as Chat
    render(<MessageList chat={chat} streaming />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hides the typing indicator when not streaming', () => {
    const chat = { ...baseChat, messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'hi' }] } as unknown as Chat
    render(<MessageList chat={chat} streaming={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd nexra && npx vitest run test/MessageList.test.tsx
```

Expected: FAIL on the first two new assertions (`getByRole('status', ...)` not found) — `MessageList` doesn't render `TypingIndicator` yet.

- [ ] **Step 3: Render `TypingIndicator` and extend the scroll effect**

Replace the full contents of `nexra/src/components/MessageList.tsx` with:

```tsx
import { useEffect, useRef } from 'react'
import { theme } from '../theme'
import type { Chat, Message } from '../../electron/services/store.types'
import { ToolCard } from './ToolCard'
import { MarkdownMessage } from './MarkdownMessage'
import { TypingIndicator } from './TypingIndicator'

export function MessageList({ chat, streaming, onInstall }: { chat: Chat; streaming: boolean; onInstall?: (msg: Message) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Read scroll layout after paint (matches the prototype's scrollChat), since messages
    // (including streamed tool cards) can change the content height right before this runs.
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [chat.messages, streaming])

  const lastMessage = chat.messages[chat.messages.length - 1]
  const showTyping = streaming && lastMessage?.role === 'user'

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '26px 20px 30px', background: theme.bg }}>
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {chat.messages.map(m => (
          <div key={m.id}>
            {m.kind === 'text' && m.role === 'assistant' && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', width: 26, height: 26, borderRadius: 7, background: 'rgba(111,123,240,0.16)', color: '#9aa2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, marginTop: 1 }}>◆</span>
                <div style={{ maxWidth: 700, paddingTop: 3 }}>
                  <MarkdownMessage content={m.content ?? ''} />
                </div>
              </div>
            )}
            {m.kind === 'text' && m.role === 'user' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: 560, background: theme.input, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '10px 14px', fontSize: 14, lineHeight: 1.55, color: theme.text, whiteSpace: 'pre-wrap' }}>{m.content}</div>
              </div>
            )}
            {m.kind === 'tool' && (
              <ToolCard
                running={m.state === 'running'}
                success={m.state === 'success'}
                unavailable={m.state === 'unavailable'}
                command={m.command}
                output={m.output}
                duration={m.duration}
                toolName={m.toolName}
                reason={m.reason}
                installCmd={m.installCmd}
                onInstall={onInstall ? () => onInstall(m) : undefined}
              />
            )}
          </div>
        ))}
        {showTyping && <TypingIndicator />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Pass `streaming` from `ChatPane`**

In `nexra/src/components/ChatPane.tsx`, update the `MessageList` call (currently line 96):

```tsx
      <MessageList chat={chat} streaming={!!state.ui.streamingChats[chat.id]} onInstall={onInstall} />
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd nexra && npx vitest run test/MessageList.test.tsx
```

Expected: PASS (5 tests total in this file).

- [ ] **Step 6: Full verification**

```bash
cd nexra && npm run build && npm test
```

Expected: `tsc` + `vite build` succeed with no type errors (in particular, no leftover "missing `streaming` prop" error from `ChatPane.tsx`); full test suite passes.

- [ ] **Step 7: Commit**

```bash
git add nexra/src/components/MessageList.tsx nexra/src/components/ChatPane.tsx nexra/test/MessageList.test.tsx
git commit -m "feat(chat): show a typing indicator until the assistant's reply starts"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 (markdown library choice, component, theme-matched styling, `MessageList` integration, streaming re-parse behavior) → Tasks 1–2. Part 2 (derive-from-existing-state typing indicator, component, wiring, scroll-effect dependency) → Tasks 3–4. Error handling and testing sections from the spec are covered by existing `appendError` behavior (no code change needed, verified by Task 2/4's assistant-branch tests rendering arbitrary text safely) and the test steps in each task.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable commands or complete code.
- **Type consistency:** `MessageList`'s prop type `{ chat: Chat; streaming: boolean; onInstall?: (msg: Message) => void }` is introduced in Task 2 and referenced identically in Task 4; `MarkdownMessage({ content: string })` and `TypingIndicator()` signatures match between their defining task and every later consumer.
