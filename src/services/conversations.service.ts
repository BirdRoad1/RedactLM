import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import z from "zod";
import { redact } from "../checkers/policy";
import { db } from "../db";
import {
  conversationsTable,
  messageDetectionsTable,
  messagesTable,
} from "../db/schema";
import { describeSource, type ScoredDetection } from "./scan.service";

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

// Saves a message with every detected span masked, plus what was detected
// (never the detected text itself). Attachments aren't stored, only their names.
export async function saveMessage(
  message: typeof messagesTable.$inferInsert,
  scored: ScoredDetection[] = [],
  attachmentNames: string[] = [],
) {
  const inText = scored.filter((s) => !s.source).map((s) => s.detection);
  const masked = message.content && inText.length ? redact(message.content, inText) : message.content;
  const content = [masked, ...attachmentNames.map((name) => `[Attached: ${name}]`)].filter(Boolean).join("\n\n") || masked;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messagesTable)
      .values({ ...message, content })
      .returning({ id: messagesTable.id });

    if (scored.length) {
      await tx.insert(messageDetectionsTable).values(
        scored.map(({ detection: d, outcome, source }) => ({
          messageId: row!.id,
          checker: d.checker,
          location: source ? describeSource(source) : null,
          userFacingReason: d.userFacingReason,
          confidence: d.confidence,
          start: d.start,
          end: d.end,
          outcome,
        })),
      );
    }
  });
}

const uuid = z.uuid();

// The conversation if it exists and belongs to the user, else undefined
export async function getOwnedConversation(userId: number, id: string) {
  if (!uuid.safeParse(id).success) return undefined;
  const [convo] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)));
  return convo;
}

export async function nextPosition(conversationId: string) {
  const [row] = await db
    .select({ max: sql<number | null>`max(${messagesTable.position})` })
    .from(messagesTable)
    .where(eq(messagesTable.conversation_id, conversationId));
  return (row?.max ?? -1) + 1;
}

// Moves the conversation to the top of the list, and titles it after its first
// message that was actually sent (already masked) if it has no title yet
export async function touchConversation(conversationId: string) {
  const firstSent = db
    .select({ text: sql`left(regexp_replace(${messagesTable.content}, ${String.raw`\s+`}, ' ', 'g'), 80)` })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.conversation_id, conversationId),
      eq(messagesTable.role, "user"),
      ne(messagesTable.action, "blocked"),
    ))
    .orderBy(asc(messagesTable.position))
    .limit(1);

  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date(), title: sql`coalesce(${conversationsTable.title}, (${firstSent}))` })
    .where(eq(conversationsTable.id, conversationId));
}

// Newest first. Conversations where nothing was ever sent (only blocked
// attempts) have no title and aren't listed.
export async function listConversations(userId: number) {
  return await db
    .select({ id: conversationsTable.id, title: conversationsTable.title, updatedAt: conversationsTable.updatedAt })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.userId, userId), isNotNull(conversationsTable.title)))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(200);
}

// The messages as stored (masked), without blocked attempts, which were never sent
export async function getConversation(userId: number, id: string) {
  const convo = await getOwnedConversation(userId, id);
  if (!convo) return undefined;

  const messages = await db
    .select({ role: messagesTable.role, content: messagesTable.content, action: messagesTable.action, model: messagesTable.model })
    .from(messagesTable)
    .where(and(eq(messagesTable.conversation_id, id), ne(messagesTable.action, "blocked")))
    .orderBy(asc(messagesTable.position));

  return {
    id: convo.id,
    title: convo.title,
    updatedAt: convo.updatedAt,
    // the model the user last picked (assistant rows hold the backend's own name)
    model: messages.findLast((m) => m.role === "user")?.model ?? null,
    messages: messages.map(({ role, content, action }) => ({ role, content: content ?? "", action })),
  };
}

export async function deleteConversation(userId: number, id: string) {
  if (!(await getOwnedConversation(userId, id))) return false;
  await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
  return true;
}
