import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    username: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 256 }),
    isAdmin: boolean('is_admin').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
});

export const roleEnum = pgEnum("message_role", ["system", "developer", "user", "assistant", "tool"]);
export const actionEnum = pgEnum("message_action", ["allowed", "warned", "redacted", "blocked"]);

export const conversationsTable = pgTable("conversations", {
    id: uuid().primaryKey().defaultRandom(),
    userId: integer("user_id")
        .notNull()
        .references(() => usersTable.id, { onDelete: "restrict" }),
    client: text(), // "jan", "our-frontend", ... from User-Agent or a header
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
}, (t) => [
    index("conversations_user_idx").on(t.userId),
]);

export const messagesTable = pgTable("messages", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    conversation_id: uuid().notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
    position: integer().notNull(),   // order within the conversation: 0, 1, 2...
    role: roleEnum().notNull(),

    content: text(),                 // with every detected span masked; never the raw sensitive text
    tool_calls: jsonb(),             // assistant tool calls, OpenAI shape
    tool_call_id: text(),            // for role = "tool"
    request_id: text(),              // chatcmpl-... id of the request that added it
    model: text(),                   // for assistant messages: which model answered
    action: actionEnum().notNull().default("allowed"),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("messages_conv_position_idx").on(t.conversation_id, t.position),
]);

export const trustEnum = pgEnum("backend_trust", ["local", "cloud"]);

export const backendsTable = pgTable("backends", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 64 }).notNull(),                   // human-readable: "Local vLLM", "OpenAI"
    slug: varchar({ length: 64 }).notNull(),                   // model prefix: "local-vllm", "openai"
    baseUrl: text("base_url").notNull(),                       // "http://vllm:8000/v1"
    apiKey: varchar("api_key", { length: 255 }),
    trust: trustEnum().notNull(),
    enabled: boolean().notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    timeoutMs: integer("timeout_ms").notNull().default(60_000),
    supportsStreaming: boolean("supports_streaming").notNull().default(true),
    stripParams: jsonb("strip_params").$type<string[]>().notNull().default([]),
    extraHeaders: jsonb("extra_headers").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    uniqueIndex("backends_slug_idx").on(t.slug),
    // at most one default backend
    uniqueIndex("backends_single_default_idx").on(t.isDefault).where(sql`${t.isDefault}`),
]);

export const failModeEnum = pgEnum("detector_fail_mode", ["block", "allow"]);

// Settings for the local-LLM PII detector. Single row (id = 1): only one model
// does this job at a time.
export const llmDetectorTable = pgTable("llm_detector", {
    id: integer().primaryKey().default(1),
    enabled: boolean().notNull().default(false),
    backendId: integer("backend_id").references(() => backendsTable.id, { onDelete: "set null" }),
    model: text(),                                              // model name on that backend, without the slug
    failMode: failModeEnum("fail_mode").notNull().default("block"), // what to do when the detector can't answer
    timeoutMs: integer("timeout_ms").notNull().default(15_000),
    instructions: text(),                                       // extra business-specific guidance for the model
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    check("llm_detector_single_row", sql`${t.id} = 1`),
]);

// Confidence thresholds deciding what happens to a detection. null = never.
// Single row (id = 1) of global defaults; checker_policies overrides per checker.
export const detectionPolicyTable = pgTable("detection_policy", {
    id: integer().primaryKey().default(1),
    warnAt: real("warn_at").default(0.3),
    blockAt: real("block_at").default(0.5),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    check("detection_policy_single_row", sql`${t.id} = 1`),
]);

// Replaces the global thresholds for one checker ("ssn", "phone", "local-llm", ...).
// No row = use the global thresholds.
export const checkerPoliciesTable = pgTable("checker_policies", {
    checker: varchar({ length: 64 }).primaryKey(),
    warnAt: real("warn_at"),
    blockAt: real("block_at"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const outcomeEnum = pgEnum("detection_outcome", ["ignored", "warned", "blocked"]);

// What was found in a message, without the sensitive text itself
export const messageDetectionsTable = pgTable("message_detections", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    messageId: integer("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
    checker: varchar({ length: 64 }).notNull(),
    userFacingReason: text("user_facing_reason").notNull(),
    confidence: real().notNull(),
    start: integer().notNull(),      // position in the original text, before masking
    end: integer().notNull(),
    outcome: outcomeEnum().notNull(),
}, (t) => [
    index("message_detections_message_idx").on(t.messageId),
]);
