import { redact } from "../checkers/policy";
import { db } from "../db";
import {
  conversationsTable,
  messageDetectionsTable,
  messagesTable,
} from "../db/schema";
import type { ScoredDetection } from "./scan.service";

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
// (never the detected text itself)
export async function saveMessage(
  message: typeof messagesTable.$inferInsert,
  scored: ScoredDetection[] = [],
) {
  const detections = scored.map((s) => s.detection);
  const content =
    message.content && detections.length ? redact(message.content, detections) : message.content;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messagesTable)
      .values({ ...message, content })
      .returning({ id: messagesTable.id });

    if (scored.length) {
      await tx.insert(messageDetectionsTable).values(
        scored.map(({ detection: d, outcome }) => ({
          messageId: row!.id,
          checker: d.checker,
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
