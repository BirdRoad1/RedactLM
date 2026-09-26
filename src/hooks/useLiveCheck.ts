import { useEffect, useState } from 'react'
import { checkText } from '../api/check'
import type { Issue } from '../api/types'

const DELAY_MS = 400

// Issues in `text`, checked once typing pauses. Returns [] while the result
// is for an older version of the text, so highlights never point at the wrong
// characters.
export function useLiveCheck(text: string) {
  const [result, setResult] = useState<{ text: string; issues: Issue[] }>({ text: '', issues: [] })

  useEffect(() => {
    if (!text.trim()) return
    const abort = new AbortController()
    const timer = setTimeout(() => {
      checkText(text, abort.signal)
        .then((issues) => setResult({ text, issues }))
        .catch(() => {
          // aborted by the next keystroke, or offline: sending re-checks anyway
        })
    }, DELAY_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [text])

  return result.text === text ? result.issues : []
}
