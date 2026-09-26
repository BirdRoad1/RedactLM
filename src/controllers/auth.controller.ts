import type { Context } from "hono";
import { createJWT } from "../auth/jwt";
import { loginSchema, type LoginResponse } from "../schema/auth.schema";
import { verifyCredentials } from "../services/users.service";

export async function login(c: Context) {
  const parsed = await loginSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Invalid request" }, 400);
  }

  // Same answer for unknown email and wrong password, so this can't be used
  // to find out which emails have accounts
  const userId = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (userId === undefined) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const { token, expiresAt } = createJWT(userId);
  return c.json({ token, expiresAt: expiresAt.toISOString() } satisfies LoginResponse);
}
