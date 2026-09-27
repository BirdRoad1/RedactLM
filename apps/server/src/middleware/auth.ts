import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { verifyJWT } from "../auth/jwt";
import type { CompletionErrorResponse } from "../schema/completion-response.schema";
import { hasRole } from "../auth/roles";
import type { UserRole } from "../db/schema";
import { getSessionUser } from "../services/users.service";

export type AuthEnv = {
  Variables: {
    userId: number;
    roles: UserRole[];
  };
};

const unauthorized = {
  error: { message: "Unauthorized", type: "unauthorized" },
} satisfies CompletionErrorResponse;

const forbidden = (role: UserRole) =>
  ({ error: { message: `This needs the "${role}" role`, type: "forbidden" } }) satisfies CompletionErrorResponse;

// Reads a Bearer JWT from the Authorization header; undefined if missing or invalid
function tokenFromRequest(c: Context) {
  const [scheme, token] = c.req.header("Authorization")?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) return undefined;

  try {
    return verifyJWT(token);
  } catch {
    return undefined;
  }
}

// The signed-in user and their roles, checked against the DB on every
// request: undefined if the token is missing or invalid, the user was
// deleted, or the token predates a password change (which signs them out
// everywhere). Roles come from the DB, so revoking one takes effect at once.
async function sessionFromRequest(c: Context) {
  const token = tokenFromRequest(c);
  if (!token) return undefined;
  const user = await getSessionUser(token.userId);
  if (!user) return undefined;
  // issued-at is in whole seconds; a token from the same second as the
  // change is the one the change itself hands out
  if (user.sessionsValidFrom && token.issuedAt < Math.floor(user.sessionsValidFrom.getTime() / 1000)) return undefined;
  return { userId: token.userId, roles: user.roles };
}

// Any logged-in user; sets `userId` and `roles`
export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await sessionFromRequest(c);
  if (!session) return c.json(unauthorized, 401);

  c.set("userId", session.userId);
  c.set("roles", session.roles);
  await next();
});

// Users holding `role` (admins hold them all); sets `userId` and `roles`
export const requireRole = (role: UserRole) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const session = await sessionFromRequest(c);
    if (!session) return c.json(unauthorized, 401);
    if (!hasRole(session.roles, role)) return c.json(forbidden(role), 403);

    c.set("userId", session.userId);
    c.set("roles", session.roles);
    await next();
  });
