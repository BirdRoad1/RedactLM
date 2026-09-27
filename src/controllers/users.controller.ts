import type { Context } from "hono";
import { createUserSchema } from "../schema/user.schema";
import { audit } from "../services/audit.service";
import * as usersService from "../services/users.service";

export async function createUser(c: Context) {
  const parsed = await createUserSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Invalid request" }, 400);
  }

  try {
    const user = await usersService.createUser(parsed.data);
    await audit("user_created", { email: user.email, isAdmin: user.isAdmin });
    return c.json(user, 201);
  } catch (err) {
    if (err instanceof usersService.EmailTakenError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
}
