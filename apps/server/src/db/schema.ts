import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

// The roles live in the shared package (the web app lists them too)
import { userRoles, type UserRole } from "@llm-thingy/shared";
export { userRoles, type UserRole };
export const userRoleEnum = pgEnum("user_role", userRoles);

export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    username: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 256 }),
    roles: userRoleEnum().array().notNull().default(sql`'{}'`),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Soft delete: set = can't log in or use the app, but their chats and
    // audit history keep their name. The email is free for a new account.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Login tokens issued before this are refused: set when the password
    // changes, so it signs the user out everywhere
    sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true }),
}, (t) => [
    uniqueIndex("users_email_active_idx").on(t.email).where(sql`${t.deletedAt} is null`),
]);

export const roleEnum = pgEnum("message_role", ["system", "developer", "user", "assistant", "tool"]);
export const actionEnum = pgEnum("message_action", ["allowed", "warned", "redacted", "blocked", "overridden", "unchecked"]);

export const conversationsTable = pgTable("conversations", {
    id: uuid().primaryKey().defaultRandom(),
    userId: integer("user_id")
        .notNull()
        .references(() => usersTable.id, { onDelete: "restrict" }),
    client: text(), // "jan", "our-frontend", ... from User-Agent or a header
    title: text(),  // from the first message that was actually sent; null until then
    // Placeholders (never the values) of what the user overrode replacing:
    // those values were sent as written, so later turns send them as written too
    overriddenPlaceholders: text("overridden_placeholders").array().notNull().default(sql`'{}'`),
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
    // An edit: the position of the (user) message this one replaces. Nothing
    // is changed or deleted; the conversation as it stands is worked out from
    // these (currentThread in conversations.service).
    edit_of: integer(),

    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Keyed hash of this message, its detections and the previous message's
    // hash (services/message-chain.ts). Null for messages saved before sealing.
    hash: varchar({ length: 64 }),
}, (t) => [
    uniqueIndex("messages_conv_position_idx").on(t.conversation_id, t.position),
]);

export const trustEnum = pgEnum("backend_trust", ["local", "cloud"]);
// How to talk to it: OpenAI's chat completions, or Anthropic's Messages API
// (requests and replies are translated to and from the OpenAI shape)
export const backendApiEnum = pgEnum("backend_api", ["openai", "anthropic"]);

export const backendsTable = pgTable("backends", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 64 }).notNull(),                   // human-readable: "Local vLLM", "OpenAI"
    slug: varchar({ length: 64 }).notNull(),                   // model prefix: "local-vllm", "openai"
    baseUrl: text("base_url").notNull(),                       // "http://vllm:8000/v1"
    api: backendApiEnum().notNull().default("openai"),
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
    maxChars: integer("max_chars").notNull().default(10_000),   // reads at most this much of a message or file
    instructions: text(),                                       // extra business-specific guidance for the model
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    check("llm_detector_single_row", sql`${t.id} = 1`),
]);

// What reaching blockAt does: stop the message, or swap the finding for a
// placeholder where the content can be edited cleanly (text, text files)
export const blockModeEnum = pgEnum("block_mode", ["block", "replace"]);

// Confidence thresholds deciding what happens to a detection. null = never.
// Single row (id = 1) of global defaults; checker_policies overrides per checker.
export const detectionPolicyTable = pgTable("detection_policy", {
    id: integer().primaryKey().default(1),
    mode: blockModeEnum().notNull().default("block"),
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

export const outcomeEnum = pgEnum("detection_outcome", ["ignored", "warned", "redacted", "blocked"]);

// What was found in a message, without the sensitive text itself
export const messageDetectionsTable = pgTable("message_detections", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    messageId: integer("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
    checker: varchar({ length: 64 }).notNull(),
    userFacingReason: text("user_facing_reason").notNull(),
    confidence: real().notNull(),
    location: text(),                // attachment it was found in, e.g. "report.pdf, page 2"; null = message text
    start: integer().notNull(),      // position in the original text (or the attachment's page), before masking
    end: integer().notNull(),
    outcome: outcomeEnum().notNull(),
}, (t) => [
    index("message_detections_message_idx").on(t.messageId),
]);

// Things admins may need to look back at. Entries outlive the users and
// conversations they mention.
export const auditLogTable = pgTable("audit_log", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversationsTable.id, { onDelete: "set null" }),
    event: varchar({ length: 64 }).notNull(),   // "partially_checked", ...
    details: jsonb().notNull(),                 // never contains the checked text itself
}, (t) => [
    index("audit_log_created_idx").on(t.createdAt),
]);

// Terms the company keeps private, checked in every message by the rules
// only (never sent to the LLM detector). Stored normalized: lowercase,
// letters and numbers only, single spaces ("What's up?" → "whats up").
export const keywordsTable = pgTable("keywords", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    keyword: text().notNull(),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("keywords_keyword_idx").on(t.keyword),
]);

// Single sign-on through OpenID Connect providers (Google, Microsoft Entra
// ID, Okta, ...). Only users an admin already created can sign in this way:
// the provider's verified email is matched to theirs the first time.
export const ssoProvidersTable = pgTable("sso_providers", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 64 }).notNull(),                    // on the button: "Continue with Google"
    slug: varchar({ length: 64 }).notNull(),                    // in URLs: /auth/sso/google/start
    issuer: text().notNull(),                                   // "https://accounts.google.com"
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),              // write-only through the API
    allowedDomains: text("allowed_domains").array().notNull().default(sql`'{}'`), // empty = any
    enabled: boolean().notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
    uniqueIndex("sso_providers_slug_idx").on(t.slug),
]);

// Which provider account is which user, by the provider's stable id for the
// person ("sub"), so a later email change there doesn't lose the link
export const ssoIdentitiesTable = pgTable("sso_identities", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    providerId: integer("provider_id").notNull().references(() => ssoProvidersTable.id, { onDelete: "cascade" }),
    subject: text().notNull(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    email: varchar({ length: 255 }).notNull(),                  // as the provider gave it when linked
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex("sso_identities_subject_idx").on(t.providerId, t.subject),
]);
