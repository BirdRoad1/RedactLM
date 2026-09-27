import type { UserRole } from "../db/schema";

// Admins hold every role
export function hasRole(roles: readonly UserRole[], role: UserRole) {
  return roles.includes("admin") || roles.includes(role);
}

// Whether the user's own messages go out without any checks
export const skipsChecks = (roles: readonly UserRole[]) => hasRole(roles, "no_check");

// The roles in `wanted` that `granter` can't hand out: nobody can give (or
// take away) more than they hold, so manage_users can't lead to admin
export function rolesBeyond(granter: readonly UserRole[], wanted: readonly UserRole[]) {
  return wanted.filter((role) => !hasRole(granter, role));
}

// What each role is called in summaries and the web UI
export const roleNames: Record<UserRole, string> = {
  admin: "Admin",
  override: "Can override checks",
  no_check: "Not checked",
  review_chats: "Reviews chats",
  view_audit: "Reads the audit log",
  manage_users: "Manages users",
  manage_backends: "Manages backends",
  manage_settings: "Manages detection settings",
};
