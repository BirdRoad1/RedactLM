import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { hasRole } from '../auth/roles'
import { CloseIcon, MenuIcon } from './icons'

export function Layout() {
  const { user, logout } = useAuth()
  // narrow screens: the links and account live behind a menu button
  const [open, setOpen] = useState(false)
  const header = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => !header.current?.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="layout">
      <header className="topbar" ref={header}>
        <Link to="/chat" className="brand">RedactLM</Link>
        <button
          type="button"
          className="icon-button menu-toggle"
          aria-expanded={open}
          aria-controls="topbar-menu"
          aria-label={open ? 'Close menu' : 'Menu'}
          onClick={() => setOpen(!open)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
        <div id="topbar-menu" className={`topbar-menu${open ? ' open' : ''}`}>
          {/* picking a page closes the menu */}
          <nav onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
            <NavLink to="/chat">Chat</NavLink>
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
          <div className="topbar-account">
            <span className="muted">{user?.email}</span>
            <button onClick={logout}>Log out</button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
