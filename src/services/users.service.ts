import { arrayContains, asc, eq } from "drizzle-orm";
import type z from "zod";
import { db } from "../db";
import { usersTable, type UserRole } from "../db/schema";
import type { createUserSchema } from "../schema/user.schema";

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`A user with email "${email}" already exists`);
  }
}

export class LastAdminError extends Error {
  constructor() {
    super("This is the only admin left, so they have to stay an admin");
  }
}

// Everything but the password hash
const publicColumns = {
  id: usersTable.id,
  email: usersTable.email,
  username: usersTable.username,
  roles: usersTable.roles,
  createdAt: usersTable.createdAt,
};

export async function createUser(data: z.infer<typeof createUserSchema>) {
  try {
    return (
      await db
        .insert(usersTable)
        .values({
          email: data.email,
          username: data.username,
          passwordHash: await Bun.password.hash(data.password),
          roles: [...new Set(data.roles)],
        })
        .returning(publicColumns)
    )[0]!;
  } catch (err) {
    // email is the only unique column
    if ((err as { cause?: { code?: string } })?.cause?.code === "23505") {
      throw new EmailTakenError(data.email);
    }
    throw err;
  }
}

// Hash of a random password, verified against when the email doesn't exist so
// unknown emails take as long as wrong passwords
const dummyHash = Bun.password.hash(crypto.randomUUID());

// The user's id if the email and password match, otherwise undefined
export async function verifyCredentials(email: string, password: string) {
  const [user] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  const matches = await Bun.password.verify(
    password,
    user?.passwordHash ?? (await dummyHash),
  );
  return user?.passwordHash && matches ? user.id : undefined;
}

export async function getUser(userId: number) {
  const [user] = await db.select(publicColumns).from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

export async function listUsers() {
  return await db.select(publicColumns).from(usersTable).orderBy(asc(usersTable.id));
}

// Undefined for users that don't exist (e.g. deleted after their token was issued)
export async function getRoles(userId: number) {
  const [user] = await db.select({ roles: usersTable.roles }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.roles;
}

// The user with their new roles (and what they had before), or undefined if
// they don't exist. Throws LastAdminError rather than leave nobody who can
// manage everything.
export async function setRoles(userId: number, roles: UserRole[]) {
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ roles: usersTable.roles })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!before) return undefined;

    if (before.roles.includes("admin") && !roles.includes("admin")) {
      // locks every admin, so two admins can't demote each other at once
      const admins = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(arrayContains(usersTable.roles, ["admin"]))
        .for("update");
      if (!admins.some((a) => a.id !== userId)) throw new LastAdminError();
    }

    const [user] = await tx
      .update(usersTable)
      .set({ roles: [...new Set(roles)] })
      .where(eq(usersTable.id, userId))
      .returning(publicColumns);
    return { user: user!, before: before.roles };
  });
}
