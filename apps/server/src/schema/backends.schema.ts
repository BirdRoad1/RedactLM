import z from "zod";

export const createBackendSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    // used as the model prefix ("openai-work/gpt-4o"), so no "/" or anything URL/header-unsafe
    slug: z
      .string()
      .max(64)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must be lowercase letters and digits, separated by single hyphens",
      ),
    baseUrl: z.url(),
    apiKey: z.string().max(255).nullish(),
    trust: z.enum(["local", "cloud"]),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    supportsStreaming: z.boolean().optional(),
    stripParams: z.array(z.string()).optional(),
    extraHeaders: z.record(z.string(), z.string()).nullish(),
  })
  .refine((b) => !(b.isDefault && b.enabled === false), {
    message: "The default backend must be enabled",
    path: ["enabled"],
  });

export const backendIdSchema = z.coerce.number().int().positive();

export type CreateBackend = z.infer<typeof createBackendSchema>;
