import { db } from "../db";
import { conversationsTable, messagesTable } from "../db/schema";

export async function createConversation(
  userId: number,
  client: string | null,
) {
  return (
    await db
      .insert(conversationsTable)
      .values({ userId, client })
      .returning()
  )[0]!.id;
}

export async function addMessage(message: typeof messagesTable.$inferInsert) {
  await db.insert(messagesTable).values(message);
}
