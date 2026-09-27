import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AuditEntry } from '../../api/types'

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<AuditEntry[]>('/audit-log').then(setEntries).catch((err) => setError(err.message))
  }, [])

  return (
    <section>
      <h1>Audit log</h1>
      <p className="muted">The latest 200 entries. Entries never contain the checked text itself.</p>
      {error && <p className="error">{error}</p>}
      {entries && (
        <table>
          <thead>
            <tr><th>When</th><th>User</th><th>What happened</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.user ?? <span className="muted">deleted user</span>}</td>
                <td>{e.summary}</td>
              </tr>
            ))}
            {!entries.length && <tr><td colSpan={3} className="muted">Nothing logged yet.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  )
}
