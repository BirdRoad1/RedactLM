import z from "zod";
import { loginResponse, loginSchema } from "../schema/auth.schema";
import { backendIdSchema, createBackendSchema } from "../schema/backends.schema";
import {
  completionErrorResponse,
  completionsChunk,
  completionsResponse,
} from "../schema/completion-response.schema";
import { completionsRequest } from "../schema/completions-request.schema";
import { modelsList } from "../schema/models-request.schema";
import { thresholdsSchema, updateDefaultsSchema } from "../schema/detection-policy.schema";
import {
  checkFileRequestSchema,
  checkFileResponseSchema,
  checkRequestSchema,
  checkResponseSchema,
} from "../schema/check.schema";
import { updateLlmDetectorSchema } from "../schema/llm-detector.schema";
import { createUserSchema, roleSchema, setRolesSchema } from "../schema/user.schema";
import { addKeywordsSchema } from "../schema/keywords.schema";
import { createSsoProviderSchema, updateSsoProviderSchema } from "../schema/sso.schema";
import type { UserRole } from "../db/schema";

// Hand-assembled OpenAPI doc for dev use. Bodies come from the real Zod
// schemas, so those stay in sync; the paths below need updating by hand when
// routes change.

const json = (schema: z.ZodType, io: "input" | "output" = "output") => ({
  "application/json": { schema: z.toJSONSchema(schema, { io, unrepresentable: "any" }) },
});

const error = (description: string) => ({ description, content: json(completionErrorResponse) });

const unauthorized = { 401: error("Missing or invalid token") };
// admins hold every role
const needs = (role: UserRole) => ({ ...unauthorized, 403: error(`Needs the \`${role}\` role (or \`admin\`)`) });

