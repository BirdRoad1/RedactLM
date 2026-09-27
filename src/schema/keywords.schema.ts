import z from "zod";

// One or many at once, e.g. pasted one per line
export const addKeywordsSchema = z.object({
  keywords: z.array(z.string().max(500)).min(1).max(50_000),
});
