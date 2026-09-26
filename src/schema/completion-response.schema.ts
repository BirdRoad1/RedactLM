import z from "zod";
import { toolCall } from "./completions-request.schema";

// ---------- Shared ----------

export const usage = z.object({
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
    prompt_tokens_details: z
        .object({ cached_tokens: z.number().int().optional() })
        .nullish(),
    completion_tokens_details: z
        .object({ reasoning_tokens: z.number().int().optional() })
        .nullish(),
});

// Known values: "stop" | "length" | "tool_calls" | "content_filter"
// Kept as a string because providers don't all agree
const finishReason = z.string();

// Kept loose: rarely needed and shapes vary between providers
const logprobs = z.unknown().nullish();

// ---------- Non-streaming response ----------

export const responseMessage = z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    refusal: z.string().nullish(),
    tool_calls: z.array(toolCall).optional(),
});

export const completionChoice = z.object({
    index: z.number().int(),
    message: responseMessage,
    finish_reason: finishReason.nullable(),
    logprobs,
});

export const completionsResponse = z.object({
    id: z.string(),
    object: z.literal("chat.completion"),
    created: z.number().int(), // Unix seconds
    model: z.string(),
    choices: z.array(completionChoice),
    usage: usage.optional(),
    system_fingerprint: z.string().nullish(),
});

// ---------- Streaming chunk ----------

// Tool calls arrive in pieces: `index` says which call a fragment belongs to,
// `id` and `name` appear once, `arguments` is split across chunks
export const toolCallDelta = z.object({
    index: z.number().int(),
    id: z.string().optional(),
    type: z.literal("function").optional(),
    function: z
        .object({
            name: z.string().optional(),
            arguments: z.string().optional(),
        })
        .optional(),
});

export const chunkDelta = z.object({
    role: z.literal("assistant").optional(),
    content: z.string().nullish(),
    refusal: z.string().nullish(),
    tool_calls: z.array(toolCallDelta).optional(),
});

export const chunkChoice = z.object({
    index: z.number().int(),
    delta: chunkDelta,
    finish_reason: finishReason.nullable(),
    logprobs,
});

export const completionsChunk = z.object({
    id: z.string(),
    object: z.literal("chat.completion.chunk"),
    created: z.number().int(),
    model: z.string(),
    // Empty on the final usage-only chunk when stream_options.include_usage is set
    choices: z.array(chunkChoice),
    usage: usage.nullish(),
    system_fingerprint: z.string().nullish(),
});

// ---------- Error ----------

export const completionErrorResponse = z.object({
    error: z.object({
        message: z.string(),
        type: z.string().optional(),
        param: z.string().nullish(),
        code: z.union([z.string(), z.number()]).nullish(),
    }),
});

// ---------- Types ----------

export type CompletionsResponse = z.infer<typeof completionsResponse>;
export type CompletionsChunk = z.infer<typeof completionsChunk>;
export type CompletionErrorResponse = z.infer<typeof completionErrorResponse>;