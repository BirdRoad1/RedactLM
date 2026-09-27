import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client'
import type { MessageAction, ReviewConversation, ReviewSummary } from '../../api/types'
import { MessageContent } from '../../components/MessageContent'

// How each stored message went, in words
const ACTIONS: Record<MessageAction, string> = {
  allowed: 'Sent',
  warned: 'Sent with warnings',
  redacted: 'Sent with placeholders',
  blocked: 'Blocked, not sent',
  overridden: 'Sent as written (overridden)',
  unchecked: 'Sent unchecked',
}

// Everyone's conversations, and one of them read-only when the URL names it
export function ReviewPage() {
  const { id } = useParams()
  return id ? <Transcript key={id} id={id} /> : <ConversationTable />
}

function ConversationTable() {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ReviewSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      api<ReviewSummary[]>(`/review/conversations${query ? `?q=${encodeURIComponent(query)}` : ''}`)
        .then(setRows)
        .catch((err) => setError(err.message))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <section>
      <h1>Review chats</h1>
      <p className="muted">
        Everyone's conversations, newest 200 first. Sensitive parts are masked as they were stored. Opening a
        conversation is recorded in the audit log.
      </p>
      <label className="inline-filter">
        Search
        <input type="search" placeholder="Email or title" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      {rows && (
        <table>
          <thead>
            <tr><th>Updated</th><th>User</th><th>Conversation</th><th>Needs a look</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{new Date(r.updatedAt).toLocaleString()}</td>
                <td>{r.user}</td>
                <td>
                  <Link to={`/admin/review/${r.id}`}>
                    {r.title?.replace(/\[REDACTED: ([^\]]+)\]/g, '[$1]') ?? <span className="muted">Nothing sent (only blocked attempts)</span>}
                  </Link>
                </td>
                <td className="nowrap">
                  {r.overridden > 0 && <span className="event-tag block_overridden">{r.overridden} overridden</span>}{' '}
                  {r.blocked > 0 && <span className="event-tag message_blocked">{r.blocked} blocked</span>}{' '}
                  {r.unchecked > 0 && <span className="event-tag sent_unchecked">{r.unchecked} unchecked</span>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted">No conversations{query && ' match'}.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Transcript({ id }: { id: string }) {
  const [convo, setConvo] = useState<ReviewConversation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<ReviewConversation>(`/review/conversations/${id}`).then(setConvo).catch((err) => setError(err.message))
  }, [id])

  return (
    <section>
      <p><Link to="/admin/review">← All conversations</Link></p>
      {error && <p className="error">{error}</p>}
      {convo && (
        <>
          <h1>{convo.title?.replace(/\[REDACTED: ([^\]]+)\]/g, '[$1]') ?? 'Nothing sent'}</h1>
          <p className="muted">
            {convo.user}{convo.client && ` · ${convo.client}`} · last updated {new Date(convo.updatedAt).toLocaleString()}
          </p>
          <div className="messages review">
            {convo.messages.map((m, i) => (
              <div key={i} className={`message ${m.role} ${m.action}`}>
                <div className="bubble"><MessageContent text={m.content} /></div>
                <p className="small muted">
                  {m.role === 'user' && <span className={`event-tag ${m.action}`}>{ACTIONS[m.action]}</span>}{' '}
                  {new Date(m.createdAt).toLocaleString()}{m.model && ` · ${m.model}`}
                </p>
                {m.detections.length > 0 && (
                  <ul className="small review-detections">
                    {m.detections.map((d, j) => (
                      <li key={j}>
                        {d.reason}{d.location && ` (in ${d.location})`}{' '}
                        <span className="muted">— {d.outcome}, {Math.round(d.confidence * 100)}% sure</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
