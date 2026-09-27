import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { tryGetContext } from "hono/context-storage";
import { db } from "../db";
import { roleName } from "../auth/roles";
import { auditLogTable, usersTable, type UserRole } from "../db/schema";
import type { AuditFilter } from "../schema/audit.schema";
import { csvRow } from "./csv";
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
  block_overridden: { messageIndex: number; findings: Finding[] };
  sent_unchecked: { messageIndex: number; because: "admin" | "no_check" };
  // personal data in the model's own text, logged only: `request` is an
  // assistant message a client sent along, `reply` is what the model answered
  assistant_pii: { where: "request" | "reply"; messageIndex?: number; findings: Finding[] };
  partially_checked: PartialCheck & { messageIndex: number };
  attachment_refused: { reason: string };
  detector_unavailable: { failMode: "block" | "allow"; reason: string };
  conversation_deleted: { title: string | null };
  conversation_reviewed: { owner: string; title: string | null };
  settings_changed: { setting: string; changes: Record<string, unknown> };
  keywords_added: { count: number };
  keywords_deleted: { count: number };
  audit_exported: { filters: AuditFilter };
  backend_created: { name: string; slug: string; trust: string };
  backend_deleted: { name: string; slug: string };
  // entries from before roles have isAdmin instead
  user_created: { email: string; roles?: UserRole[]; isAdmin?: boolean };
  user_roles_changed: { email: string; added: UserRole[]; removed: UserRole[] };
  user_deleted: { email: string };
  user_password_changed: { email: string }; // never the password
  user_restored: { email: string };
  rate_limited: { limit: string; perMinute: number; ip?: string };
  login_succeeded: { email: string; ip?: string; via?: string }; // via: the SSO provider, if any
  login_failed: { email: string; ip?: string; via?: string; reason?: string };
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

const listRoles = (roles: UserRole[]) => roles.map(roleName).join(", ");

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
    case "block_overridden":
      return `Sent as written, overriding the checks: ${listFindings((d as AuditEvents["block_overridden"]).findings)}.`;
    case "sent_unchecked":
      return (d as AuditEvents["sent_unchecked"]).because === "admin"
        ? "Message sent without checks (admins' messages aren't checked)."
        : "Message sent without checks (this user's messages aren't checked).";
    case "assistant_pii": {
      const p = d as AuditEvents["assistant_pii"];
      return p.where === "reply"
        ? `The AI's reply contained ${listFindings(p.findings)}. Logged only; the reply wasn't changed.`
        : `An assistant message sent with the request contained ${listFindings(p.findings)}. Logged only; it was sent as it was.`;
    }
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
    case "conversation_reviewed": {
      const r = d as AuditEvents["conversation_reviewed"];
      return `Read ${r.owner}'s conversation${r.title ? ` "${r.title}"` : ""}.`;
    }
    case "settings_changed": {
      const s = d as AuditEvents["settings_changed"];
      return `Changed ${s.setting}: ${describeChanges(s.changes)}.`;
    }
    case "keywords_added": {
      const n = (d as AuditEvents["keywords_added"]).count;
      return `Added ${number(n)} ${n === 1 ? "keyword" : "keywords"} to the keyword list.`;
    }
    case "keywords_deleted": {
      const n = (d as AuditEvents["keywords_deleted"]).count;
      return `Removed ${number(n)} ${n === 1 ? "keyword" : "keywords"} from the keyword list.`;
    }
    case "audit_exported": {
      const f = (d as AuditEvents["audit_exported"]).filters;
      const parts = [
        f.event?.length && `events ${f.event.join(", ")}`,
        f.user && `users matching "${f.user}"`,
        f.conversation && `conversation ${f.conversation}`,
        f.from && `from ${f.from}`,
        f.to && `until ${f.to}`,
      ].filter(Boolean);
      return `Exported the audit log as CSV${parts.length ? ` (${parts.join("; ")})` : " (everything)"}.`;
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
      const roles = u.roles ?? (u.isAdmin ? ["admin"] : []);
      return `Created the user ${u.email}${roles.length ? ` (${listRoles(roles)})` : ""}.`;
    }
    case "user_password_changed":
      return `Changed the password of ${(d as AuditEvents["user_password_changed"]).email}, signing them out everywhere.`;
    case "user_deleted":
      return `Deleted the user ${(d as AuditEvents["user_deleted"]).email}.`;
    case "user_restored":
      return `Restored the user ${(d as AuditEvents["user_restored"]).email}.`;
    case "user_roles_changed": {
      const r = d as AuditEvents["user_roles_changed"];
      const parts = [
        r.added.length && `gave them ${listRoles(r.added)}`,
        r.removed.length && `took away ${listRoles(r.removed)}`,
      ].filter(Boolean);
      return `Changed ${r.email}'s roles: ${parts.join("; ")}.`;
    }
    case "rate_limited": {
      const r = d as AuditEvents["rate_limited"];
      return `Went over the "${r.limit}" limit of ${number(r.perMinute)} requests a minute${r.ip ? ` from ${r.ip}` : ""}; further requests were refused until the minute was up.`;
    }
    case "login_succeeded": {
      const l = d as AuditEvents["login_succeeded"];
      return `Logged in${l.via ? ` with ${l.via}` : ""}${l.ip ? ` from ${l.ip}` : ""}.`;
    }
    case "login_failed": {
      const l = d as AuditEvents["login_failed"];
      return `Failed login for ${l.email}${l.via ? ` with ${l.via}` : ""}${l.ip ? ` from ${l.ip}` : ""}${l.reason ? `: ${l.reason}` : "."}`;
    }
  }
  return event;
}

