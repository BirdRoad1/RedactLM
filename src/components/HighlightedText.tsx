import { useState } from 'react'
import type { Issue } from '../api/types'
import { IssuePopup } from './IssuePopup'
import { groupIssues, segments, type IssueGroup } from './issues'

// Read-only text with problem spots highlighted; hover one for details
export function HighlightedText({ text, issues }: { text: string; issues: Issue[] }) {
  const [hover, setHover] = useState<{ group: IssueGroup; anchor: DOMRect } | null>(null)
  const groups = groupIssues(issues)

  return (
    <>
      {segments(text, groups).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <mark
            key={i}
            className={`issue-mark ${part.outcome}`}
            onMouseEnter={(e) => setHover({ group: part, anchor: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => setHover(null)}
          >
            {text.slice(part.start, part.end)}
          </mark>
        ),
      )}
      {hover && <IssuePopup group={hover.group} anchor={hover.anchor} />}
    </>
  )
}
