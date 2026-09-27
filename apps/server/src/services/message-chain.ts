import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env/env";

// Each stored message is sealed with a keyed hash of itself and of the
// message before it in its conversation, so editing, deleting or reordering
// a stored message breaks the chain from there on. The key comes from the
// server's secret: someone who can only write to the database can't reseal
// what they changed. (Dropping the newest messages of a conversation isn't
// caught: nothing after them is left to break.)
const key = createHmac("sha256", env.JWT_SECRET).update("llm-thingy:message-chain").digest();

export type SealedDetection = {
  checker: string;
  userFacingReason: string;
  confidence: number;
  location: string | null;
  start: number;
  end: number;
  outcome: string;
};

// Everything about a message a reviewer relies on
export type SealedMessage = {
  conversation_id: string;
  position: number;
  role: string;
  content: string | null;
  tool_calls: unknown;
  tool_call_id: string | null;
  request_id: string | null;
  model: string | null;
  action: string;
  created_at: Date;
  detections: SealedDetection[];
};

// Confidence is stored as a 4-byte float, which doesn't give back the exact
// number it was given; rounded to this many places it does
export const CONFIDENCE_PLACES = 3;
export const roundConfidence = (c: number) => Number(c.toFixed(CONFIDENCE_PLACES));

// JSON with object keys sorted: jsonb columns don't keep key order
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// `previous` is the hash of the message before it, or null for the first
// sealed message of a conversation
export function sealMessage(m: SealedMessage, previous: string | null) {
  // named field by field: rows read back carry more (id, the hash itself)
  const detections = m.detections
    .map((d) =>
      canonical({
        checker: d.checker,
        userFacingReason: d.userFacingReason,
        confidence: d.confidence.toFixed(CONFIDENCE_PLACES),
        location: d.location,
        start: d.start,
        end: d.end,
        outcome: d.outcome,
      }),
    )
    .sort();
  const body = canonical({
    conversation_id: m.conversation_id,
    position: m.position,
    role: m.role,
    content: m.content,
    tool_calls: m.tool_calls ?? null,
    tool_call_id: m.tool_call_id,
    request_id: m.request_id,
    model: m.model,
    action: m.action,
    created_at: m.created_at.toISOString(),
    detections,
  });
  return createHmac("sha256", key).update(previous ?? "").update("\0").update(body).digest("hex");
}

// "intact": matches its seal. "unsealed": saved before sealing began, so
// there's nothing to check. "broken": changed, or a message before it was.
export type Seal = "intact" | "unsealed" | "broken";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Checks a conversation's messages, in order
export function checkSeals(messages: (SealedMessage & { hash: string | null })[]): Seal[] {
  let previous: string | null = null;
  let sealing = false; // once sealing has begun, every later message must have a seal
  return messages.map((m) => {
    if (m.hash === null) {
      if (!sealing) return "unsealed";
      previous = null;
      return "broken"; // its seal was removed
    }
    sealing = true;
    const ok = same(sealMessage(m, previous), m.hash);
    previous = m.hash;
    return ok ? "intact" : "broken";
  });
}
