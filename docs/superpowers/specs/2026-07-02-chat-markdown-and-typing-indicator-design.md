# Chat markdown rendering + typing indicator

## Problem

Assistant messages in `MessageList.tsx` render as raw text
(`whiteSpace: 'pre-wrap'`) — no bold, lists, links, or code blocks, even
though the live agent (`agent.live.ts`, `streamText`) can and does produce
markdown-formatted replies. Separately, there's a visible gap between the
user hitting send and the first token arriving (network + model latency)
during which nothing on screen indicates the assistant is working.

## Goals

- Render assistant text messages as formatted markdown, styled to match
  `theme.ts` and the existing `ToolCard` visual language.
- Show a loading indicator in the assistant's row as soon as the user sends
  a message, until the first response token (or tool call) arrives.

## Non-goals

- User messages continue to render as plain text (not markdown) — matches
  how most AI chat UIs treat the human side of the conversation.
- No syntax-highlighted code tokens — code blocks stay plain monospace,
  matching `ToolCard`'s existing uncolored output styling.
- No changes to `agent.live.ts` / streaming transport — this is purely a
  renderer-side change reacting to state that already exists
  (`streamingChats`, message list ordering).

## Part 1 — Markdown rendering

### Library choice

`react-markdown` + `remark-gfm` + `remark-breaks`, added as new
dependencies.

Rejected alternative: a `marked`/`markdown-it` + `dangerouslySetInnerHTML`
pipeline. This codebase styles everything through inline `style={}` objects
keyed off `theme.ts` (no CSS files besides the two `@keyframes` in
`index.html`). `react-markdown` lets each markdown element (`p`, `code`,
`ul`, `a`, …) be given a custom React component styled the same inline way,
keeping the convention intact and avoiding a raw-HTML-injection surface for
model-authored content.

`remark-gfm` adds tables, strikethrough, and task lists. `remark-breaks` is
necessary because plain CommonMark collapses a single newline into the same
paragraph — the current raw-text rendering treats every newline as a line
break (`pre-wrap`), and casual assistant replies use single newlines
between short lines without a blank line separator. Without this plugin,
today's line-break behavior would visibly regress.

### Component

New file `src/components/MarkdownMessage.tsx`:

```tsx
export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{...}}>
      {content}
    </ReactMarkdown>
  )
}
```

Custom `components` mapping, styled from `theme.ts`:

