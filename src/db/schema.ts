import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    username: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 256 }),
    isAdmin: boolean('is_admin').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
});

export const roleEnum = pgEnum("message_role", ["system", "developer", "user", "assistant", "tool"]);
export const actionEnum = pgEnum("message_action", ["allowed", "redacted", "blocked"]);

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

    content: text(),                 // REDACTED text, i.e. what actually left the building
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