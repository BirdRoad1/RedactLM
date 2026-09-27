import { and, desc, eq } from "drizzle-orm";
import { tryGetContext } from "hono/context-storage";
import { db } from "../db";
import { auditLogTable, usersTable } from "../db/schema";
import type { AuthEnv } from "../middleware/auth";
import type { PartialCheck, Source } from "./scan.service";

// What was found, and where; never the text itself
export type Finding = { title: string; checker: string; source?: Source; placeholder?: string };

// Every kind of entry, with what it records. Details never contain checked
// text, passwords or API keys.
export type AuditEvents = {
  message_blocked: { messageIndex: number; findings: Finding[] };
  message_warned: { messageIndex: number; findings: Finding[] };
  message_replaced: { messageIndex: number; findings: Finding[] };
  partially_checked: PartialCheck & { messageIndex: number };
  attachment_refused: { reason: string };
  detector_unavailable: { failMode: "block" | "allow"; reason: string };
  conversation_deleted: { title: string | null };
  settings_changed: { setting: string; changes: Record<string, unknown> };
  backend_created: { name: string; slug: string; trust: string };
  backend_deleted: { name: string; slug: string };
  user_created: { email: string; isAdmin: boolean };
  login_succeeded: { email: string; ip?: string };
  login_failed: { email: string; ip?: string };
};

export type AuditEvent = keyof AuditEvents;

// Records an entry. The user and conversation default to the current
// request's, so code deep in a request (like the LLM detector) can log too.
export async function audit<E extends AuditEvent>(
  event: E,
  details: AuditEvents[E],
  who: { userId?: number | null; conversationId?: string | null } = {},
) {
  const c = tryGetContext<AuthEnv>();
  const userId = who.userId !== undefined ? who.userId : (c?.get("userId") ?? null);
  try {
    await db.insert(auditLogTable).values({ event, details, userId, conversationId: who.conversationId ?? null });
  } catch (err) {
    // an audit failure shouldn't take the request down with it, but must be visible
    console.error(`Couldn't write audit entry "${event}":`, err);
  }
}

const number = (n: number) => n.toLocaleString("en-US");

const where = (s?: Source) => (s ? ` in "${s.filename}"${s.page ? `, page ${s.page}` : ""}` : "");

// "Social Security number (2), Phone number in "a.pdf", page 3"
function listFindings(findings: Finding[]) {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const key = f.title + where(f.source);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([what, n]) => (n > 1 ? `${what} (${n})` : what)).join(", ");
}

function describeChanges(changes: Record<string, unknown>) {
  return Object.entries(changes)
    .map(([key, value]) => `${key} → ${value === null ? "none" : JSON.stringify(value)}`)
    .join(", ");
}

// One sentence an admin can read without knowing the event codes
export function describeEvent(event: string, details: unknown): string {
  const d = details as never;
  switch (event as AuditEvent) {
    case "message_blocked":
      return `Message blocked: ${listFindings((d as AuditEvents["message_blocked"]).findings)}.`;
    case "message_warned":
      return `Message sent with warnings: ${listFindings((d as AuditEvents["message_warned"]).findings)}.`;
    case "message_replaced":
      return `Message sent with placeholders instead of: ${listFindings((d as AuditEvents["message_replaced"]).findings)}.`;
    case "partially_checked": {
      const p = d as AuditEvents["partially_checked"];
      const what = p.source ? `"${p.source.filename}"` : "a message";
      return `Only partly checked: the AI detector read the first ${number(p.checkedChars)} of ${number(p.totalChars)} characters of ${what}. The rule-based checks covered all of it.`;
    }
    case "attachment_refused":
      return `Attachment refused: ${(d as AuditEvents["attachment_refused"]).reason}`;
    case "detector_unavailable": {
      const u = d as AuditEvents["detector_unavailable"];
      return u.failMode === "block"
        ? "The AI detector couldn't answer, so the message was blocked."
        : "The AI detector couldn't answer, so the message went out with only the rule-based checks.";
    }
    case "conversation_deleted": {
      const t = (d as AuditEvents["conversation_deleted"]).title;
      return t ? `Deleted the conversation "${t}".` : "Deleted a conversation.";
    }
    case "settings_changed": {
      const s = d as AuditEvents["settings_changed"];
      return `Changed ${s.setting}: ${describeChanges(s.changes)}.`;
    }
    case "backend_created": {
      const b = d as AuditEvents["backend_created"];
      return `Added the backend "${b.name}" (${b.slug}, ${b.trust}).`;
    }
    case "backend_deleted": {
      const b = d as AuditEvents["backend_deleted"];
      return `Deleted the backend "${b.name}" (${b.slug}).`;
    }
    case "user_created": {
      const u = d as AuditEvents["user_created"];
      return `Created ${u.isAdmin ? "the admin" : "the user"} ${u.email}.`;
    }
    case "login_succeeded":
      return `Logged in${(d as AuditEvents["login_succeeded"]).ip ? ` from ${(d as AuditEvents["login_succeeded"]).ip}` : ""}.`;
    case "login_failed": {
      const l = d as AuditEvents["login_failed"];
      return `Failed login for ${l.email}${l.ip ? ` from ${l.ip}` : ""}.`;
    }
  }
  return event;
}

export async function listAudit({ event, limit = 200 }: { event?: string; limit?: number } = {}) {
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
    .where(and(event ? eq(auditLogTable.event, event) : undefined))
    .orderBy(desc(auditLogTable.id))
    .limit(limit);
  return rows.map((row) => ({ ...row, summary: describeEvent(row.event, row.details) }));
}
