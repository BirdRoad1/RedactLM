import z from "zod";

export const checkRequestSchema = z.object({
  text: z.string().max(100_000),
});

// One problem in the text, in words a person can act on
export const issueSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  outcome: z.enum(["warned", "blocked"]), // what sending it as-is would do
  title: z.string(),
  reason: z.string(),
  explanation: z.string(),
  confidence: z.number(),
});

export const checkResponseSchema = z.object({ issues: z.array(issueSchema) });

export type Issue = z.infer<typeof issueSchema>;
