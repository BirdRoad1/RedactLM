import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AuditEntry } from '../../api/types'

// What each kind of entry is called on this page
const EVENTS: Record<string, string> = {
  message_blocked: 'Message blocked',
  message_warned: 'Sent with warnings',
  message_replaced: 'Sent with placeholders',
  block_overridden: 'Block overridden',
  sent_unchecked: 'Sent unchecked',
  partially_checked: 'Partly checked',
  attachment_refused: 'Attachment refused',
  detector_unavailable: 'AI detector unavailable',
  conversation_deleted: 'Conversation deleted',
  conversation_reviewed: 'Conversation reviewed',
  settings_changed: 'Settings changed',
  backend_created: 'Backend added',
  backend_deleted: 'Backend deleted',
  user_created: 'User created',
  user_roles_changed: 'Roles changed',
  login_succeeded: 'Logged in',
  login_failed: 'Failed login',
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [event, setEvent] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<AuditEntry[]>(`/audit-log${event ? `?event=${event}` : ''}`)
      .then(setEntries)
      .catch((err) => setError(err.message))
  }, [event])

  return (
    <section>
      <h1>Audit log</h1>
      <p className="muted">The latest 200 entries. Entries never contain the checked text, passwords or API keys.</p>
      <label className="inline-filter">
        Show
        <select value={event} onChange={(e) => setEvent(e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(EVENTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {entries && (
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>Type</th><th>What happened</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.user ?? <span className="muted">{e.event.startsWith('login') || e.event === 'user_created' ? 'nobody logged in' : 'deleted user'}</span>}</td>
                <td className="nowrap"><span className={`event-tag ${e.event}`}>{EVENTS[e.event] ?? e.event}</span></td>
                <td>{e.summary}</td>
              </tr>
            ))}
            {!entries.length && <tr><td colSpan={4} className="muted">Nothing logged yet.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  )
}
