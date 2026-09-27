import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth/AuthContext'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/admin/AuditPage'
import { BackendsPage } from './pages/admin/BackendsPage'
import { DetectorPage } from './pages/admin/DetectorPage'
import { PolicyPage } from './pages/admin/PolicyPage'
import { UsersPage } from './pages/admin/UsersPage'
import { ChatPage } from './pages/ChatPage'
import { LoginPage } from './pages/LoginPage'

// The server enforces access; these only keep people off pages that would fail
function RequireUser({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <p className="muted center">Loading…</p>
  return user ? children : <Navigate to="/login" replace />
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user?.isAdmin ? children : <Navigate to="/" replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireUser><Layout /></RequireUser>}>
        <Route index element={<ChatPage />} />
        <Route path="c/:id" element={<ChatPage />} />
        <Route path="admin/backends" element={<RequireAdmin><BackendsPage /></RequireAdmin>} />
        <Route path="admin/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="admin/policy" element={<RequireAdmin><PolicyPage /></RequireAdmin>} />
        <Route path="admin/detector" element={<RequireAdmin><DetectorPage /></RequireAdmin>} />
        <Route path="admin/audit" element={<RequireAdmin><AuditPage /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
