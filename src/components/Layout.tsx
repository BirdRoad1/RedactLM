import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'

export function Layout() {
  const { user, logout } = useAuth()

  return (
    <div className="layout">
      <header className="topbar">
        <strong>LLM Thingy</strong>
        <nav>
          <NavLink to="/" end>Chat</NavLink>
          {user?.isAdmin && (
            <>
              <NavLink to="/admin/backends">Backends</NavLink>
              <NavLink to="/admin/users">Users</NavLink>
              <NavLink to="/admin/policy">Detection policy</NavLink>
              <NavLink to="/admin/detector">LLM detector</NavLink>
            </>
          )}
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
