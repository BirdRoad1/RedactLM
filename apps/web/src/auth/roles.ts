import { hasRole as roleIn, roleInfo, userRoles, type UserRole } from '@llm-thingy/shared'
import type { Me } from '../api/types'

export { roleName } from '@llm-thingy/shared'

// Admins hold every role
export const hasRole = (user: Me | null, role: UserRole) => !!user && roleIn(user.roles, role)

// Every role, in order, with its name and what it lets someone do
export const ROLES = userRoles.map((role) => ({ role, ...roleInfo[role] }))