- `p`: `fontSize: 14, lineHeight: 1.65, color: theme.textDim, margin: '0 0 10px'`, last child margin 0 (via `:last-child` is not available inline — handled by wrapping all block children with uniform bottom margin and letting the outer container's normal flow absorb the last one; acceptable minor extra gap, no special-casing needed).
- `strong`: `color: theme.text, fontWeight: 600`.
- `em`: `fontStyle: italic`.
- `a`: `color: theme.accentSoft, textDecoration: 'underline'`, opens external links via `target="_blank" rel="noreferrer"`.
- `ul`/`ol`: `margin: '0 0 10px', paddingLeft: 22`; `li`: `marginBottom: 4`.
- `code` (inline, no parent `pre`): `background: theme.card2, padding: '1px 5px', borderRadius: 4, fontFamily: theme.mono, fontSize: 12.5, color: theme.textDim`.
- `pre` (fenced code block): reuses `ToolCard`'s success-block visual language — `border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, background: '#0c0d10', padding: '11px 13px', overflow: 'auto'`; inner text `fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.55, color: '#c9cdd4'`. No syntax highlighting, no header bar (unlike `ToolCard`, there's no command/duration to show).
- `blockquote`: `borderLeft: '3px solid ' + theme.border2, paddingLeft: 12, color: theme.muted, margin: '0 0 10px'`.
- `hr`: `border: 'none', borderTop: '1px solid ' + theme.border, margin: '14px 0'`.
- `table`/`th`/`td`: `borderCollapse: 'collapse', width: '100%', fontSize: 13`; cells `padding: '6px 10px', border: '1px solid ' + theme.border, textAlign: 'left'`; header cells additionally `color: theme.text, background: 'rgba(255,255,255,0.03)'`.
- `h1`/`h2`/`h3` (h4–6 map to h3 sizing — unlikely in chat replies but must not crash): `color: theme.text, fontWeight: 600, margin: '14px 0 6px'` at `18px`/`16px`/`15px` respectively.

### Integration point

`MessageList.tsx`, assistant text branch (currently line 27): replace
`{m.content}` with `<MarkdownMessage content={m.content} />`, and drop
`whiteSpace: 'pre-wrap'` from the wrapping div (markdown owns line breaks
now via `remark-breaks` + paragraph/list block spacing).

User text branch is untouched — stays raw text with `pre-wrap`.

### Streaming behavior

`text_delta` events append raw characters to the last assistant message's
`content` (`reducer.ts` `appendTextDelta`); `MarkdownMessage` re-parses the
full growing string on every render, same as ChatGPT/Claude web. A code
fence may render as an unclosed/partial block until its closing ` ``` `
arrives — accepted, standard tradeoff for streamed markdown.

## Part 2 — Typing indicator

### Existing state this relies on

- `sendMessage` (`ipc.ts`) dispatches `appendUserMessage` then
  `setStreaming(chatId, on: true)` before any network response exists.
- The first `text_delta` (or `tool_call`) event is what pushes the next
  message onto `chat.messages` (`reducer.ts`). Until then,
  `chat.messages[last]` is still the just-sent user message.
- `state.ui.streamingChats[chat.id]` is already tracked and read by
  `ChatPane` (passed to `Composer` as `busy`).

This means "is the assistant's reply still pending" is fully derivable from
existing state — no new reducer action or message-list entry needed.

### Component

New file `src/components/TypingIndicator.tsx`: renders the same row shape
as an assistant message (`◆` avatar in the `rgba(111,123,240,0.16)` chip,
`#9aa2f5` glyph — copied from `MessageList`'s assistant avatar span) with
three `<span>` dots in place of text, each animated with the existing
`pulse` keyframe (already defined in `index.html`, already used by
`ToolCard`'s "Running" label) and a staggered `animationDelay` (`0s`,
`0.15s`, `0.3s`) so they pulse in sequence rather than in unison. No new
`@keyframes` required.

### Wiring

- `MessageList` signature gains `streaming: boolean`.
- `ChatPane` passes `streaming={!!state.ui.streamingChats[chat.id]}` (it
  already computes this exact expression for `Composer`'s `busy` prop).
- At the bottom of the messages map in `MessageList`, after all
  `chat.messages` render: if `streaming && lastMessage?.role === 'user'`,
  render `<TypingIndicator />`.
- No condition needed for the tool-call case: if the agent's first event is
  a `tool_call` rather than `text_delta`, that pushes a `kind: 'tool'`
  message with `state: 'running'`, which changes `lastMessage.role` away
  from `'user'` — so the typing indicator's condition naturally stops
  applying, and `ToolCard`'s own "Running" spinner (already built) takes
  over as the loading affordance. No double-indicator.
- The indicator disappears the instant the first `text_delta` or
  `tool_call` lands, because that dispatch changes `lastMessage`, no
  separate cleanup dispatch needed.
- Scroll-to-bottom effect in `MessageList` already depends on
  `[chat.messages]`; add `streaming` to that dependency array so the view
  scrolls down when the indicator appears/disappears too.

## Error handling

- `appendError` (existing) already pushes an assistant `kind: 'text'`
  message on failure, which both clears the typing indicator's condition
  (`lastMessage.role` becomes `'assistant'`) and renders through
  `MarkdownMessage` like any other assistant text — harmless, since plain
  error text (e.g. `⚠ Request failed`) renders as an ordinary paragraph.
- `react-markdown` does not execute scripts or inject raw HTML by default
  (no `rehype-raw` plugin is added), so no new XSS surface from
  model-authored content.

## Testing

- Component test for `MarkdownMessage`: given representative markdown
  (bold/italic, a bullet list, an inline code span, a fenced code block, a
  link, a single-newline-separated pair of lines), assert the expected
  DOM structure/text renders (headings, `<code>`/`<pre>`, `<a href>`, and
  that the single-newline case produces two visually separate lines via
  the inserted `<br>`).
- Component test for `TypingIndicator`: renders three dot elements.
- `MessageList` test: given a chat whose last message is from the user and
  `streaming=true`, the typing indicator renders; given `streaming=false`
  or a last message from the assistant, it does not.
- Existing `MessageList`/`ChatPane` tests updated for the new `streaming`
  prop plumbing.
