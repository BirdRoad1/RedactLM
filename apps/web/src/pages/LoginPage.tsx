import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { api, apiUrl } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EyeIcon, GoogleLogo, KeyIcon, ShieldIcon, SwapIcon } from '../components/icons'

type SignInOption = { slug: string; name: string }

export function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>((location.state as { ssoError?: string } | null)?.ssoError ?? null)
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<SignInOption[]>([])

  useEffect(() => {
    api<SignInOption[]>('/auth/sso').then(setProviders).catch(() => {})
  }, [])

  if (user) return <Navigate to="/chat" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <aside className="login-brand">
        <span className="brand">LLM Thingy</span>
        <div className="login-pitch">
          <h2>Use AI without leaking what matters.</h2>
          <ul>
            <li><ShieldIcon /> Personal data and company secrets are caught before a message leaves.</li>
            <li><SwapIcon /> Sensitive values can be swapped for placeholders, so the answer still helps.</li>
            <li><EyeIcon /> Every check is logged, so it's clear what happened and why.</li>
          </ul>
        </div>
        <span className="login-foot">Checks run on your company's own servers.</span>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <h1>Sign in</h1>
          {error && <p className="error login-error" role="alert">{error}</p>}

          {providers.length > 0 && (
            <>
              <div className="sso-buttons">
                {providers.map((p) => (
                  <a key={p.slug} className="sso-button" href={apiUrl(`/auth/sso/${encodeURIComponent(p.slug)}/start`)}>
                    {/google/i.test(p.name) ? <GoogleLogo /> : <KeyIcon size={18} />}
                    Continue with {p.name}
                  </a>
                ))}
              </div>
              <div className="login-divider"><span>or</span></div>
            </>
          )}

          <form onSubmit={submit}>
            <label>
              Email
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          {/* without single sign-on, accounts only come from an admin */}
          {!providers.length && (
            <p className="login-note">
              No account yet? Your organization's administrator creates accounts for everyone who uses LLM Thingy. Ask
              them to add you.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
