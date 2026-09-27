import { useRef, useState, type TextareaHTMLAttributes } from 'react'
import type { Issue } from '../api/types'
import { IssuePopup } from './IssuePopup'
import { groupIssues, segments, type IssueGroup } from './issues'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
  value: string
  issues: Issue[]
}

// A textarea with rounded highlights drawn behind problem spots. The
// highlights live in a mirror layer with identical text layout underneath a
// transparent textarea; hovering is detected by hit-testing that layer, since
// the textarea itself sits on top and gets the mouse events.
export function CheckedTextarea({ value, issues, className, onScroll, ...props }: Props) {
  const mirror = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ group: IssueGroup; anchor: DOMRect } | null>(null)
  const groups = groupIssues(issues)

  function findHover(x: number, y: number) {
    const marks = mirror.current?.querySelectorAll<HTMLElement>('mark') ?? []
    for (const mark of marks) {
      for (const rect of mark.getClientRects()) {
        if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) {
          return { group: groups[Number(mark.dataset.group)]!, anchor: rect }
        }
      }
    }
    return null
  }

  return (
    <div
      className={`checked-input ${className ?? ''}`}
      onMouseMove={(e) => setHover(findHover(e.clientX, e.clientY))}
      onMouseLeave={() => setHover(null)}
    >
      <div ref={mirror} className="mirror" aria-hidden="true">
        {segments(value, groups).map((part, i) =>
          typeof part === 'string' ? (
            part
          ) : (
            <mark key={i} className={part.outcome} data-group={groups.indexOf(part)}>
              {value.slice(part.start, part.end)}
            </mark>
          ),
        )}
        {/* a trailing newline needs something after it to take up a line */}
        {value.endsWith('\n') && ' '}
      </div>
      <textarea
        {...props}
        value={value}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop
          setHover(null)
          onScroll?.(e)
        }}
      />
      {hover && <IssuePopup group={hover.group} anchor={hover.anchor} />}
    </div>
  )
}
