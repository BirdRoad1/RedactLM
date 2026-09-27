import z from "zod";

// ---------- Single model ----------

export const model = z.object({
    id: z.string(),             // what clients put in the request's `model` field
    object: z.literal("model"),
    created: z.number().int(),  // Unix seconds
    owned_by: z.string(),       // e.g. "openai", "anthropic", or your org for local models
    // Ours, beyond the OpenAI shape (clients ignore fields they don't know):
    name: z.string(),           // readable name when the backend gives one ("Claude Opus 5.5"), else the model's own id
    backend: z.string(),        // the backend's name, as admins set it ("Claude")
});

// ---------- GET /v1/models ----------

export const modelsList = z.object({
    object: z.literal("list"),
    data: z.array(model),
});

// ---------- Types ----------

export type Model = z.infer<typeof model>;
export type ModelsList = z.infer<typeof modelsList>;