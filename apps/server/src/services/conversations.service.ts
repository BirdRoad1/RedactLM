import { and, asc, count, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import z from "zod";
import { redact } from "../checkers/policy";
import { db } from "../db";
import {
  conversationsTable,
  messageDetectionsTable,
  messagesTable,
  usersTable,
} from "../db/schema";
import { checkSeals, roundConfidence, sealMessage } from "./message-chain";
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
// Each message is sealed onto the conversation's hash chain.
export async function saveMessage(
  message: Omit<typeof messagesTable.$inferInsert, "hash" | "created_at">,
  scored: ScoredDetection[] = [],
  attachmentNames: string[] = [],
) {
  const inText = scored.filter((s) => !s.source).map((s) => s.detection);
  const masked = message.content && inText.length ? redact(message.content, inText) : message.content;
  const content = [masked, ...attachmentNames.map((name) => `[Attached: ${name}]`)].filter(Boolean).join("\n\n") || masked;
  const detections = scored.map(({ detection: d, outcome, source }) => ({
    checker: d.checker,
    location: source ? describeSource(source) : null,
    userFacingReason: d.userFacingReason,
    confidence: roundConfidence(d.confidence),
    start: d.start,
    end: d.end,
    outcome,
  }));
  // set here rather than by the database, since the seal covers it
  const createdAt = new Date();

  await db.transaction(async (tx) => {
    // one message at a time per conversation, so each links to the one before
    await tx.select({ id: conversationsTable.id }).from(conversationsTable)
      .where(eq(conversationsTable.id, message.conversation_id)).for("update");
    const [previous] = await tx
      .select({ hash: messagesTable.hash })
      .from(messagesTable)
      .where(and(eq(messagesTable.conversation_id, message.conversation_id), sql`${messagesTable.position} < ${message.position}`))
      .orderBy(desc(messagesTable.position))
      .limit(1);

    const hash = sealMessage(
      {
        conversation_id: message.conversation_id,
        position: message.position,
        role: message.role,
        content: content ?? null,
        tool_calls: message.tool_calls ?? null,
        tool_call_id: message.tool_call_id ?? null,
        request_id: message.request_id ?? null,
        model: message.model ?? null,
        action: message.action ?? "allowed",
        edit_of: message.edit_of ?? null,
        created_at: createdAt,
        detections,
      },
      previous?.hash ?? null,
    );

    const [row] = await tx
      .insert(messagesTable)
      .values({ ...message, content, created_at: createdAt, hash })
      .returning({ id: messagesTable.id });

    if (detections.length) {
      await tx.insert(messageDetectionsTable).values(detections.map((d) => ({ messageId: row!.id, ...d })));
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

// The conversation as it stands, from messages stored in order: an edit
// replaces the message it edits and drops everything after it. Blocked
// attempts were never sent, so they're left out (and a blocked edit changes
// nothing).
export function currentThread<T extends { position: number; action: string; edit_of: number | null }>(messages: T[]): T[] {
  const thread: T[] = [];
  for (const message of messages) {
    if (message.action === "blocked") continue;
    if (message.edit_of !== null) {
      const at = thread.findIndex((m) => m.position === message.edit_of);
      if (at !== -1) thread.length = at;
    }
    thread.push(message);
  }
  return thread;
}

async function storedThread(conversationId: string) {
  return currentThread(
    await db
      .select({ position: messagesTable.position, role: messagesTable.role, content: messagesTable.content, action: messagesTable.action, model: messagesTable.model, edit_of: messagesTable.edit_of })
      .from(messagesTable)
      .where(eq(messagesTable.conversation_id, conversationId))
      .orderBy(asc(messagesTable.position)),
  );
}

// Whether the user's message at `position` can be edited: it has to be one of
// theirs in the conversation as it stands
export async function canEdit(conversationId: string, position: number) {
  return (await storedThread(conversationId)).some((m) => m.position === position && m.role === "user");
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
// message as it stands (already masked), so editing that message retitles it.
// Nothing sent yet (only blocked attempts): no title.
export async function touchConversation(conversationId: string) {
  const first = (await storedThread(conversationId)).find((m) => m.role === "user");
  const title = first?.content?.replace(/\s+/g, " ").slice(0, 80);
  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date(), ...(title !== undefined && { title }) })
    .where(eq(conversationsTable.id, conversationId));
}

// Newest first. Conversations where nothing was ever sent (only blocked
// attempts) have no title and aren't listed.
export async function listConversations(userId: number) {
  const rows = await db
    .select({ id: conversationsTable.id, title: conversationsTable.title, updatedAt: conversationsTable.updatedAt })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.userId, userId), isNotNull(conversationsTable.title)))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(200);
  // every title is set: the query leaves out conversations without one
  return rows.map((row) => ({ ...row, title: row.title! }));
}

// The conversation as it stands (masked): without blocked attempts, which were
// never sent, or messages replaced by an edit. `position` is what an edit names.
export async function getConversation(userId: number, id: string) {
  const convo = await getOwnedConversation(userId, id);
  if (!convo) return undefined;

  const messages = await storedThread(id);

  return {
    id: convo.id,
    title: convo.title,
    updatedAt: convo.updatedAt,
    // the model the user last picked (assistant rows hold the backend's own name)
    model: messages.findLast((m) => m.role === "user")?.model ?? null,
    messages: messages.map(({ position, role, content, action, edit_of }) => ({
      position,
      role,
      content: content ?? "",
      action,
      edited: edit_of !== null,
    })),
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
// with what was found in each (never the text itself), and whether each still
// matches its seal
export async function reviewConversation(id: string) {
  if (!uuid.safeParse(id).success) return undefined;
  const [convo] = await db
    .select({ id: conversationsTable.id, title: conversationsTable.title, updatedAt: conversationsTable.updatedAt, client: conversationsTable.client, user: usersTable.email })
    .from(conversationsTable)
    .innerJoin(usersTable, eq(conversationsTable.userId, usersTable.id))
    .where(eq(conversationsTable.id, id));
  if (!convo) return undefined;

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversation_id, id))
    .orderBy(asc(messagesTable.position));

  const detections = messages.length
    ? await db
        .select()
        .from(messageDetectionsTable)
        .where(inArray(messageDetectionsTable.messageId, messages.map((m) => m.id)))
    : [];
  const detectionsOf = (messageId: number) =>
    detections.filter((d) => d.messageId === messageId).map(({ id: _, messageId: __, ...d }) => d);

  const seals = checkSeals(messages.map((m) => ({ ...m, detections: detectionsOf(m.id) })));
  const standing = new Set(currentThread(messages).map((m) => m.position));

  return {
    ...convo,
    messages: messages.map((m, i) => ({
      role: m.role,
      content: m.content ?? "",
      action: m.action,
      model: m.model,
      createdAt: m.created_at,
      seal: seals[i]!,
      position: m.position,
      editOf: m.edit_of,
      // sent, then replaced by an edit (blocked attempts were never sent)
      replaced: m.action !== "blocked" && !standing.has(m.position),
      detections: detectionsOf(m.id).map((d) => ({
        reason: d.userFacingReason,
        location: d.location,
        confidence: d.confidence,
        outcome: d.outcome,
      })),
    })),
  };
}
