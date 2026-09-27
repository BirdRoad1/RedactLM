import { and, arrayContains, asc, eq, isNotNull, isNull } from "drizzle-orm";
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
  deletedAt: usersTable.deletedAt,
};

// Users who haven't been deleted: the only ones who can log in or act
const active = isNull(usersTable.deletedAt);
const isUser = (userId: number) => and(eq(usersTable.id, userId), active);

export async function createUser(data: z.infer<typeof createUserSchema>) {
  try {
    return (
      await db
        .insert(usersTable)
        .values({
          email: data.email,
          username: data.username,
          passwordHash: data.password ? await Bun.password.hash(data.password) : null,
          roles: [...new Set(data.roles)],
        })
        .returning(publicColumns)
    )[0]!;
  } catch (err) {
    // email is the only unique column (among users who aren't deleted)
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
    .where(and(eq(usersTable.email, email), active));

  const matches = await Bun.password.verify(
    password,
    user?.passwordHash ?? (await dummyHash),
  );
  return user?.passwordHash && matches ? user.id : undefined;
}

export async function getUser(userId: number) {
  const [user] = await db.select(publicColumns).from(usersTable).where(isUser(userId));
  return user;
}

// `deleted`: include deleted users too
export async function listUsers({ deleted = false } = {}) {
  return await db.select(publicColumns).from(usersTable).where(deleted ? undefined : active).orderBy(asc(usersTable.id));
}

// Undefined for users that don't exist or were deleted (e.g. after their
// token was issued)
export async function getRoles(userId: number) {
  return (await getSessionUser(userId))?.roles;
}

// What checking a login token needs: the user's roles, and the time before
// which their tokens no longer count (a password change)
export async function getSessionUser(userId: number) {
  const [user] = await db
    .select({ roles: usersTable.roles, sessionsValidFrom: usersTable.sessionsValidFrom })
    .from(usersTable)
    .where(isUser(userId));
  return user;
}

// Sets a new password and signs the user out everywhere: tokens issued
// before now stop working. Undefined if there's no such (undeleted) user.
export async function setPassword(userId: number, password: string) {
  const [user] = await db
    .update(usersTable)
    .set({ passwordHash: await Bun.password.hash(password), sessionsValidFrom: new Date() })
    .where(isUser(userId))
    .returning(publicColumns);
  return user;
}

// Locks every active admin, so two admins can't demote or delete each other
// at once; throws if `userId` is the only one
async function keepAnAdmin(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: number) {
  const admins = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(arrayContains(usersTable.roles, ["admin"]), active))
    .for("update");
  if (!admins.some((a) => a.id !== userId)) throw new LastAdminError();
}

// The user with their new roles (and what they had before), or undefined if
// they don't exist. Throws LastAdminError rather than leave nobody who can
// manage everything.
export async function setRoles(userId: number, roles: UserRole[]) {
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ roles: usersTable.roles })
      .from(usersTable)
      .where(isUser(userId))
      .for("update");
    if (!before) return undefined;

    if (before.roles.includes("admin") && !roles.includes("admin")) await keepAnAdmin(tx, userId);

    const [user] = await tx
      .update(usersTable)
      .set({ roles: [...new Set(roles)] })
      .where(eq(usersTable.id, userId))
      .returning(publicColumns);
    return { user: user!, before: before.roles };
  });
}

// Soft delete: they can't log in, and their current session stops working;
// their chats and audit history stay, under their name. Undefined if there's
// no such (undeleted) user. Throws LastAdminError for the last admin.
export async function deleteUser(userId: number) {
  return await db.transaction(async (tx) => {
    const [user] = await tx.select(publicColumns).from(usersTable).where(isUser(userId)).for("update");
    if (!user) return undefined;
    if (user.roles.includes("admin")) await keepAnAdmin(tx, userId);
    const [deleted] = await tx
      .update(usersTable)
      .set({ deletedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning(publicColumns);
    return deleted!;
  });
}

// Undoes a delete. Throws EmailTakenError if someone else has the email now.
export async function restoreUser(userId: number) {
  try {
    const [user] = await db
      .update(usersTable)
      .set({ deletedAt: null })
      .where(and(eq(usersTable.id, userId), isNotNull(usersTable.deletedAt)))
      .returning(publicColumns);
    return user;
  } catch (err) {
    if ((err as { cause?: { code?: string } })?.cause?.code === "23505") {
      const [row] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
      throw new EmailTakenError(row!.email);
    }
    throw err;
  }
}
