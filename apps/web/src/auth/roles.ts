import type { Me, Role } from '../api/types'

// Admins hold every role
export const hasRole = (user: Me | null, role: Role) =>
  !!user && (user.roles.includes('admin') || user.roles.includes(role))

// What each role is called, and what it lets someone do
export const ROLES: { role: Role; name: string; description: string }[] = [
  { role: 'admin', name: 'Admin', description: 'Everything below. Their own messages are not checked.' },
  { role: 'override', name: 'Can override checks', description: 'May send a message as written with Ctrl+Enter: nothing blocked, nothing replaced.' },
  { role: 'no_check', name: 'Not checked', description: 'Their messages go out without any checks.' },
  { role: 'review_chats', name: 'Reviews chats', description: "May read everyone's chat history." },
  { role: 'view_audit', name: 'Reads the audit log', description: 'May read the audit log.' },
  { role: 'manage_users', name: 'Manages users', description: 'May create users and hand out roles they have themselves.' },
  { role: 'manage_backends', name: 'Manages backends', description: 'May add and delete LLM backends.' },
  { role: 'manage_settings', name: 'Manages detection settings', description: 'May change the detection policy and the LLM detector.' },
  { role: 'manage_keywords', name: 'Manages keywords', description: 'May see and change the list of private keywords.' },
]

export const roleName = (role: Role) => ROLES.find((r) => r.role === role)?.name ?? role
