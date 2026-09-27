import { useEffect, useState } from 'react'
import { checkText } from '../api/check'
import type { Issue } from '../api/types'
import { shiftIssues } from '../components/issues'

const DELAY_MS = 400

// Issues in `text`, checked once typing pauses. While a new check is pending
// the last results stay up, moved along with each edit so they keep pointing
// at the same characters; they change only when the next answer arrives.
export function useLiveCheck(text: string) {
  const [shown, setShown] = useState<{ text: string; issues: Issue[] }>({ text, issues: [] })

  // follow each edit right away, during render, so a highlight never flickers
  // or lands on the wrong characters for a frame
  let current = shown
  if (shown.text !== text) {
    current = { text, issues: shiftIssues(shown.issues, shown.text, text) }
    setShown(current)
  }

  useEffect(() => {
    if (!text.trim()) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      checkText(text, abort.signal)
        // only if the text hasn't changed since (edits abort this anyway)
        .then((issues) => setShown((prev) => (prev.text === text ? { text, issues } : prev)))
        .catch(() => {
          // aborted by the next keystroke, or offline: sending re-checks anyway
        })
    }, DELAY_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [text])

  return current.issues
}
