import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { verifyJWT } from "../auth/jwt";
import type { CompletionErrorResponse } from "../schema/completion-response.schema";
import { hasRole } from "../auth/roles";
import type { UserRole } from "../db/schema";
import { getRoles } from "../services/users.service";

export type AuthEnv = {
  Variables: {
    userId: number;
    roles: UserRole[]; // set by requireRole only
  };
};

const unauthorized = {
  error: { message: "Unauthorized", type: "unauthorized" },
} satisfies CompletionErrorResponse;

const forbidden = (role: UserRole) =>
  ({ error: { message: `This needs the "${role}" role`, type: "forbidden" } }) satisfies CompletionErrorResponse;

// Reads a Bearer JWT from the Authorization header; undefined if missing or invalid
function userIdFromRequest(c: Context) {
  const [scheme, token] = c.req.header("Authorization")?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) return undefined;

  try {
    return verifyJWT(token);
  } catch {
    return undefined;
  }
}

// Any logged-in user; sets `userId`
export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const userId = userIdFromRequest(c);
  if (userId === undefined) return c.json(unauthorized, 401);

  c.set("userId", userId);
  await next();
});

// Users holding `role` (admins hold them all); sets `userId` and `roles`.
// Checked against the DB rather than the token so revoking a role takes
// effect immediately.
export const requireRole = (role: UserRole) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const userId = userIdFromRequest(c);
    if (userId === undefined) return c.json(unauthorized, 401);
    const roles = await getRoles(userId);
    if (!roles) return c.json(unauthorized, 401); // deleted since the token was issued
    if (!hasRole(roles, role)) return c.json(forbidden(role), 403);

    c.set("userId", userId);
    c.set("roles", roles);
    await next();
  });
