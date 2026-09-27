import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, apiFetch, apiUrl } from '../../api/client'

type Provider = {
  id: number
  name: string
  slug: string
  issuer: string
  clientId: string
  allowedDomains: string[]
  enabled: boolean
  redirectUri: string
}

// Common providers' settings; "Other" is any OpenID Connect provider
const PRESETS = {
  google: { name: 'Google', slug: 'google', issuer: 'https://accounts.google.com' },
  microsoft: { name: 'Microsoft', slug: 'microsoft', issuer: 'https://login.microsoftonline.com/YOUR-TENANT-ID/v2.0' },
  other: { name: '', slug: '', issuer: '' },
}

const empty = { ...PRESETS.google, clientId: '', clientSecret: '', allowedDomains: '' }
const domains = (text: string) => text.split(/[\s,]+/).map((d) => d.trim().replace(/^@/, '')).filter(Boolean)

export function SsoPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [form, setForm] = useState(empty)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Provider[]>('/settings/sso').then(setProviders).catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    setAdding(true)
    run(async () => {
      await api('/settings/sso', 'POST', { ...form, allowedDomains: domains(form.allowedDomains) })
      setForm(empty)
    }).finally(() => setAdding(false))
  }

  const redirectFor = (slug: string) => new URL(apiUrl(`/auth/sso/${slug || 'SLUG'}/callback`), window.location.origin).href

  return (
    <section>
      <h1>Sign-in</h1>
      <p className="muted">
        Let people sign in with Google or any other OpenID Connect provider. Only people who already have an account
        here can sign in; their email is matched the first time.
      </p>
      {error && <p className="error">{error}</p>}

      {providers && providers.length > 0 && (
        <table>
          <thead>
            <tr><th>Provider</th><th>Allowed domains</th><th>Redirect URI</th><th /></tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className={p.enabled ? undefined : 'deleted'}>
                <td><strong>{p.name}</strong><div className="small muted">{p.issuer}</div></td>
                <td>
                  <input
                    className="domains-input"
                    defaultValue={p.allowedDomains.join(', ')}
                    placeholder="Any"
                    aria-label={`Allowed domains for ${p.name}`}
                    onBlur={(e) => {
                      const next = domains(e.target.value)
                      if (next.join() !== p.allowedDomains.join()) run(() => api(`/settings/sso/${p.id}`, 'PATCH', { allowedDomains: next }))
                    }}
                  />
                </td>
                <td><code className="small">{p.redirectUri}</code></td>
                <td className="nowrap">
                  <button onClick={() => run(() => api(`/settings/sso/${p.id}`, 'PATCH', { enabled: !p.enabled }))}>
                    {p.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                  <button
                    className="danger"
                    onClick={() => confirm(`Remove ${p.name} sign-in?`) && run(() => apiFetch(`/settings/sso/${p.id}`, { method: 'DELETE' }))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Add a provider</h2>
      <form className="card form-grid" onSubmit={add}>
        <label>
          Provider
          <select
            value={Object.entries(PRESETS).find(([, v]) => v.issuer === form.issuer && v.name === form.name)?.[0] ?? 'other'}
            onChange={(e) => setForm({ ...form, ...PRESETS[e.target.value as keyof typeof PRESETS] })}
          >
            <option value="google">Google</option>
            <option value="microsoft">Microsoft Entra ID</option>
            <option value="other">Other (OpenID Connect)</option>
          </select>
        </label>
        <label>Name on the button<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Short name, for URLs<input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></label>
        <label className="wide">Issuer URL<input type="url" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} required /></label>
        <label>Client ID<input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required /></label>
        <label>Client secret<input type="password" autoComplete="off" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} required /></label>
        <label>
          Allowed email domains
          <input value={form.allowedDomains} placeholder="Any, or e.g. yourcompany.com" onChange={(e) => setForm({ ...form, allowedDomains: e.target.value })} />
        </label>
        <p className="wide small muted">
          Register this as the redirect URI with the provider: <code>{redirectFor(form.slug)}</code>
          {form.issuer === PRESETS.google.issuer && (
            <> (Google Cloud Console → APIs &amp; Services → Credentials → OAuth client ID, type "Web application")</>
          )}
        </p>
        <button type="submit" disabled={adding}>{adding ? 'Checking the provider…' : 'Add provider'}</button>
      </form>
    </section>
  )
}
