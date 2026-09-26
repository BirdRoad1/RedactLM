import { eq } from "drizzle-orm";
import { db } from "../db";
import { backendsTable, llmDetectorTable } from "../db/schema";
import type { UpdateLlmDetector } from "../schema/llm-detector.schema";

export type LlmDetectorConfig = typeof llmDetectorTable.$inferSelect;

export class InvalidDetectorConfigError extends Error {}

// Defaults when nothing has been saved yet: off
const defaults: LlmDetectorConfig = {
  id: 1,
  enabled: false,
  backendId: null,
  model: null,
  failMode: "block",
  minConfidence: 0.5,
  timeoutMs: 15_000,
  instructions: null,
  updatedAt: new Date(0),
};

export async function getLlmDetectorConfig() {
  const [row] = await db.select().from(llmDetectorTable).where(eq(llmDetectorTable.id, 1));
  return row ?? defaults;
}

// The detector reads every prompt, so it may only ever run on a local backend
export async function updateLlmDetectorConfig(changes: UpdateLlmDetector) {
  const next = { ...(await getLlmDetectorConfig()), ...changes };

  if (next.backendId !== null) {
    const [backend] = await db.select().from(backendsTable).where(eq(backendsTable.id, next.backendId));
    if (!backend) {
      throw new InvalidDetectorConfigError(`Backend ${next.backendId} does not exist`);
    }
    if (backend.trust !== "local") {
      throw new InvalidDetectorConfigError(
        `Backend "${backend.slug}" is not local; the detector sees every prompt, so it must run on a local backend`,
      );
    }
  }
  if (next.enabled && (next.backendId === null || next.model === null)) {
    throw new InvalidDetectorConfigError("Set backendId and model before enabling the detector");
  }

  const { id, updatedAt, ...values } = next;
  return (
    await db
      .insert(llmDetectorTable)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: llmDetectorTable.id, set: values })
      .returning()
  )[0]!;
}
