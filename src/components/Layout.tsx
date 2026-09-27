import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/roles'

export function Layout() {
  const { user, logout } = useAuth()

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">LLM Thingy</span>
        <nav>
          <NavLink to="/" end>Chat</NavLink>
          {hasRole(user, 'review_chats') && <NavLink to="/admin/review">Review chats</NavLink>}
          {hasRole(user, 'manage_backends') && <NavLink to="/admin/backends">Backends</NavLink>}
          {hasRole(user, 'manage_users') && <NavLink to="/admin/users">Users</NavLink>}
          {hasRole(user, 'manage_settings') && (
            <>
              <NavLink to="/admin/policy">Detection policy</NavLink>
              <NavLink to="/admin/detector">LLM detector</NavLink>
              <NavLink to="/admin/sign-in">Sign-in</NavLink>
            </>
          )}
          {hasRole(user, 'manage_keywords') && <NavLink to="/admin/keywords">Keywords</NavLink>}
          {hasRole(user, 'view_audit') && <NavLink to="/admin/audit">Audit log</NavLink>}
        </nav>
        <span className="spacer" />
        <span className="muted">{user?.email}</span>
        <button onClick={logout}>Log out</button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
