import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLogTable, usersTable } from "../db/schema";
import type { PartialCheck } from "./scan.service";

type AuditEvent = {
  event: "partially_checked";
  details: PartialCheck & { messageIndex: number };
};

export async function audit(entry: AuditEvent & { userId: number; conversationId?: string }) {
  await db.insert(auditLogTable).values(entry);
}

const number = (n: number) => n.toLocaleString("en-US");

// One sentence an admin can read without knowing the event codes
export function describeEvent(event: string, details: unknown) {
  if (event === "partially_checked") {
    const d = details as PartialCheck;
    const what = d.source ? `"${d.source.filename}"` : "a message";
    return `Only partly checked: the AI detector read the first ${number(d.checkedChars)} of ${number(d.totalChars)} characters of ${what}. The rule-based checks covered all of it.`;
  }
  return event;
}

export async function listAudit(limit = 200) {
  const rows = await db
    .select({
      id: auditLogTable.id,
      createdAt: auditLogTable.createdAt,
      user: usersTable.email,
      conversationId: auditLogTable.conversationId,
      event: auditLogTable.event,
      details: auditLogTable.details,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.userId, usersTable.id))
    .orderBy(desc(auditLogTable.id))
    .limit(limit);
  return rows.map((row) => ({ ...row, summary: describeEvent(row.event, row.details) }));
}
