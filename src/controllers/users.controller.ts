import type { Context } from "hono";
import { createUserSchema } from "../schema/user.schema";
import * as usersService from "../services/users.service";

export async function createUser(c: Context) {
  const parsed = await createUserSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Invalid request" }, 400);
  }

  try {
    return c.json(await usersService.createUser(parsed.data), 201);
  } catch (err) {
    if (err instanceof usersService.EmailTakenError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
}
