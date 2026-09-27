// The TestUser the load tests sign in as. Created if missing, undeleted if
// deleted, and given a fresh random password each run, so no known password
// sits in the database. Its chats and audit entries can be cleared after.
import { eq, sql } from "drizzle-orm";
import { db } from "../../src/db";
import { auditLogTable, conversationsTable, usersTable } from "../../src/db/schema";

export const TEST_EMAIL = "loadtest@test.local";

// The user's id and this run's password
export async function ensureTestUser() {
  const password = crypto.randomUUID();
  const passwordHash = await Bun.password.hash(password);
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, TEST_EMAIL));
  if (existing) {
    await db.update(usersTable).set({ passwordHash, deletedAt: null, roles: [] }).where(eq(usersTable.id, existing.id));
    return { id: existing.id, password };
  }
  const [created] = await db
    .insert(usersTable)
    .values({ email: TEST_EMAIL, username: "TestUser", passwordHash, roles: [] })
    .returning({ id: usersTable.id });
  return { id: created!.id, password };
}

// Removes the user's conversations and everything the audit log holds about them
export async function clearTestUserData(userId: number) {
  const convos = db.select({ id: conversationsTable.id }).from(conversationsTable).where(eq(conversationsTable.userId, userId));
  await db.delete(auditLogTable).where(sql`${auditLogTable.userId} = ${userId} or ${auditLogTable.conversationId} in (${convos}) or ${auditLogTable.details}->>'email' = ${TEST_EMAIL}`);
  await db.delete(conversationsTable).where(eq(conversationsTable.userId, userId));
}
