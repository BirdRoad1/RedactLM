import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, apiFetch } from '../../api/client'
import type { Role, Session, User } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { hasRole, roleName, ROLES } from '../../auth/roles'

const empty = { email: '', username: '', password: '', roles: [] as Role[] }

// Checkboxes for every role. Ones you don't have can't be given or taken away
// (the server refuses), so they're shown but disabled.
function RolePicker({ value, onChange }: { value: Role[]; onChange: (roles: Role[]) => void }) {
  const { user } = useAuth()
  return (
    <div className="role-picker">
      {ROLES.map(({ role, name, description }) => (
        <label key={role} title={hasRole(user, role) ? description : `${description} You can only hand out roles you have.`}>
          <input
            type="checkbox"
            checked={value.includes(role)}
            disabled={!hasRole(user, role)}
            onChange={(e) => onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))}
          />
          <span>{name}</span>
          <small className="muted">{description}</small>
        </label>
      ))}
    </div>
  )
}

// A new password for someone, typed twice
type PasswordForm = { id: number; email: string; password: string; confirm: string }

export function UsersPage() {
  const { user: me, adopt } = useAuth()
  const [passwordFor, setPasswordFor] = useState<PasswordForm | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [users, setUsers] = useState<User[] | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState<{ id: number; roles: Role[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<User[]>(`/users${showDeleted ? '?deleted=true' : ''}`).then(setUsers).catch((err) => setError(err.message))
  }, [showDeleted])
  useEffect(load, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    setNotice(null)
    try {
      await action()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      await api<User>('/users', 'POST', { ...form, password: form.password || undefined })
      setForm(empty)
    })
  }

  const saveRoles = () =>
    run(async () => {
      await api<User>(`/users/${editing!.id}/roles`, 'PUT', { roles: editing!.roles })
      setEditing(null)
    })

  const remove = (u: User) => {
    if (!confirm(`Delete ${u.email}? They won't be able to log in. Their chats and history stay, and you can restore them later.`)) return
    run(() => apiFetch(`/users/${u.id}`, { method: 'DELETE' }))
  }

  const restore = (u: User) => run(() => api(`/users/${u.id}/restore`, 'POST'))

  // Setting the password of, deleting or restoring someone with roles you
  // don't have is refused (by the server too): it'd be a way around the rule
  // that nobody hands out more than they have
  const outranks = (u: User) => u.roles.every((role) => hasRole(me, role))
  const beyondYou = (action: string) => `They have roles you don't, so you can't ${action} them`

  const savePassword = (e: FormEvent) => {
    e.preventDefault()
    const p = passwordFor!
    if (p.password !== p.confirm) {
      setError("The two passwords don't match.")
      return
    }
    run(async () => {
      const result = await api<{ user: User; session?: Session }>(`/users/${p.id}/password`, 'PUT', { password: p.password })
      // your own: the old session ends with the change, so switch to the new one
      if (result.session) await adopt(result.session)
      setPasswordFor(null)
      setNotice(
        result.session
          ? 'Your password was changed. You stay signed in here; everywhere else was signed out.'
          : `The password for ${p.email} was changed, and they were signed out everywhere.`,
      )
    })
  }

  return (
    <section>
      <div className="page-head">
        <h1>Users</h1>
        <label className="toggle">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted users
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      {users && (
        <table>
          <thead>
            <tr><th>Email</th><th>Username</th><th>Roles</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr className={u.deletedAt ? 'deleted' : undefined}>
                  <td>
                    {u.email}
                    {u.deletedAt && <span className="muted small"> · deleted {new Date(u.deletedAt).toLocaleDateString()}</span>}
                  </td>
                  <td>{u.username}</td>
                  <td>{u.roles.length ? u.roles.map(roleName).join(', ') : <span className="muted">None</span>}</td>
                  <td className="nowrap">
                    {u.deletedAt ? (
                      <button disabled={!outranks(u)} title={outranks(u) ? undefined : beyondYou("restore")} onClick={() => restore(u)}>Restore</button>
                    ) : (
                      <>
                        {editing?.id !== u.id && <button onClick={() => setEditing({ id: u.id, roles: u.roles })}>Edit roles</button>}
                        {passwordFor?.id !== u.id && (
                          <button
                            disabled={!outranks(u)}
                            title={outranks(u) ? undefined : "They have roles you don't, so you can't set their password"}
                            onClick={() => setPasswordFor({ id: u.id, email: u.email, password: '', confirm: '' })}
                          >
                            Set password
                          </button>
                        )}
                        {u.id !== me?.id && (
                          <button className="danger" disabled={!outranks(u)} title={outranks(u) ? undefined : beyondYou("delete")} onClick={() => remove(u)}>
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
                {passwordFor?.id === u.id && (
                  <tr>
                    <td colSpan={4}>
                      <form className="password-form" onSubmit={savePassword}>
                        <label>
                          New password
                          <input type="password" autoComplete="new-password" minLength={8} required autoFocus value={passwordFor.password} onChange={(e) => setPasswordFor({ ...passwordFor, password: e.target.value })} />
                        </label>
                        <label>
                          Again
                          <input type="password" autoComplete="new-password" minLength={8} required value={passwordFor.confirm} onChange={(e) => setPasswordFor({ ...passwordFor, confirm: e.target.value })} />
                        </label>
                        <button type="submit">Set password</button>
                        <button type="button" onClick={() => setPasswordFor(null)}>Cancel</button>
                        <p className="small muted">At least 8 characters. {u.id === me?.id ? "You'll stay signed in here; other sessions end." : 'They\'ll be signed out everywhere.'}</p>
                      </form>
                    </td>
                  </tr>
                )}
                {editing?.id === u.id && (
                  <tr>
                    <td colSpan={4}>
                      <RolePicker value={editing.roles} onChange={(roles) => setEditing({ ...editing, roles })} />
                      <button type="submit" onClick={saveRoles}>Save roles</button>{' '}
                      <button onClick={() => setEditing(null)}>Cancel</button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <h2>New user</h2>
      <form className="card form-grid" onSubmit={create}>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
        <label>
          Password
          <input type="password" autoComplete="new-password" placeholder="Leave empty for sign-in with SSO only" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <div className="wide">
          <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
        </div>
        <button type="submit">Create user</button>
      </form>
    </section>
  )
}
