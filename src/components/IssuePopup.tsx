import { likelihood, outcomeLabel, type IssueGroup } from './issues'

// Explains one highlighted spot. Positioned next to `anchor` (a highlight's
// on-screen box), above it unless there's no room.
export function IssuePopup({ group, anchor }: { group: IssueGroup; anchor: DOMRect }) {
  const above = anchor.top > 240
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - 348)),
    ...(above ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
  }

  // one entry per kind of problem, most serious first
  const unique = [...new Map(group.issues.map((i) => [i.title, i])).values()]
    .sort((a, b) => Number(b.outcome === 'blocked') - Number(a.outcome === 'blocked'))
  // for attachments: which pages each kind of problem is on
  const pagesOf = (title: string) =>
    [...new Set(group.issues.filter((i) => i.title === title && i.page).map((i) => i.page!))].sort((a, b) => a - b)

  return (
    <div className="issue-popup" role="tooltip" style={style}>
      {unique.map((issue) => (
        <div key={issue.title} className="issue">
          <div className="issue-head">
            <strong>{issue.title}</strong>
            <span className={`pill ${issue.outcome}`}>{outcomeLabel(issue.outcome)}</span>
          </div>
          {pagesOf(issue.title).length > 0 && (
            <p className="small">{pagesOf(issue.title).length > 1 ? 'Pages' : 'Page'} {pagesOf(issue.title).join(', ')}</p>
          )}
          <p>{issue.explanation}</p>
          <p className="muted small">{likelihood(issue.confidence)} to be sensitive.</p>
        </div>
      ))}
    </div>
  )
}
