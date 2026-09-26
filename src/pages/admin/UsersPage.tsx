import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { Me } from '../../api/types'

const empty = { email: '', username: '', password: '', isAdmin: false }

export function UsersPage() {
  const [form, setForm] = useState(empty)
  const [created, setCreated] = useState<Me[]>([])
  const [error, setError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const user = await api<Me>('/users', 'POST', form)
      setCreated((c) => [user, ...c])
      setForm(empty)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section>
      <h1>Users</h1>
      {/* The API has no user list yet, only creation */}
      <form className="card form-grid" onSubmit={create}>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
        <label>Password<input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        <div className="checks">
          <label><input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> Admin</label>
        </div>
        <button type="submit">Create user</button>
      </form>
      {error && <p className="error">{error}</p>}

      {created.length > 0 && (
        <>
          <h2>Created this session</h2>
          <ul>
            {created.map((u) => <li key={u.id}>{u.email} ({u.username}){u.isAdmin && ', admin'}</li>)}
          </ul>
        </>
      )}
    </section>
  )
}
