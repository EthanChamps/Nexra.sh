import type { Message } from '../../electron/services/store.types'

// m:ss — minutes uncapped, seconds zero-padded. Sub-second remainders floored.
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Last n lines of streamed output, so a long-running scan card shows the newest
// activity without growing unbounded. Drops one trailing newline first so a
// stream that ends in "\n" doesn't render a blank final line.
export function tailLines(output: string, n: number): string {
  if (output === '') return ''
  const trimmed = output.endsWith('\n') ? output.slice(0, -1) : output
  return trimmed.split('\n').slice(-n).join('\n')
}

// Contextual label for the working indicator, derived from the trailing message.
// Deliberately coarse (3 buckets) so it can't drift out of sync with reality —
// we only assert what the message list already proves.
export function workingLabel(messages: Message[]): string {
  const last = messages[messages.length - 1]
  if (last?.kind === 'tool' && last.state === 'success') return 'Reviewing scan output…'
  if (last?.kind === 'request') return 'Resuming…'
  return 'Working…'
}
