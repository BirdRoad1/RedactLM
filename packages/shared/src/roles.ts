// What a user may do. "admin" includes every other role. The order here is
// the order the web app lists them in.
export const userRoles = [
  "admin",           // everything below, and their own messages skip the checks
  "override",        // may send a message as written: not blocked, nothing replaced
  "no_check",        // their messages aren't checked at all
  "review_chats",    // may read everyone's chat history
  "view_audit",      // may read the audit log
  "manage_users",    // may create users and change their roles
  "manage_backends", // may add and delete LLM backends (and see their settings)
  "manage_settings", // may change the detection policy and LLM detector
  "manage_keywords", // may see and change the custom keyword list
] as const;

export type UserRole = (typeof userRoles)[number];

// What each role is called, and what it lets someone do, in plain language
export const roleInfo: Record<UserRole, { name: string; description: string }> = {
  admin: { name: "Admin", description: "Everything below. Their own messages are not checked." },
  override: { name: "Can override checks", description: "May send a message as written with Ctrl+Enter: nothing blocked, nothing replaced." },
  no_check: { name: "Not checked", description: "Their messages go out without any checks." },
  review_chats: { name: "Reviews chats", description: "May read everyone's chat history." },
  view_audit: { name: "Reads the audit log", description: "May read the audit log." },
  manage_users: { name: "Manages users", description: "May create users and hand out roles they have themselves." },
  manage_backends: { name: "Manages backends", description: "May add and delete LLM backends." },
  manage_settings: { name: "Manages detection settings", description: "May change the detection policy and the LLM detector." },
  manage_keywords: { name: "Manages keywords", description: "May see and change the list of private keywords." },
};

export const roleName = (role: UserRole) => roleInfo[role]?.name ?? role;

// Admins hold every role
export function hasRole(roles: readonly UserRole[], role: UserRole) {
  return roles.includes("admin") || roles.includes(role);
}

// Whether someone's own messages go out without any checks
export const skipsChecks = (roles: readonly UserRole[]) => hasRole(roles, "no_check");

// The roles in `wanted` that `granter` can't hand out: nobody can give (or
// take away) more than they hold, so manage_users can't lead to admin
export function rolesBeyond(granter: readonly UserRole[], wanted: readonly UserRole[]) {
  return wanted.filter((role) => !hasRole(granter, role));
}
