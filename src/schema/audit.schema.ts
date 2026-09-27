import z from "zod";

// Filters for the audit log, from the query string. All optional; together
// they narrow the list (AND).
export const auditFilterSchema = z.object({
  // one event, or several separated by commas ("message_blocked,block_overridden")
  event: z
    .string()
    .max(1000)
    .transform((s) => s.split(",").map((e) => e.trim()).filter(Boolean))
    .optional(),
  user: z.string().trim().min(1).max(255).optional(), // part of an email address
  conversation: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(), // at or after
  to: z.iso.datetime({ offset: true }).optional(), // before
});

export const auditListSchema = auditFilterSchema.extend({
  before: z.coerce.number().int().positive().optional(), // entries older than this id, for paging
  limit: z.coerce.number().int().min(1).max(2000).default(200),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;