// `user` matches the acting user's email, or the email tried on a login
// (failed logins have no user)
function matching({ event, user, conversation, from, to }: AuditFilter) {
  const like = user && `%${user.replace(/[\\%_]/g, "\\$&")}%`;
  return and(
    event?.length ? inArray(auditLogTable.event, event) : undefined,
    like ? or(ilike(usersTable.email, like), ilike(sql`${auditLogTable.details}->>'email'`, like)) : undefined,
    conversation ? eq(auditLogTable.conversationId, conversation) : undefined,
    from ? gte(auditLogTable.createdAt, new Date(from)) : undefined,
    to ? lt(auditLogTable.createdAt, new Date(to)) : undefined,
  );
}

const columns = {
  id: auditLogTable.id,
  createdAt: auditLogTable.createdAt,
  user: usersTable.email,
  conversationId: auditLogTable.conversationId,
  event: auditLogTable.event,
  details: auditLogTable.details,
};

// Newest first. `before`: only entries older than that id, for the next page.
export async function listAudit(filter: AuditFilter & { before?: number; limit?: number } = {}) {
  const rows = await db
    .select(columns)
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.userId, usersTable.id))
    .where(and(matching(filter), filter.before ? lt(auditLogTable.id, filter.before) : undefined))
    .orderBy(desc(auditLogTable.id))
    .limit(filter.limit ?? 200);
  return rows.map((row) => ({ ...row, summary: describeEvent(row.event, row.details) }));
}

// Every matching entry as CSV, newest first, read in batches so a long log
// never has to fit in memory
export function exportAuditCsv(filter: AuditFilter) {
  const encoder = new TextEncoder();
  let before: number | undefined;
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(csvRow(["id", "time", "user", "event", "summary", "conversation", "details"])));
      }
      const rows = await listAudit({ ...filter, before, limit: 500 });
      if (!rows.length) return controller.close();
      before = rows[rows.length - 1]!.id;
      controller.enqueue(encoder.encode(rows.map((r) =>
        csvRow([r.id, r.createdAt.toISOString(), r.user, r.event, r.summary, r.conversationId, r.details]),
      ).join("")));
    },
  });
}
