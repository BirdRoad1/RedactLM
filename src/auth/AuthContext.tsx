import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getSession, SESSION_EXPIRED, setSession } from '../api/client'
import type { Me, Session } from '../api/types'

type Auth = {
  user: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(() => getSession() !== null)

  const logout = useCallback(() => {
    setSession(null)
    setUser(null)
  }, [])

  // Restore the session on load
  useEffect(() => {
    if (!getSession()) return
    api<Me>('/me')
      .then(setUser)
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [])

  // Log out when the token expires or the server rejects it
  useEffect(() => {
    const session = getSession()
    if (!user || !session) return
    const timer = setTimeout(logout, new Date(session.expiresAt).getTime() - Date.now())
    window.addEventListener(SESSION_EXPIRED, logout)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(SESSION_EXPIRED, logout)
    }
  }, [user, logout])

  const login = useCallback(async (email: string, password: string) => {
    setSession(await api<Session>('/auth/login', 'POST', { email, password }))
    setUser(await api<Me>('/me'))
  }, [])

  return <AuthContext value={{ user, loading, login, logout }}>{children}</AuthContext>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
