import type { Context } from "hono";
import z from "zod";
import { rolesBeyond } from "../auth/roles";
import type { AuthEnv } from "../middleware/auth";
import { createUserSchema, setRolesSchema } from "../schema/user.schema";
import { audit } from "../services/audit.service";
import * as usersService from "../services/users.service";

const cantGrant = (roles: string[]) =>
  ({ error: `You can only hand out roles you have yourself, not: ${roles.join(", ")}` });

// ?deleted=true includes deleted users
export async function listUsers(c: Context<AuthEnv>) {
  return c.json(await usersService.listUsers({ deleted: c.req.query("deleted") === "true" }));
}

export async function createUser(c: Context<AuthEnv>) {
  const parsed = await createUserSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const beyond = rolesBeyond(c.get("roles"), parsed.data.roles);
  if (beyond.length) return c.json(cantGrant(beyond), 403);

  try {
    const user = await usersService.createUser(parsed.data);
    await audit("user_created", { email: user.email, roles: user.roles });
    return c.json(user, 201);
  } catch (err) {
    if (err instanceof usersService.EmailTakenError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
}

const userId = z.coerce.number().int().positive();

// Replaces the user's roles. Adding or removing a role both need you to hold it.
export async function setUserRoles(c: Context<AuthEnv>) {
  const id = userId.safeParse(c.req.param("id"));
  const parsed = await setRolesSchema.safeParseAsync(await c.req.json());
  if (id.error || parsed.error) {
    return c.json({ error: "Send {\"roles\": [...]}" }, 400);
  }

  const current = await usersService.getRoles(id.data);
  if (!current) return c.json({ error: "User not found" }, 404);

  const wanted = parsed.data.roles;
  const added = wanted.filter((r) => !current.includes(r));
  const removed = current.filter((r) => !wanted.includes(r));
  const beyond = rolesBeyond(c.get("roles"), [...added, ...removed]);
  if (beyond.length) return c.json(cantGrant(beyond), 403);

  try {
    const result = await usersService.setRoles(id.data, wanted);
    if (!result) return c.json({ error: "User not found" }, 404);
    // against what they had when the change landed
    const now = { added: wanted.filter((r) => !result.before.includes(r)), removed: result.before.filter((r) => !wanted.includes(r)) };
    if (now.added.length || now.removed.length) {
      await audit("user_roles_changed", { email: result.user.email, ...now });
    }
    return c.json(result.user);
  } catch (err) {
    if (err instanceof usersService.LastAdminError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
}

// Soft delete. Not yourself, and not someone with roles you don't have (that
// would be a way around the granting rule).
export async function deleteUser(c: Context<AuthEnv>) {
  const id = userId.safeParse(c.req.param("id"));
  if (id.error) return c.json({ error: "User not found" }, 404);
  if (id.data === c.get("userId")) return c.json({ error: "You can't delete yourself" }, 409);

  const roles = await usersService.getRoles(id.data);
  if (!roles) return c.json({ error: "User not found" }, 404);
  const beyond = rolesBeyond(c.get("roles"), roles);
  if (beyond.length) {
    return c.json({ error: `They have roles you don't (${beyond.join(", ")}), so you can't delete them` }, 403);
  }

  try {
    const user = await usersService.deleteUser(id.data);
    if (!user) return c.json({ error: "User not found" }, 404);
    await audit("user_deleted", { email: user.email });
    return c.json(user);
  } catch (err) {
    if (err instanceof usersService.LastAdminError) return c.json({ error: "This is the only admin left, so they can't be deleted" }, 409);
    throw err;
  }
}

// Same rule as deleting: you can't bring back someone with more than you have
export async function restoreUser(c: Context<AuthEnv>) {
  const id = userId.safeParse(c.req.param("id"));
  if (id.error) return c.json({ error: "User not found" }, 404);

  const deleted = (await usersService.listUsers({ deleted: true })).find((u) => u.id === id.data && u.deletedAt);
  if (!deleted) return c.json({ error: "No deleted user with that id" }, 404);
  const beyond = rolesBeyond(c.get("roles"), deleted.roles);
  if (beyond.length) {
    return c.json({ error: `They have roles you don't (${beyond.join(", ")}), so you can't restore them` }, 403);
  }

  try {
    const user = await usersService.restoreUser(id.data);
    if (!user) return c.json({ error: "No deleted user with that id" }, 404);
    await audit("user_restored", { email: user.email });
    return c.json(user);
  } catch (err) {
    if (err instanceof usersService.EmailTakenError) {
      return c.json({ error: `${deleted.email} belongs to another user now, so this one can't be restored` }, 409);
    }
    throw err;
  }
}
