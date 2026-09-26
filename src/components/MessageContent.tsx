// Message text as stored, where sensitive parts were masked as
// "[REDACTED: Phone number]"; those are shown as small labels
const MASK = /\[REDACTED: ([^\]]+)\]/g

export function MessageContent({ text }: { text: string }) {
  const parts = []
  let cursor = 0
  for (const match of text.matchAll(MASK)) {
    parts.push(text.slice(cursor, match.index))
    parts.push(
      <span key={match.index} className="masked" title="Removed before saving because it was sensitive">
        {match[1]} removed
      </span>,
    )
    cursor = match.index + match[0].length
  }
  parts.push(text.slice(cursor))
  return <>{parts}</>
}