const backend = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  baseUrl: z.string(),
  apiKey: z.string().nullable().describe("Masked: only the last 4 characters are shown"),
  trust: z.enum(["local", "cloud"]),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  timeoutMs: z.number().int(),
  supportsStreaming: z.boolean(),
  stripParams: z.array(z.string()),
  extraHeaders: z.record(z.string(), z.string()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const user = z.object({
  id: z.number().int(),
  email: z.string(),
  username: z.string(),
  roles: z.array(roleSchema),
  createdAt: z.string(),
  deletedAt: z.string().nullable().describe("Set once deleted (soft delete)"),
});

const llmDetector = z.object({
  id: z.literal(1),
  enabled: z.boolean(),
  backendId: z.number().int().nullable(),
  model: z.string().nullable(),
  failMode: z.enum(["block", "allow"]),
  timeoutMs: z.number().int(),
  maxChars: z.number().int(),
  instructions: z.string().nullable(),
  updatedAt: z.string(),
});

const threshold = z.number().nullable();
const detectionPolicy = z.object({
  mode: z.enum(["block", "replace"]),
  warnAt: threshold,
  blockAt: threshold,
  checkers: z.array(
    z.object({ checker: z.string(), warnAt: threshold, blockAt: threshold, overridden: z.boolean() }),
  ),
});

const flaggedDetection = z.object({
  messageIndex: z.number().int(),
  checker: z.string(),
  title: z.string(),
  reason: z.string(),
  explanation: z.string(),
  confidence: z.number(),
  start: z.number().int(),
  end: z.number().int(),
});

const bearer = [{ bearerAuth: [] }];

const auditFilterParams = [
  { name: "event", in: "query", required: false, description: "One event, or several separated by commas", schema: { type: "string" }, example: "message_blocked,block_overridden" },
  { name: "user", in: "query", required: false, description: "Part of the acting user's email (or the email tried on a login)", schema: { type: "string" } },
  { name: "conversation", in: "query", required: false, description: "Only entries about this conversation", schema: { type: "string", format: "uuid" } },
  { name: "from", in: "query", required: false, description: "At or after this time (ISO 8601 with a time zone)", schema: { type: "string", format: "date-time" } },
  { name: "to", in: "query", required: false, description: "Before this time (ISO 8601 with a time zone)", schema: { type: "string", format: "date-time" } },
];

export const openApiDoc = {
  openapi: "3.1.0",
  info: {
    title: "LLM Thingy",
    version: "dev",
    description:
      "PII-filtering proxy for OpenAI-compatible LLM backends. Create the first admin with `bun run create-admin <email> <username>`, get a token from `POST /auth/login`, then click **Authorize**. \n\nAccess is by role, and `admin` holds them all: `override` may send messages as written, neither blocked nor replaced (`X-Override-Block`), `no_check` sends without any checks (as does `admin`), `review_chats` reads everyone's conversations under `/review`, `view_audit` reads `/audit-log`, `manage_users` manages `/users` (handing out only roles they hold), `manage_backends` manages `/backends`, `manage_settings` manages `/settings`, and `manage_keywords` sees and changes `/keywords`.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  paths: {
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in and get a token",
        description: "The token expires at `expiresAt` (`JWT_TTL_SECONDS`, 8 hours by default); log in again after that.",
        security: [],
        requestBody: { required: true, content: json(loginSchema, "input") },
        responses: {
          200: { description: "Logged in", content: json(loginResponse) },
          400: { description: "Invalid request" },
          401: { description: "Invalid email or password" },
        },
      },
    },
    "/auth/sso": {
      get: {
        tags: ["Auth"],
        summary: "Single sign-on options for the login page",
        security: [],
        responses: { 200: { description: "Enabled providers", content: json(z.array(z.object({ slug: z.string(), name: z.string() }))) } },
      },
    },
    "/auth/sso/{slug}/start": {
      get: {
        tags: ["Auth"],
        summary: "Start signing in with a provider (browser navigation)",
        description: "Redirects to the provider (OpenID Connect authorization code flow with PKCE, state and nonce; the state rides in a signed 10-minute cookie). The provider sends the browser back to `/auth/sso/{slug}/callback`, which redirects to the web app at `APP_URL/sso#token=...&expiresAt=...`, or `#error=...`. Only users who already have an account can sign in: the provider's verified email is matched to theirs the first time, and the provider's id for them after that.",
        security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: { 302: { description: "To the provider, or back to the web app with an error" } },
      },
    },
    "/me": {
      get: {
        tags: ["Auth"],
        summary: "The logged-in user",
        security: bearer,
        responses: { ...unauthorized, 200: { description: "User", content: json(user) } },
      },
    },
    "/check": {
      post: {
        tags: ["Checks"],
        summary: "Check text while it's being typed",
        description:
          "Runs the static checks only: no model is called and nothing is stored, so it's cheap enough to call as the user types (debounce it). Returns issues that would warn or block under the current detection policy, in plain language. The LLM detector still runs when the message is actually sent, so sending can find more.",
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(checkRequestSchema, { io: "input" }),
              example: { text: "Call me at 212-555-1234" },
            },
          },
        },
        responses: {
          ...unauthorized,
          200: { description: "Issues found", content: json(checkResponseSchema) },
          400: { description: "Missing or too-long text" },
        },
      },
    },
    "/conversations": {
      get: {
        tags: ["Conversations"],
        summary: "Your conversations, newest first",
        description: "Only conversations where something was actually sent are listed. Titles come from the first sent message, with sensitive parts masked.",
        security: bearer,
        responses: {
          ...unauthorized,
          200: {
            description: "Conversations",
            content: json(z.array(z.object({ id: z.string(), title: z.string(), updatedAt: z.string() }))),
          },
        },
      },
    },
    "/conversations/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        tags: ["Conversations"],
        summary: "One of your conversations",
        description: "Messages as stored: detected sensitive parts appear as `[REDACTED: <what it was>]`. Blocked attempts are left out, since they were never sent.",
        security: bearer,
        responses: {
          ...unauthorized,
          200: {
            description: "Conversation",
            content: json(
              z.object({
                id: z.string(),
                title: z.string().nullable(),
                updatedAt: z.string(),
                model: z.string().nullable(),
                messages: z.array(z.object({ role: z.string(), content: z.string(), action: z.string() })),
              }),
            ),
          },
          404: { description: "Not found, or not yours" },
        },
      },
      delete: {
        tags: ["Conversations"],
        summary: "Delete one of your conversations",
        security: bearer,
        responses: { ...unauthorized, 204: { description: "Deleted" }, 404: { description: "Not found, or not yours" } },
      },
    },
    "/check/file": {
      post: {
        tags: ["Checks"],
        summary: "Check an attachment before sending it",
        description:
          "Reads the file locally (OCR for images and each PDF page, plus the text stored in the PDF, which catches text that is in the file but not visible; plain-text files as-is) and runs the static checks. No AI model is involved and nothing is stored. Up to 20 MB and 50 pages. Sending re-checks everything, including with the LLM detector.",
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(checkFileRequestSchema, { io: "input" }),
              example: { filename: "intake.pdf", data: "data:application/pdf;base64,JVBERi0..." },
            },
          },
        },
        responses: {
          ...unauthorized,
          200: { description: "Issues found, with the page they're on", content: json(checkFileResponseSchema) },
          400: error("Unsupported, too large, unreadable or too many pages; the message says which"),
        },
      },
    },
    "/audit-log": {
      get: {
        tags: ["Audit"],
        summary: "Audit log entries, newest first",
        description:
          "Newest first, `limit` at a time (200 by default, at most 500); pass the last id as `before` for the next page. Filters combine. `summary` describes each entry in plain language; entries never contain checked text, passwords or API keys. Events: message_blocked, message_warned, message_replaced, assistant_pii, partially_checked, attachment_refused, detector_unavailable, conversation_deleted, settings_changed, backend_created, backend_deleted, user_created, user_roles_changed, user_deleted, user_restored, keywords_added, keywords_deleted, audit_exported, block_overridden, sent_unchecked, conversation_reviewed, login_succeeded, login_failed.",
        security: bearer,
        parameters: [
          ...auditFilterParams,
          { name: "before", in: "query", required: false, description: "Only entries older than this id (paging)", schema: { type: "integer" } },
          { name: "limit", in: "query", required: false, description: "How many, 1–500 (default 200)", schema: { type: "integer" } },
        ],
        responses: {
          ...needs("view_audit"),
          400: { description: "Invalid filters" },
          200: {
            description: "Entries",
            content: json(z.array(z.object({
              id: z.number().int(),
              createdAt: z.string(),
              user: z.string().nullable(),
              conversationId: z.string().nullable(),
              event: z.string(),
              details: z.record(z.string(), z.unknown()),
              summary: z.string(),
            }))),
          },
        },
      },
    },
    "/audit-log/export.csv": {
      get: {
        tags: ["Audit"],
        summary: "Download every matching entry as CSV",
        description: "Same filters as `/audit-log`, but all matching entries, newest first. Columns: id, time (ISO), user, event, summary, conversation, details (JSON). Cells that would start a spreadsheet formula get a leading apostrophe. The export is itself recorded (`audit_exported`).",
        security: bearer,
        parameters: auditFilterParams,
        responses: {
          ...needs("view_audit"),
          200: { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } },
          400: { description: "Invalid filters" },
        },
      },
    },
    "/v1/chat/completions": {
      post: {
        tags: ["OpenAI-compatible"],
        summary: "Create a chat completion",
        parameters: [
          {
            name: "X-Conversation-Id",
            in: "header",
            required: false,
            description: "Continue this conversation: only the last message is stored. Without it, a new conversation is created from all messages. The response's X-Conversation-Id header says which conversation was used.",
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "X-Override-Block",
            in: "header",
            required: false,
            description: "`true` sends the new messages as written: nothing blocks them, and in replace mode nothing in them is replaced. Later turns of the conversation keep those values as written too (only their placeholders are remembered). Needs the `override` role (403 otherwise). What was overridden is listed in `X-PII-Overridden` and recorded in the audit log.",
            schema: { type: "string", enum: ["true"] },
          },
        ],
        description:
          '`model` is `"<backend slug>/<model>"`, or a bare `"<model>"` for the default backend. User messages may carry attachments as `file` parts with `file_data` (PDF, image or plain text, up to 20 MB / 50 pages) or `image_url` parts with a `data:` URL; they are read locally (OCR, plus the text stored in PDFs) and checked like text. Linked images, file ids and other file types are refused, since they cannot be checked. With `stream: true` the response is Server-Sent Events of completion chunks, ending in `data: [DONE]`.\n\nUser messages are checked against the detection policy (`/settings/detection-policy`): detections at or above `blockAt` reject the request, those at or above `warnAt` let it through and are listed in the `X-PII-Warnings` header. Stored messages have every detected span masked.\n\nUsers with `no_check` (and admins) skip the checks: nothing is refused or sent to the LLM detector, the send is recorded in the audit log, and stored messages are still masked by the rule-based checks. For users with `override`, blocks found only in earlier messages of a continued conversation don\'t stop it, since those got there by an override.',
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(completionsRequest, { io: "input" }),
              example: {
                model: "local-vllm/llama-3.1-8b",
                messages: [{ role: "user", content: "Hello!" }],
              },
            },
          },
        },
        responses: {
          ...unauthorized,
          200: {
            description: "Completion, or an SSE stream when `stream` is true",
            headers: {
              "X-PII-Replaced": {
                description: "Present in replace mode when something was swapped for a placeholder before sending. JSON array of `{messageIndex, title, start, end, source?, placeholder}` (positions in the original text; never the value itself).",
                schema: { type: "string" },
              },
              "X-Partially-Checked": {
                description: "Present when a new message or attachment was longer than the LLM detector reads (`maxChars`): it passed, but only the rule-based checks covered all of it. JSON array of `{messageIndex, source?, checkedChars, totalChars}`; also recorded in the audit log.",
                schema: { type: "string" },
              },
              "X-PII-Overridden": {
                description: "Present when something in the new messages would have been blocked or replaced and went out as written (`X-Override-Block`, or a value overridden earlier in the conversation): a JSON array of `{messageIndex, title, start, end, source?}`",
                schema: { type: "string" },
              },
              "X-PII-Warnings": {
                description: "Present when something reached `warnAt` but not `blockAt`: a JSON array of detections",
                schema: { type: "string" },
              },
            },
            content: {
              ...json(completionsResponse),
              "text/event-stream": { schema: z.toJSONSchema(completionsChunk) },
            },
          },
          400: {
            description: "Invalid request, or sensitive information reached `blockAt` (`type: pii_detected`, with `detections`)",
            content: json(
              z.object({
                error: z.object({
                  message: z.string(),
                  type: z.string(),
                  detections: z.array(flaggedDetection).optional(),
                  overridable: z.boolean().optional().describe("Whether this user may resend with `X-Override-Block: true`"),
                }),
              }),
            ),
          },
          503: error("The LLM detector is enabled but couldn't answer, and fails closed (`type: detector_unavailable`)"),
          403: error("`X-Override-Block` without the `override` role"),
          404: error("No enabled backend matches the model's slug, or X-Conversation-Id isn't one of yours"),
          502: error("Backend unreachable or rejected our credentials"),
          504: error("Backend timed out"),
        },
      },
    },
    "/v1/models": {
      get: {
        tags: ["OpenAI-compatible"],
        summary: "List models from all enabled backends",
        description: "Ids are prefixed with the backend slug. Backends that fail are left out.",
        security: bearer,
        responses: { ...unauthorized, 200: { description: "Models", content: json(modelsList) } },
      },
    },
    "/users": {
      get: {
        tags: ["Users"],
        security: bearer,
        summary: "List users with their roles",
        parameters: [{ name: "deleted", in: "query", required: false, description: "`true` includes deleted users", schema: { type: "boolean" } }],
        responses: { ...needs("manage_users"), 200: { description: "Users", content: json(z.array(user)) } },
      },
      post: {
        tags: ["Users"],
        security: bearer,
        summary: "Create a user",
        description: "You can only give roles you hold yourself (403 otherwise).",
        requestBody: { required: true, content: json(createUserSchema, "input") },
        responses: {
          ...needs("manage_users"),
          201: { description: "Created", content: json(user) },
          400: { description: "Invalid request" },
          409: { description: "Email already taken" },
        },
      },
    },
    "/users/{id}/roles": {
      put: {
        tags: ["Users"],
        security: bearer,
        summary: "Replace a user's roles",
        description: "Adding or removing a role both need you to hold it, so nobody can hand out more than they have. The last admin can't lose `admin`.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { required: true, content: json(setRolesSchema, "input") },
        responses: {
          ...needs("manage_users"),
          200: { description: "User with their new roles", content: json(user) },
          400: { description: "Invalid request" },
          404: { description: "No such user" },
          409: error("That would leave no admin"),
        },
      },
    },
    "/users/{id}": {
      delete: {
        tags: ["Users"],
        security: bearer,
        summary: "Delete a user (soft)",
        description: "They can't log in, and their current session stops working at once. Their chats and audit history stay, under their name; their email is free for a new account. Not yourself, not someone with roles you don't have, and not the last admin.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          ...needs("manage_users"),
          200: { description: "The deleted user", content: json(user) },
          404: { description: "No such user" },
          409: error("Yourself, or the last admin"),
        },
      },
    },
    "/users/{id}/restore": {
      post: {
        tags: ["Users"],
        security: bearer,
        summary: "Undo a delete",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          ...needs("manage_users"),
          200: { description: "The restored user", content: json(user) },
          404: { description: "No deleted user with that id" },
          409: error("Their email belongs to another user now"),
        },
      },
    },
    "/review/conversations": {
      get: {
        tags: ["Review"],
        security: bearer,
        summary: "Everyone's conversations, newest first",
        description: "At most 200, including ones where every message was blocked (their title is null). Counts say how many messages were blocked, sent by overriding a block, or sent unchecked.",
        parameters: [{ name: "q", in: "query", required: false, description: "Only conversations whose owner's email or title contains this", schema: { type: "string" } }],
        responses: {
          ...needs("review_chats"),
          200: {
            description: "Conversations",
            content: json(z.array(z.object({
              id: z.string(), title: z.string().nullable(), updatedAt: z.string(), user: z.string(),
              blocked: z.number().int(), overridden: z.number().int(), unchecked: z.number().int(),
            }))),
          },
        },
      },
    },
    "/review/conversations/{id}": {
      get: {
        tags: ["Review"],
        security: bearer,
        summary: "Read anyone's conversation",
        description: "Every message as stored (sensitive parts masked), blocked attempts included, each with what was found in it. Each read is recorded in the audit log.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          ...needs("review_chats"),
          200: {
            description: "Conversation",
            content: json(z.object({
              id: z.string(), title: z.string().nullable(), updatedAt: z.string(), client: z.string().nullable(), user: z.string(),
              messages: z.array(z.object({
                role: z.string(), content: z.string(), model: z.string().nullable(), createdAt: z.string(),
                action: z.enum(["allowed", "warned", "redacted", "blocked", "overridden", "unchecked"]),
                detections: z.array(z.object({ reason: z.string(), location: z.string().nullable(), confidence: z.number(), outcome: z.string() })),
              })),
            })),
          },
          404: { description: "Not found" },
        },
      },
    },
    "/keywords": {
      get: {
        tags: ["Keywords"],
        security: bearer,
        summary: "The custom keyword list",
        description: "Terms the company keeps private (project codenames, clients, internal names). Every message and attachment is checked for them by the rules, as the `keyword` checker: they block, get replaced or warn like any other finding, per `/settings/detection-policy`. They are never sent to the LLM detector.",
        responses: {
          ...needs("manage_keywords"),
          200: {
            description: "Keywords, alphabetically",
            content: json(z.array(z.object({ id: z.number().int(), keyword: z.string(), createdAt: z.string(), createdBy: z.string().nullable() }))),
          },
        },
      },
      post: {
        tags: ["Keywords"],
        security: bearer,
        summary: "Add keywords",
        description: "Each is saved normalized: lowercase, letters and numbers only, single spaces between words (`\"What\'s up?\"` → `whats up`). Messages are matched the same way, on whole words, so `whats up` also catches \"WHAT\'S UP!!\". Duplicates (after normalizing) are skipped. Only the count is recorded in the audit log.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(addKeywordsSchema, { io: "input" }),
              example: { keywords: ["Project Falcon", "What's up?"] },
            },
          },
        },
        responses: {
          ...needs("manage_keywords"),
          200: {
            description: "What happened to each",
            content: json(z.object({
              added: z.array(z.string()).describe("As saved"),
              alreadyListed: z.array(z.string()),
              empty: z.array(z.string()).describe("Had no letters or numbers, so nothing to save"),
            })),
          },
          400: { description: "Invalid request" },
        },
      },
    },
    "/keywords/{id}": {
      delete: {
        tags: ["Keywords"],
        security: bearer,
        summary: "Remove a keyword",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { ...needs("manage_keywords"), 204: { description: "Removed" }, 404: { description: "Not found" } },
      },
    },
    "/backends": {
      get: {
        tags: ["Backends"],
        security: bearer,
        summary: "List backends",
        responses: { ...needs("manage_backends"), 200: { description: "Backends", content: json(z.array(backend)) } },
      },
      post: {
        tags: ["Backends"],
        security: bearer,
        summary: "Create a backend",
        description: "`slug` is the model prefix: lowercase letters and digits separated by single hyphens.",
        requestBody: { required: true, content: json(createBackendSchema, "input") },
        responses: {
          ...needs("manage_backends"),
          201: { description: "Created", content: json(backend) },
          400: { description: "Invalid request" },
          409: { description: "Slug already taken" },
        },
      },
    },
    "/backends/{id}": {
      delete: {
        tags: ["Backends"],
        security: bearer,
        summary: "Delete a backend",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: z.toJSONSchema(backendIdSchema, { io: "input" }),
          },
        ],
        responses: {
          ...needs("manage_backends"),
          200: { description: "Deleted backend", content: json(backend) },
          404: { description: "Not found" },
        },
      },
    },
    "/settings/llm-detector": {
      get: {
        tags: ["Settings"],
        summary: "Get the local-LLM PII detector settings",
        security: bearer,
        responses: { ...needs("manage_settings"), 200: { description: "Settings", content: json(llmDetector) } },
      },
      patch: {
        tags: ["Settings"],
        summary: "Change the local-LLM PII detector settings",
        description:
          "Only one model does this job. `backendId` must be a `local` backend, since the detector sees every prompt. `failMode: block` (default) rejects requests with 503 when the detector can't answer; `allow` lets them through. Whether findings warn or block is set by `/settings/detection-policy` under the `local-llm` checker. It reads at most `maxChars` characters (default 10,000) of each message and of each attachment; longer ones pass as partly checked, since the rule-based checks still cover everything, and are recorded in the audit log. `instructions` is appended to the detector's prompt for company-specific rules.",
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(updateLlmDetectorSchema, { io: "input" }),
              example: { enabled: true, backendId: 1, model: "qwen2.5:3b" },
            },
          },
        },
        responses: {
          ...needs("manage_settings"),
          200: { description: "Updated settings", content: json(llmDetector) },
          400: { description: "Invalid request, unknown or non-local backend, or enabled without backend/model" },
        },
      },
    },
    "/settings/llm-detector/backends": {
      get: {
        tags: ["Settings"],
        summary: "Local backends the detector can use",
        description: "Just enough to pick one; addresses and keys stay under `/backends`.",
        security: bearer,
        responses: {
          ...needs("manage_settings"),
          200: { description: "Backends", content: json(z.array(z.object({ id: z.number().int(), name: z.string(), slug: z.string(), enabled: z.boolean() }))) },
        },
      },
    },
    "/settings/sso": {
      get: {
        tags: ["Settings"],
        summary: "Single sign-on providers",
        description: "Client secrets are never returned. `redirectUri` is what to register with the provider.",
        security: bearer,
        responses: { ...needs("manage_settings"), 200: { description: "Providers" } },
      },
      post: {
        tags: ["Settings"],
        summary: "Add an OpenID Connect provider",
        description: "For Google, `issuer` is `https://accounts.google.com`; for Microsoft Entra ID, `https://login.microsoftonline.com/<tenant id>/v2.0`. The issuer's discovery document is checked before saving. `allowedDomains` limits sign-in to those email domains; empty allows any (only existing users can sign in either way).",
        security: bearer,
        requestBody: { required: true, content: json(createSsoProviderSchema, "input") },
        responses: {
          ...needs("manage_settings"),
          201: { description: "Added" },
          400: { description: "Invalid, or the issuer's discovery document couldn't be read" },
          409: { description: "Slug already used" },
        },
      },
    },
    "/settings/sso/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      patch: {
        tags: ["Settings"],
        summary: "Turn a provider on or off, or change its allowed domains",
        security: bearer,
        requestBody: { required: true, content: json(updateSsoProviderSchema, "input") },
        responses: { ...needs("manage_settings"), 200: { description: "Updated" }, 404: { description: "Not found" } },
      },
      delete: {
        tags: ["Settings"],
        summary: "Remove a provider (and its links to users)",
        security: bearer,
        responses: { ...needs("manage_settings"), 204: { description: "Removed" }, 404: { description: "Not found" } },
      },
    },
    "/settings/detection-policy": {
      get: {
        tags: ["Settings"],
        summary: "Get the warn/block thresholds",
        description:
          "`mode` says what reaching `blockAt` does: `block` stops the message; `replace` swaps what was found for a placeholder like `redacted-3f9a1c0b7e2d` and sends it, wherever that can be done cleanly (message text and plain-text files; PDFs and images still block). The same value gets the same placeholder everywhere within a conversation. Detections carry a confidence from 0 to 1. At or above `blockAt` the request is rejected; at or above `warnAt` it goes through with a warning; below both it's only recorded. `null` means never. `checkers` lists every checker with its effective thresholds; `overridden` ones don't follow the global values.",
        security: bearer,
        responses: { ...needs("manage_settings"), 200: { description: "Policy", content: json(detectionPolicy) } },
      },
      patch: {
        tags: ["Settings"],
        summary: "Change the global warn/block thresholds and the block mode",
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(updateDefaultsSchema, { io: "input" }),
              example: { warnAt: 0.5, blockAt: 0.8, mode: "replace" },
            },
          },
        },
        responses: {
          ...needs("manage_settings"),
          200: { description: "Updated policy", content: json(detectionPolicy) },
          400: { description: "Invalid thresholds, or warnAt above blockAt" },
        },
      },
    },
    "/settings/detection-policy/checkers/{checker}": {
      parameters: [
        {
          name: "checker",
          in: "path",
          required: true,
          description: "Checker name, as listed by GET /settings/detection-policy",
          schema: { type: "string" },
        },
      ],
      put: {
        tags: ["Settings"],
        summary: "Override the thresholds for one checker",
        description: "Both fields are required; `null` means never. E.g. `{\"warnAt\": 0.5, \"blockAt\": null}` makes phone numbers warn but never block.",
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(thresholdsSchema, { io: "input" }),
              example: { warnAt: 0.5, blockAt: null },
            },
          },
        },
        responses: {
          ...needs("manage_settings"),
          200: { description: "Updated policy", content: json(detectionPolicy) },
          400: { description: "Unknown checker or invalid thresholds" },
        },
      },
      delete: {
        tags: ["Settings"],
        summary: "Remove a checker's override so it follows the global thresholds",
        security: bearer,
        responses: {
          ...needs("manage_settings"),
          200: { description: "Updated policy", content: json(detectionPolicy) },
          400: { description: "Unknown checker" },
        },
      },
    },
  },
};
