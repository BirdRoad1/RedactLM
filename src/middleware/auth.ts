import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { verifyJWT } from "../auth/jwt";
import type { CompletionErrorResponse } from "../schema/completion-response.schema";
import { isAdmin } from "../services/users.service";

export type AuthEnv = {
  Variables: {
    userId: number;
  };
};

const unauthorized = {
  error: { message: "Unauthorized", type: "unauthorized" },
} satisfies CompletionErrorResponse;

const forbidden = {
  error: { message: "Admin access required", type: "forbidden" },
} satisfies CompletionErrorResponse;

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

// Admins only; sets `userId`. Checked against the DB rather than the token so
// revoking admin takes effect immediately.
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const userId = userIdFromRequest(c);
  if (userId === undefined) return c.json(unauthorized, 401);
  if (!(await isAdmin(userId))) return c.json(forbidden, 403);

  c.set("userId", userId);
  await next();
});
