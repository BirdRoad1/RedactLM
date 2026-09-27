import { useEffect, useState } from 'react'
import { api, apiFetch } from '../../api/client'
import type { AuditEntry } from '../../api/types'

// Every kind of entry, grouped as the filter shows them, with its name here
const CATEGORIES: { name: string; events: Record<string, string> }[] = [
  {
    name: 'Messages',
    events: {
      message_blocked: 'Message blocked',
      message_warned: 'Sent with warnings',
      message_replaced: 'Sent with placeholders',
      block_overridden: 'Block overridden',
      sent_unchecked: 'Sent unchecked',
      assistant_pii: 'Personal data in AI text',
      partially_checked: 'Partly checked',
      attachment_refused: 'Attachment refused',
      detector_unavailable: 'AI detector unavailable',
    },
  },
  {
    name: 'Chats',
    events: {
      conversation_deleted: 'Conversation deleted',
      conversation_reviewed: 'Conversation reviewed',
    },
  },
  {
    name: 'Admin changes',
    events: {
      settings_changed: 'Settings changed',
      backend_created: 'Backend added',
      backend_deleted: 'Backend deleted',
      user_created: 'User created',
      user_roles_changed: 'Roles changed',
      user_deleted: 'User deleted',
      user_restored: 'User restored',
      keywords_added: 'Keywords added',
      keywords_deleted: 'Keywords removed',
      audit_exported: 'Audit log exported',
    },
  },
  {
    name: 'Logins',
    events: {
      login_succeeded: 'Logged in',
      login_failed: 'Failed login',
      rate_limited: 'Rate limited',
    },
  },
]

const EVENTS: Record<string, string> = Object.assign({}, ...CATEGORIES.map((c) => c.events))

const PAGE = 200

type Filters = { type: string; user: string; from: string; to: string; conversation: string }
const noFilters: Filters = { type: '', user: '', from: '', to: '', conversation: '' }

// The query string for the API. Dates are whole local days: "to" includes
// all of that day.
function query(f: Filters) {
  const q = new URLSearchParams()
  const category = CATEGORIES.find((c) => `category:${c.name}` === f.type)
  if (category) q.set('event', Object.keys(category.events).join(','))
  else if (f.type) q.set('event', f.type)
  if (f.user.trim()) q.set('user', f.user.trim())
  if (f.conversation) q.set('conversation', f.conversation)
  if (f.from) q.set('from', new Date(`${f.from}T00:00`).toISOString())
  if (f.to) {
    const end = new Date(`${f.to}T00:00`)
    end.setDate(end.getDate() + 1)
    q.set('to', end.toISOString())
  }
  return q
}

export function AuditPage() {
  const [filters, setFilters] = useState(noFilters)
  const [applied, setApplied] = useState(noFilters) // `user` waits for typing to pause
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (changes: Partial<Filters>) => setFilters((f) => ({ ...f, ...changes }))

  useEffect(() => {
    const timer = setTimeout(() => setApplied(filters), filters.user === applied.user ? 0 : 300)
    return () => clearTimeout(timer)
  }, [filters, applied.user])

  useEffect(() => {
    let cancelled = false
    api<AuditEntry[]>(`/audit-log?${query(applied)}`)
      .then((rows) => {
        if (cancelled) return
        setEntries(rows)
        setMore(rows.length === PAGE)
        setError(null)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [applied])

  async function loadMore() {
    if (!entries?.length) return
    setLoading(true)
    try {
      const q = query(applied)
      q.set('before', String(entries[entries.length - 1]!.id))
      const rows = await api<AuditEntry[]>(`/audit-log?${q}`)
      setEntries([...entries, ...rows])
      setMore(rows.length === PAGE)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // Everything the filters match, not just what's loaded. Fetched with the
  // session token (a plain link couldn't send it), then saved.
  async function exportCsv() {
    setExporting(true)
    setError(null)
    try {
      const res = await apiFetch(`/audit-log/export.csv?${query(applied)}`)
      const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'audit-log.csv'
      const url = URL.createObjectURL(await res.blob())
      const link = Object.assign(document.createElement('a'), { href: url, download: name })
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  const filtered = Object.values(filters).some(Boolean)

  return (
    <section>
      <div className="page-head">
        <h1>Audit log</h1>
        <button onClick={exportCsv} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button>
      </div>
      <p className="muted">Entries never contain the checked text, passwords or API keys.</p>

      <div className="audit-filters">
        <label>
          Type
          <select value={filters.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="">Everything</option>
            {CATEGORIES.map((c) => (
              <optgroup key={c.name} label={c.name}>
                <option value={`category:${c.name}`}>All {c.name.toLowerCase()}</option>
                {Object.entries(c.events).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          User
          <input type="search" placeholder="Email" value={filters.user} onChange={(e) => set({ user: e.target.value })} />
        </label>
        <label>
          From
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          To
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </label>
        {filters.conversation && (
          <span className="filter-chip">
            One conversation
            <button aria-label="Show all conversations" onClick={() => set({ conversation: '' })}>×</button>
          </span>
        )}
        {filtered && <button className="link-button" onClick={() => setFilters(noFilters)}>Clear filters</button>}
      </div>

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
                <td>
                  {e.summary}
                  {e.conversationId && !filters.conversation && (
                    <>
                      {' '}
                      <button className="link-button small" onClick={() => set({ conversation: e.conversationId! })}>
                        Everything in this chat
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!entries.length && <tr><td colSpan={4} className="muted">{filtered ? 'Nothing matches these filters.' : 'Nothing logged yet.'}</td></tr>}
          </tbody>
        </table>
      )}
      {more && (
        <p className="center">
          <button onClick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
        </p>
      )}
    </section>
  )
}
