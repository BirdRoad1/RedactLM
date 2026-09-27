// Compile-time only: what the server returns has to fit the API types the
// web app uses (packages/shared/src/api.ts). Each line takes a service's
// result, turns it into what it looks like as JSON (dates become strings),
// and checks it fits; a mismatch fails the type check (tsc), not at runtime.
import type * as Api from "@llm-thingy/shared";
import type { listAudit } from "./services/audit.service";
import type { getConversation, listAllConversations, listConversations, reviewConversation } from "./services/conversations.service";
import type { describePolicy } from "./services/detection-policy.service";
import type { addKeywords, listKeywords } from "./services/keywords.service";
import type { getLlmDetectorConfig } from "./services/llm-detector.service";
import type { getUser, listUsers } from "./services/users.service";

// A value as it arrives after JSON.stringify
type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
type Returns<F extends (...args: never[]) => unknown> = Json<NonNullable<Awaited<ReturnType<F>>>>;
// fails to compile unless A fits B
type Fits<A extends B, B> = A;

export type Contract = [
  Fits<Returns<typeof getUser>, Api.Me>,
  Fits<Returns<typeof listUsers>, Api.User[]>,
  Fits<Returns<typeof listKeywords>, Api.Keyword[]>,
  Fits<Returns<typeof addKeywords>, Api.AddKeywordsResult>,
  Fits<Returns<typeof listAudit>, Api.AuditEntry[]>,
  Fits<Returns<typeof listConversations>, Api.ConversationSummary[]>,
  Fits<Returns<typeof getConversation>, Api.Conversation>,
  Fits<Returns<typeof listAllConversations>, Api.ReviewSummary[]>,
  Fits<Returns<typeof reviewConversation>, Api.ReviewConversation>,
  Fits<Returns<typeof getLlmDetectorConfig>, Api.LlmDetector>,
  Fits<Returns<typeof describePolicy>, Api.DetectionPolicy>,
];
