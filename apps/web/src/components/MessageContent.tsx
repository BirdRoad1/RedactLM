import { PaperclipIcon } from './icons'

// Message text as stored, where sensitive parts were masked as
// "[REDACTED: Phone number]" and attachments noted as "[Attached: a.pdf]";
// both are shown as small labels
const MASK = /\[(REDACTED|Attached): ([^\]]+)\]/g

export function MessageContent({ text }: { text: string }) {
  const parts = []
  let cursor = 0
  for (const match of text.matchAll(MASK)) {
    parts.push(text.slice(cursor, match.index))
    parts.push(
      match[1] === 'Attached' ? (
        <span key={match.index} className="attachment-ref" title="Attachments aren't kept in history"><PaperclipIcon size={13} /> {match[2]}</span>
      ) : (
        <span key={match.index} className="masked" title="Removed before saving because it was sensitive">
          {match[2]} removed
        </span>
      ),
    )
    cursor = match.index + match[0].length
  }
  parts.push(text.slice(cursor))
  return <>{parts}</>
}
