// This file is Claude-generated

import z from "zod";

// ---------- Content parts ----------

export const textPart = z.object({
    type: z.literal("text"),
    text: z.string(),
});

export const imagePart = z.object({
    type: z.literal("image_url"),
    image_url: z.object({
        url: z.string(), // https URL or data: URI
        detail: z.enum(["auto", "low", "high"]).optional(),
    }),
});

export const filePart = z.object({
    type: z.literal("file"),
    file: z.object({
        file_data: z.string().optional(), // base64 data URI
        file_id: z.string().optional(),
        filename: z.string().optional(),
    }),
});

export const refusalPart = z.object({
    type: z.literal("refusal"),
    refusal: z.string(),
});

export const userContentPart = z.discriminatedUnion("type", [
    textPart,
    imagePart,
    filePart,
]);

export const assistantContentPart = z.discriminatedUnion("type", [
    textPart,
    refusalPart,
]);

// Content is either a plain string or an array of parts
const textContent = z.union([z.string(), z.array(textPart)]);

// ---------- Tool calls ----------

export const toolCall = z.object({
    id: z.string(),
    type: z.literal("function"),
    function: z.object({
        name: z.string(),
        arguments: z.string(), // JSON-encoded string, scan this too
    }),
});

// ---------- Messages ----------

export const systemMessage = z.object({
    role: z.literal("system"),
    content: textContent,
    name: z.string().optional(),
});

export const developerMessage = z.object({
    role: z.literal("developer"),
    content: textContent,
    name: z.string().optional(),
});

export const userMessage = z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(userContentPart)]),
    name: z.string().optional(),
});

export const assistantMessage = z.object({
    role: z.literal("assistant"),
    content: z.union([z.string(), z.array(assistantContentPart)]).nullish(),
    refusal: z.string().nullish(),
    tool_calls: z.array(toolCall).optional(),
    name: z.string().optional(),
});

export const toolMessage = z.object({
    role: z.literal("tool"),
    content: textContent,
    tool_call_id: z.string(),
});

export const message = z.discriminatedUnion("role", [
    systemMessage,
    developerMessage,
    userMessage,
    assistantMessage,
    toolMessage,
]);

// ---------- Tools ----------

export const toolDefinition = z.object({
    type: z.literal("function"),
    function: z.object({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(), // JSON Schema
        strict: z.boolean().nullish(),
    }),
});

export const toolChoice = z.union([
    z.enum(["none", "auto", "required"]),
    z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() }),
    }),
]);

// ---------- Response format ----------

export const responseFormat = z.discriminatedUnion("type", [
    z.object({ type: z.literal("text") }),
    z.object({ type: z.literal("json_object") }),
    z.object({
        type: z.literal("json_schema"),
        json_schema: z.object({
            name: z.string(),
            description: z.string().optional(),
            schema: z.record(z.string(), z.unknown()).optional(),
            strict: z.boolean().nullish(),
        }),
    }),
]);

// ---------- Request ----------

export const completionsRequest = z.object({
    model: z.string().min(1),
    messages: z.array(message).min(1),

    stream: z.boolean().nullish(),
    stream_options: z
        .object({ include_usage: z.boolean().optional() })
        .nullish(),

    temperature: z.number().min(0).max(2).nullish(),
    top_p: z.number().min(0).max(1).nullish(),
    max_tokens: z.number().int().positive().nullish(), // legacy
    max_completion_tokens: z.number().int().positive().nullish(),
    n: z.number().int().min(1).nullish(),
    stop: z.union([z.string(), z.array(z.string()).max(4)]).nullish(),
    presence_penalty: z.number().min(-2).max(2).nullish(),
    frequency_penalty: z.number().min(-2).max(2).nullish(),
    seed: z.number().int().nullish(),
    logprobs: z.boolean().nullish(),
    top_logprobs: z.number().int().min(0).max(20).nullish(),

    tools: z.array(toolDefinition).optional(),
    tool_choice: toolChoice.optional(),
    parallel_tool_calls: z.boolean().optional(),
    response_format: responseFormat.optional(),

    reasoning_effort: z.string().optional(), // values vary by provider
    user: z.string().optional(),
});

export type CompletionsRequest = z.infer<typeof completionsRequest>;
export type Message = z.infer<typeof message>;