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
