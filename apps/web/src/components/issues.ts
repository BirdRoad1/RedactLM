import type { Issue } from '../api/types'

export const severity: Record<Issue['outcome'], number> = { warned: 1, redacted: 2, blocked: 3 }

export const worst = (issues: Issue[]) =>
  issues.reduce<Issue['outcome'] | null>((w, i) => (!w || severity[i.outcome] > severity[w] ? i.outcome : w), null)

// Issues grouped by overlapping ranges, so each highlight is drawn once
export type IssueGroup = { start: number; end: number; issues: Issue[]; outcome: Issue['outcome'] }

export function groupIssues(issues: Issue[]): IssueGroup[] {
  const sorted = [...issues].sort((a, b) => a.start - b.start)
  const groups: IssueGroup[] = []
  for (const issue of sorted) {
    const last = groups[groups.length - 1]
    if (last && issue.start < last.end) {
      last.end = Math.max(last.end, issue.end)
      last.issues.push(issue)
      if (severity[issue.outcome] > severity[last.outcome]) last.outcome = issue.outcome
    } else {
      groups.push({ start: issue.start, end: issue.end, issues: [issue], outcome: issue.outcome })
    }
  }
  return groups
}

// Splits text into plain strings and highlighted groups, in order
export function segments(text: string, groups: IssueGroup[]) {
  const parts: (string | IssueGroup)[] = []
  let cursor = 0
  for (const group of groups) {
    if (group.start > cursor) parts.push(text.slice(cursor, group.start))
    parts.push(group)
    cursor = group.end
  }
  parts.push(text.slice(cursor))
  return parts
}

export function outcomeLabel(outcome: Issue['outcome']) {
  return outcome === 'blocked' ? "Won't be sent" : outcome === 'redacted' ? 'Will be replaced' : 'Warning'
}

export function likelihood(confidence: number) {
  if (confidence >= 0.9) return 'Almost certain'
  if (confidence >= 0.75) return 'Very likely'
  if (confidence >= 0.5) return 'Likely'
  return 'Possible'
}

// Moves issues found in `before` onto `after`, so highlights stay on the same
// characters while the text is being edited. The edit is whatever lies
// between the common start and common end of the two texts: issues before it
// stay put, ones after it shift by the change in length, and ones it touches
// stretch or shrink with it. Issues whose text was deleted entirely go.
export function shiftIssues(issues: Issue[], before: string, after: string): Issue[] {
  if (before === after || !issues.length) return issues
  let prefix = 0
  const shortest = Math.min(before.length, after.length)
  while (prefix < shortest && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < shortest - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++

  const oldEnd = before.length - suffix // the edit replaced before[prefix, oldEnd)
  const newEnd = after.length - suffix // with after[prefix, newEnd)
  const delta = after.length - before.length
  // Typing right against a highlight doesn't join it: a start at the edit
  // moves with what follows, an end at the edit stays with what precedes.
  // Anything inside the edit goes to the edge of what replaced it.
  const shift = (at: number) => at + delta

  return issues.flatMap((issue) => {
    const start = issue.start >= oldEnd ? shift(issue.start) : Math.min(issue.start, prefix)
    const end = issue.end <= prefix ? issue.end : issue.end >= oldEnd ? shift(issue.end) : newEnd
    return end > start ? [{ ...issue, start, end }] : []
  })
}
