import { valuesPattern } from '@redactlm/shared'
import type { Swaps } from './placeholders'

// Text as the AI received it: every occurrence of a swapped value becomes its
// placeholder, matched exactly the way the server matches
export function AiText({ text, swaps }: { text: string; swaps: Swaps }) {
  const placeholderOf = new Map([...swaps].map(([p, v]) => [v, p]))
  const pattern = valuesPattern(placeholderOf.keys())
  if (!pattern) return <>{text}</>

  const parts = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(cursor, match.index))
    parts.push(
      <mark key={match.index} className="placeholder" title={`Stands for "${match[0]}", which the AI never saw`}>
        {placeholderOf.get(match[0])}
      </mark>,
    )
    cursor = match.index + match[0].length
  }
  parts.push(text.slice(cursor))
  return <>{parts}</>
}

// A placeholder in an AI reply: the real value, or in "what the AI saw" the
// placeholder itself. Ones this page doesn't know (from history) stay as they are.
export function SwappedValue({ placeholder, swaps, aiView }: { placeholder: string; swaps: Swaps; aiView: boolean }) {
  const value = swaps.get(placeholder)
  if (value === undefined) {
    return <mark className="placeholder" title="Stands for something sensitive; the real value isn't kept">{placeholder}</mark>
  }
  return aiView ? (
    <mark className="placeholder" title={`Stands for "${value}", which the AI never saw`}>{placeholder}</mark>
  ) : (
    <mark className="restored" title={`Put back here: the AI saw ${placeholder} instead`}>{value}</mark>
  )
}
