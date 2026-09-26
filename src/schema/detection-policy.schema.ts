import z from "zod";

const threshold = z.number().min(0).max(1).nullable(); // null = never

const ordered = (t: { warnAt?: number | null; blockAt?: number | null }) =>
  t.warnAt == null || t.blockAt == null || t.warnAt <= t.blockAt;
const orderedError = { message: "warnAt must not be above blockAt" };

export const thresholdsSchema = z
  .object({ warnAt: threshold, blockAt: threshold })
  .strict()
  .refine(ordered, orderedError);

export const updateDefaultsSchema = z
  .object({ warnAt: threshold, blockAt: threshold })
  .partial()
  .strict();

export const checkerNameSchema = z.string().min(1).max(64);

export { ordered as thresholdsOrdered };
