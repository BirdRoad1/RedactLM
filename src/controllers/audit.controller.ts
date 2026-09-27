import type { Context } from "hono";
import type { AuthEnv } from "../middleware/auth";
import { auditFilterSchema, auditListSchema } from "../schema/audit.schema";
import { audit, exportAuditCsv, listAudit } from "../services/audit.service";

const badFilters = { error: "Invalid filters: event, user, conversation (an id), from and to (ISO dates with a time zone), before and limit (numbers)" };

export async function listAuditLog(c: Context<AuthEnv>) {
  const parsed = auditListSchema.safeParse(c.req.query());
  if (parsed.error) return c.json(badFilters, 400);
  return c.json(await listAudit(parsed.data));
}

// All matching entries, not just a page. Exporting is itself logged: the
// file leaves the app with whatever it holds.
export async function exportAuditLog(c: Context<AuthEnv>) {
  const parsed = auditFilterSchema.safeParse(c.req.query());
  if (parsed.error) return c.json(badFilters, 400);

  await audit("audit_exported", { filters: parsed.data });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(exportAuditCsv(parsed.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
