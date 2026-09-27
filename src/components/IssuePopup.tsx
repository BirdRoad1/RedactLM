import { likelihood, outcomeLabel, severity, type IssueGroup } from './issues'

// Explains one highlighted spot. Positioned next to `anchor` (a highlight's
// on-screen box), above it unless there's no room.
export function IssuePopup({ group, anchor, note }: { group: IssueGroup; anchor: DOMRect; note?: string }) {
  const above = anchor.top > 240
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - 348)),
    ...(above ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
  }

  // one entry per kind of problem, most serious first
  const unique = [...new Map(group.issues.map((i) => [i.title, i])).values()]
    .sort((a, b) => severity[b.outcome] - severity[a.outcome])
  // for attachments: which pages each kind of problem is on
  const pagesOf = (title: string) =>
    [...new Set(group.issues.filter((i) => i.title === title && i.page).map((i) => i.page!))].sort((a, b) => a - b)

  return (
    <div className="issue-popup" role="tooltip" style={style}>
      {unique.map((issue) => (
        <div key={issue.title} className="issue">
          <div className="issue-head">
            <strong>{issue.title}</strong>
            <span className={`pill ${issue.outcome}`}>{issue.placeholder ? 'Replaced' : outcomeLabel(issue.outcome)}</span>
          </div>
          {pagesOf(issue.title).length > 0 && (
            <p className="small">{pagesOf(issue.title).length > 1 ? 'Pages' : 'Page'} {pagesOf(issue.title).join(', ')}</p>
          )}
          {issue.explanation && <p>{issue.explanation}</p>}
          {issue.outcome === 'redacted' && (
            <p className="replaced-note">
              {issue.placeholder
                ? <>Sent as <code>{issue.placeholder}</code>, so the AI never saw it.</>
                : <>It will be swapped for a placeholder such as <code>redacted-3f9a1c0b7e2d</code> before sending, so the AI never sees it.</>}
            </p>
          )}
          {!issue.placeholder && <p className="muted small">{likelihood(issue.confidence)} to be sensitive.</p>}
        </div>
      ))}
      {note && <p className={`small ${unique.length ? 'issue-note' : ''}`}>{note}</p>}
    </div>
  )
}
