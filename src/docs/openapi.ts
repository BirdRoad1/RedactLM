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
import { updateLlmDetectorSchema } from "../schema/llm-detector.schema";
import { createUserSchema } from "../schema/user.schema";

// Hand-assembled OpenAPI doc for dev use. Bodies come from the real Zod
// schemas, so those stay in sync; the paths below need updating by hand when
// routes change.

const json = (schema: z.ZodType, io: "input" | "output" = "output") => ({
  "application/json": { schema: z.toJSONSchema(schema, { io, unrepresentable: "any" }) },
});

const error = (description: string) => ({ description, content: json(completionErrorResponse) });

const unauthorized = { 401: error("Missing or invalid token") };
const adminOnly = { ...unauthorized, 403: error("Not an admin") };

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
  isAdmin: z.boolean(),
  createdAt: z.string(),
});

const llmDetector = z.object({
  id: z.literal(1),
  enabled: z.boolean(),
  backendId: z.number().int().nullable(),
  model: z.string().nullable(),
  failMode: z.enum(["block", "allow"]),
  timeoutMs: z.number().int(),
  instructions: z.string().nullable(),
  updatedAt: z.string(),
});

const threshold = z.number().nullable();
const detectionPolicy = z.object({
  warnAt: threshold,
  blockAt: threshold,
  checkers: z.array(
    z.object({ checker: z.string(), warnAt: threshold, blockAt: threshold, overridden: z.boolean() }),
  ),
});

const flaggedDetection = z.object({
  messageIndex: z.number().int(),
  checker: z.string(),
  reason: z.string(),
  confidence: z.number(),
  start: z.number().int(),
  end: z.number().int(),
});

const bearer = [{ bearerAuth: [] }];

export const openApiDoc = {
  openapi: "3.1.0",
  info: {
    title: "LLM Thingy",
    version: "dev",
    description:
      "PII-filtering proxy for OpenAI-compatible LLM backends. Create the first admin with `bun run create-admin <email> <username>`, get a token from `POST /auth/login`, then click **Authorize**. `/users` and `/backends` are admin-only.",
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
    "/v1/chat/completions": {
      post: {
        tags: ["OpenAI-compatible"],
        summary: "Create a chat completion",
        description:
          '`model` is `"<backend slug>/<model>"`, or a bare `"<model>"` for the default backend. With `stream: true` the response is Server-Sent Events of completion chunks, ending in `data: [DONE]`.\n\nUser messages are checked against the detection policy (`/settings/detection-policy`): detections at or above `blockAt` reject the request, those at or above `warnAt` let it through and are listed in the `X-PII-Warnings` header. Stored messages have every detected span masked.',
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
                }),
              }),
            ),
          },
          503: error("The LLM detector is enabled but couldn't answer, and fails closed (`type: detector_unavailable`)"),
          404: error("No enabled backend matches the model's slug"),
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
      post: {
        tags: ["Users"],
        security: bearer,
        summary: "Create a user",
        requestBody: { required: true, content: json(createUserSchema, "input") },
        responses: {
          ...adminOnly,
          201: { description: "Created", content: json(user) },
          400: { description: "Invalid request" },
          409: { description: "Email already taken" },
        },
      },
    },
    "/backends": {
      get: {
        tags: ["Backends"],
        security: bearer,
        summary: "List backends",
        responses: { ...adminOnly, 200: { description: "Backends", content: json(z.array(backend)) } },
      },
      post: {
        tags: ["Backends"],
        security: bearer,
        summary: "Create a backend",
        description: "`slug` is the model prefix: lowercase letters and digits separated by single hyphens.",
        requestBody: { required: true, content: json(createBackendSchema, "input") },
        responses: {
          ...adminOnly,
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
          ...adminOnly,
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
        responses: { ...adminOnly, 200: { description: "Settings", content: json(llmDetector) } },
      },
      patch: {
        tags: ["Settings"],
        summary: "Change the local-LLM PII detector settings",
        description:
          "Only one model does this job. `backendId` must be a `local` backend, since the detector sees every prompt. `failMode: block` (default) rejects requests with 503 when the detector can't answer; `allow` lets them through. Whether findings warn or block is set by `/settings/detection-policy` under the `local-llm` checker. `instructions` is appended to the detector's prompt for company-specific rules.",
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
          ...adminOnly,
          200: { description: "Updated settings", content: json(llmDetector) },
          400: { description: "Invalid request, unknown or non-local backend, or enabled without backend/model" },
        },
      },
    },
    "/settings/detection-policy": {
      get: {
        tags: ["Settings"],
        summary: "Get the warn/block thresholds",
        description:
          "Detections carry a confidence from 0 to 1. At or above `blockAt` the request is rejected; at or above `warnAt` it goes through with a warning; below both it's only recorded. `null` means never. `checkers` lists every checker with its effective thresholds; `overridden` ones don't follow the global values.",
        security: bearer,
        responses: { ...adminOnly, 200: { description: "Policy", content: json(detectionPolicy) } },
      },
      patch: {
        tags: ["Settings"],
        summary: "Change the global warn/block thresholds",
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(updateDefaultsSchema, { io: "input" }),
              example: { warnAt: 0.5, blockAt: 0.8 },
            },
          },
        },
        responses: {
          ...adminOnly,
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
          ...adminOnly,
          200: { description: "Updated policy", content: json(detectionPolicy) },
          400: { description: "Unknown checker or invalid thresholds" },
        },
      },
      delete: {
        tags: ["Settings"],
        summary: "Remove a checker's override so it follows the global thresholds",
        security: bearer,
        responses: {
          ...adminOnly,
          200: { description: "Updated policy", content: json(detectionPolicy) },
          400: { description: "Unknown checker" },
        },
      },
    },
  },
};
