import z from "zod";

export const updateLlmDetectorSchema = z
  .object({
    enabled: z.boolean(),
    backendId: z.number().int().positive().nullable(),
    model: z.string().trim().min(1).max(255).nullable(),
    failMode: z.enum(["block", "allow"]),
    minConfidence: z.number().min(0).max(1),
    timeoutMs: z.number().int().min(1_000).max(300_000),
    instructions: z.string().max(4_000).nullable(),
  })
  .partial()
  .strict();

export type UpdateLlmDetector = z.infer<typeof updateLlmDetectorSchema>;

// What the model is asked to return
export const llmFindings = z.object({
  findings: z.array(
    z.object({
      text: z.string(),
      category: z.string(),
      confidence: z.number(),
      reason: z.string().optional(),
    }),
  ),
});

export type LlmFindings = z.infer<typeof llmFindings>;
