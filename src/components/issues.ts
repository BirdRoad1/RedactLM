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
