import { useState } from 'react'
import type { Attachment } from '../api/types'
import { IssuePopup } from './IssuePopup'

// A file on the draft: what it is, whether it's safe to send, and why not
export function AttachmentChip({ attachment: a, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const worst = a.issues.some((i) => i.outcome === 'blocked') ? 'blocked' : a.issues.length ? 'warned' : 'ok'
  const status =
    a.status === 'checking' ? 'Checking…'
    : a.status === 'error' ? "Can't be sent"
    : !a.issues.length ? 'No issues found'
    : worst === 'blocked' ? "Won't be sent"
    : 'Has warnings'

  return (
    <span
      className={`attachment ${a.status === 'error' ? 'blocked' : a.status === 'checked' ? worst : 'checking'}`}
      onMouseEnter={(e) => (a.issues.length || a.error) && setAnchor(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
    >
      <span className="attachment-name" title={a.filename}>{a.filename}</span>
      <span className="attachment-status">{status}</span>
      {onRemove && <button type="button" aria-label={`Remove ${a.filename}`} onClick={onRemove}>×</button>}
      {anchor && a.error && (
        <div className="issue-popup" role="tooltip" style={{ left: anchor.left, bottom: window.innerHeight - anchor.top + 8 }}>
          <p>{a.error}</p>
        </div>
      )}
      {anchor && !a.error && <IssuePopup group={{ start: 0, end: 0, issues: a.issues, outcome: worst === 'blocked' ? 'blocked' : 'warned' }} anchor={anchor} />}
    </span>
  )
}
