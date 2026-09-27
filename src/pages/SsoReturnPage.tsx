import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'

// Where single sign-on comes back to: the outcome is in the URL fragment
// (#token=...&expiresAt=... or #error=...). It's read once and the URL is
// replaced straight away, so the token doesn't stay in the address bar or
// the history.
export function SsoReturnPage() {
  const { adopt } = useAuth()
  const navigate = useNavigate()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const params = new URLSearchParams(window.location.hash.slice(1))
    window.history.replaceState(null, '', '/sso')
    const token = params.get('token')
    const expiresAt = params.get('expiresAt')
    if (token && expiresAt) {
      adopt({ token, expiresAt })
        .then(() => navigate('/chat', { replace: true }))
        .catch(() => navigate('/login', { replace: true, state: { ssoError: 'Signed in, but your account could not be loaded.' } }))
    } else {
      navigate('/login', { replace: true, state: { ssoError: params.get('error') ?? 'Sign-in did not complete.' } })
    }
  }, [adopt, navigate])

  return <p className="muted center">Signing you in…</p>
}
