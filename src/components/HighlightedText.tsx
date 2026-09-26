import type { FlaggedDetection } from '../api/types'

// Renders text with flagged spans marked; overlapping spans are merged
export function HighlightedText({ text, spans, kind }: { text: string; spans: FlaggedDetection[]; kind: 'blocked' | 'warned' }) {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const parts = []
  let cursor = 0

  for (let i = 0; i < sorted.length; ) {
    const first = sorted[i]!
    let end = first.end
    const reasons = new Set([first.reason])
    while (++i < sorted.length && sorted[i]!.start < end) {
      end = Math.max(end, sorted[i]!.end)
      reasons.add(sorted[i]!.reason)
    }
    const start = Math.max(first.start, cursor)
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark key={start} className={kind} title={[...reasons].join('\n')}>
        {text.slice(start, end)}
      </mark>,
    )
    cursor = Math.max(cursor, end)
  }
  parts.push(text.slice(cursor))

  return <>{parts}</>
}
