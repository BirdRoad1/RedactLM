import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { backendsTable } from "../db/schema";
import type { CreateBackend } from "../schema/backends.schema";

export type Backend = typeof backendsTable.$inferSelect;

export class BackendSlugTakenError extends Error {
  constructor(slug: string) {
    super(`A backend with slug "${slug}" already exists`);
  }
}

// Postgres unique violations come wrapped in a DrizzleQueryError
function uniqueViolation(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string; constraint?: string } })
    ?.cause;
  return cause?.code === "23505" ? (cause.constraint ?? "unknown") : undefined;
}

export async function listBackends() {
  return await db.select().from(backendsTable);
}

export async function listEnabledBackends() {
  return await db
    .select()
    .from(backendsTable)
    .where(eq(backendsTable.enabled, true));
}

// "slug/model" picks the backend by slug, a bare "model" goes to the default
// backend. An unknown slug is never sent to the default backend, so a typo
// can't route a prompt somewhere the user didn't pick.
export async function resolveModel(model: string) {
  const slash = model.indexOf("/");
  const upstreamModel = slash === -1 ? model : model.slice(slash + 1);
  if (!upstreamModel) return undefined;

  const [backend] = await db
    .select()
    .from(backendsTable)
    .where(
      and(
        eq(backendsTable.enabled, true),
        slash === -1
          ? eq(backendsTable.isDefault, true)
          : eq(backendsTable.slug, model.slice(0, slash)),
      ),
    );

  return backend && { backend, upstreamModel };
}

export async function createBackend(data: CreateBackend) {
  try {
    return await db.transaction(async (tx) => {
      // only one default: the new one replaces the old one
      if (data.isDefault) {
        await tx
          .update(backendsTable)
          .set({ isDefault: false })
          .where(eq(backendsTable.isDefault, true));
      }

      return (await tx.insert(backendsTable).values(data).returning())[0]!;
    });
  } catch (err) {
    // two concurrent "make default" requests can still collide on
    // backends_single_default_idx; that one is left as a 500 for now.
    if (uniqueViolation(err) === "backends_slug_idx") {
      throw new BackendSlugTakenError(data.slug);
    }
    throw err;
  }
}

// Returns the deleted backend, or undefined if it didn't exist
export async function deleteBackend(id: number) {
  return (
    await db.delete(backendsTable).where(eq(backendsTable.id, id)).returning()
  )[0];
}
