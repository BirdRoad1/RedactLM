import { NavLink } from 'react-router'
import type { ConversationSummary } from '../api/types'

// Today / Yesterday / Previous 7 days / Previous 30 days / Older
function bucket(date: Date, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  const t = date.getTime()
  if (t >= startOfToday) return 'Today'
  if (t >= startOfToday - day) return 'Yesterday'
  if (t >= startOfToday - 7 * day) return 'Previous 7 days'
  if (t >= startOfToday - 30 * day) return 'Previous 30 days'
  return 'Older'
}

type Props = {
  conversations: ConversationSummary[]
  onNew: () => void
  onDelete: (conversation: ConversationSummary) => void
}

export function ConversationList({ conversations, onNew, onDelete }: Props) {
  const groups = new Map<string, ConversationSummary[]>()
  for (const c of conversations) {
    const name = bucket(new Date(c.updatedAt))
    groups.set(name, [...(groups.get(name) ?? []), c])
  }

  return (
    <aside className="history">
      <button className="new-chat" onClick={onNew}>+ New chat</button>
      {!conversations.length && <p className="muted small">Your conversations will appear here.</p>}
      {[...groups].map(([name, items]) => (
        <div key={name}>
          <h3>{name}</h3>
          <ul>
            {items.map((c) => (
              <li key={c.id}>
                <NavLink to={`/c/${c.id}`} title={c.title}>
                  {c.title.replace(/\[REDACTED: ([^\]]+)\]/g, '[$1]')}
                </NavLink>
                <button className="delete" title="Delete conversation" aria-label="Delete conversation" onClick={() => onDelete(c)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  )
}
