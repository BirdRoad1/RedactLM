import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import type { Role } from './api/types'
import { useAuth } from './auth/AuthContext'
import { hasRole } from './auth/roles'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/admin/AuditPage'
import { BackendsPage } from './pages/admin/BackendsPage'
import { DetectorPage } from './pages/admin/DetectorPage'
import { KeywordsPage } from './pages/admin/KeywordsPage'
import { PolicyPage } from './pages/admin/PolicyPage'
import { ReviewPage } from './pages/admin/ReviewPage'
import { SsoPage } from './pages/admin/SsoPage'
import { UsersPage } from './pages/admin/UsersPage'
import { ChatPage } from './pages/ChatPage'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { SsoReturnPage } from './pages/SsoReturnPage'

// The server enforces access; these only keep people off pages that would fail
function RequireUser({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <p className="muted center">Loading…</p>
  return user ? children : <Navigate to="/login" replace />
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth()
  return hasRole(user, role) ? children : <Navigate to="/chat" replace />
}

export function App() {
  return (
    <Routes>
      <Route index element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/sso" element={<SsoReturnPage />} />
      <Route element={<RequireUser><Layout /></RequireUser>}>
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:id" element={<ChatPage />} />
        <Route path="admin/backends" element={<RequireRole role="manage_backends"><BackendsPage /></RequireRole>} />
        <Route path="admin/users" element={<RequireRole role="manage_users"><UsersPage /></RequireRole>} />
        <Route path="admin/policy" element={<RequireRole role="manage_settings"><PolicyPage /></RequireRole>} />
        <Route path="admin/detector" element={<RequireRole role="manage_settings"><DetectorPage /></RequireRole>} />
        <Route path="admin/sign-in" element={<RequireRole role="manage_settings"><SsoPage /></RequireRole>} />
        <Route path="admin/keywords" element={<RequireRole role="manage_keywords"><KeywordsPage /></RequireRole>} />
        <Route path="admin/audit" element={<RequireRole role="view_audit"><AuditPage /></RequireRole>} />
        <Route path="admin/review" element={<RequireRole role="review_chats"><ReviewPage /></RequireRole>} />
        <Route path="admin/review/:id" element={<RequireRole role="review_chats"><ReviewPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
