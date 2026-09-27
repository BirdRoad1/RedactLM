import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import z from "zod";
import { redact } from "../checkers/policy";
import { db } from "../db";
import {
  conversationsTable,
  messageDetectionsTable,
  messagesTable,
  usersTable,
} from "../db/schema";
import { describeSource, type ScoredDetection } from "./scan.service";

export async function createConversation(
  userId: number,
  client: string | null,
  id?: string,
) {
  return (
    await db
      .insert(conversationsTable)
      .values({ id, userId, client })
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

// Placeholders of values the user chose to send as written in this conversation
export async function getOverriddenPlaceholders(conversationId: string) {
  const [row] = await db
    .select({ placeholders: conversationsTable.overriddenPlaceholders })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));
  return new Set(row?.placeholders ?? []);
}

export async function addOverriddenPlaceholders(conversationId: string, placeholders: string[]) {
  if (!placeholders.length) return;
  await db
    .update(conversationsTable)
    .set({
      overriddenPlaceholders: sql`array(select distinct unnest(${conversationsTable.overriddenPlaceholders} || array[${sql.join(placeholders.map((p) => sql`${p}`), sql`, `)}]::text[]))`,
    })
    .where(eq(conversationsTable.id, conversationId));
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

// The deleted conversation, or undefined if it wasn't the user's
export async function deleteConversation(userId: number, id: string) {
  const convo = await getOwnedConversation(userId, id);
  if (!convo) return undefined;
  await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
  return convo;
}

// For reviewers: everyone's conversations, newest first, including ones where
// nothing was ever sent. `q` matches the owner's email or the title.
export async function listAllConversations({ q, limit = 200 }: { q?: string; limit?: number } = {}) {
  const like = q && `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const flagged = (action: "blocked" | "overridden" | "unchecked") =>
    count(sql`case when ${messagesTable.action} = ${action} then 1 end`);
  return await db
    .select({
      id: conversationsTable.id,
      title: conversationsTable.title,
      updatedAt: conversationsTable.updatedAt,
      user: usersTable.email,
      blocked: flagged("blocked"),
      overridden: flagged("overridden"),
      unchecked: flagged("unchecked"),
    })
    .from(conversationsTable)
    .innerJoin(usersTable, eq(conversationsTable.userId, usersTable.id))
    .leftJoin(messagesTable, eq(messagesTable.conversation_id, conversationsTable.id))
    .where(like ? or(ilike(usersTable.email, like), ilike(conversationsTable.title, like)) : undefined)
    .groupBy(conversationsTable.id, usersTable.email)
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit);
}

// For reviewers: every message as stored (masked), blocked attempts included,
// with what was found in each (never the text itself)
export async function reviewConversation(id: string) {
  if (!uuid.safeParse(id).success) return undefined;
  const [convo] = await db
    .select({ id: conversationsTable.id, title: conversationsTable.title, updatedAt: conversationsTable.updatedAt, client: conversationsTable.client, user: usersTable.email })
    .from(conversationsTable)
    .innerJoin(usersTable, eq(conversationsTable.userId, usersTable.id))
    .where(eq(conversationsTable.id, id));
  if (!convo) return undefined;

  const messages = await db
    .select({ id: messagesTable.id, role: messagesTable.role, content: messagesTable.content, action: messagesTable.action, model: messagesTable.model, createdAt: messagesTable.created_at })
    .from(messagesTable)
    .where(eq(messagesTable.conversation_id, id))
    .orderBy(asc(messagesTable.position));

  const detections = messages.length
    ? await db
        .select({
          messageId: messageDetectionsTable.messageId,
          reason: messageDetectionsTable.userFacingReason,
          location: messageDetectionsTable.location,
          confidence: messageDetectionsTable.confidence,
          outcome: messageDetectionsTable.outcome,
        })
        .from(messageDetectionsTable)
        .where(inArray(messageDetectionsTable.messageId, messages.map((m) => m.id)))
    : [];

  return {
    ...convo,
    messages: messages.map(({ id, content, ...m }) => ({
      ...m,
      content: content ?? "",
      detections: detections.filter((d) => d.messageId === id).map(({ messageId: _, ...d }) => d),
    })),
  };
}
