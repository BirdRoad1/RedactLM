import { eq } from "drizzle-orm";
import type z from "zod";
import { db } from "../db";
import { usersTable } from "../db/schema";
import type { createUserSchema } from "../schema/user.schema";

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`A user with email "${email}" already exists`);
  }
}

// Everything but the password hash
const publicColumns = {
  id: usersTable.id,
  email: usersTable.email,
  username: usersTable.username,
  isAdmin: usersTable.isAdmin,
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
          isAdmin: data.isAdmin,
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

// False for users that don't exist (e.g. deleted after their token was issued)
export async function isAdmin(userId: number) {
  const [user] = await db
    .select({ isAdmin: usersTable.isAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user?.isAdmin ?? false;
}
