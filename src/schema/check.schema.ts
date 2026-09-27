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

export const checkFileRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  data: z.string().startsWith("data:"), // data URI, as in a chat message's file part
});

export const checkFileResponseSchema = z.object({
  pages: z.number().int().nullable(), // PDFs only
  // set when the file is longer than the LLM detector reads on send
  partial: z.object({ checkedChars: z.number().int(), totalChars: z.number().int() }).nullable(),
  issues: z.array(issueSchema.extend({ page: z.number().int().nullable() })),
});

export type Issue = z.infer<typeof issueSchema>;
