import { asc, eq, inArray } from "drizzle-orm";
import { buildKeywordIndex, normalizeKeyword, type KeywordIndex } from "../checkers/keywords";
import { db } from "../db";
import { keywordsTable, usersTable } from "../db/schema";

// The index every check uses, rebuilt from the table at most every
// CACHE_MS (and right away after a change here), so a long list isn't
// reloaded on every keystroke. Other instances of the app catch up within
// CACHE_MS.
const CACHE_MS = 15_000;
let cached: { index: KeywordIndex; at: number } | undefined;
let loading: Promise<KeywordIndex> | undefined;
// bumped on every change, so a load that started before one isn't cached
let version = 0;

function changed() {
  version++;
  cached = undefined;
  loading = undefined;
}

export async function getKeywordIndex() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.index;
  if (!loading) {
    const started = version;
    loading = db
      .select({ keyword: keywordsTable.keyword })
      .from(keywordsTable)
      .then((rows) => {
        const index = buildKeywordIndex(rows.map((r) => r.keyword));
        if (started === version) cached = { index, at: Date.now() };
        return index;
      })
      .finally(() => {
        if (started === version) loading = undefined;
      });
  }
  return loading;
}

export async function listKeywords() {
  return await db
    .select({ id: keywordsTable.id, keyword: keywordsTable.keyword, createdAt: keywordsTable.createdAt, createdBy: usersTable.email })
    .from(keywordsTable)
    .leftJoin(usersTable, eq(keywordsTable.createdBy, usersTable.id))
    .orderBy(asc(keywordsTable.keyword));
}

// Adds each keyword in its normalized form. Says which were added, which
// were already listed, and which had no letters or numbers to keep.
export async function addKeywords(inputs: string[], userId: number) {
  const empty: string[] = [];
  const wanted = new Set<string>();
  for (const input of inputs) {
    const keyword = normalizeKeyword(input);
    if (keyword) wanted.add(keyword);
    else if (input.trim()) empty.push(input);
  }

  // in batches: a statement can hold at most 65,535 values
  const rows = [...wanted].map((keyword) => ({ keyword, createdBy: userId }));
  const added: { keyword: string }[] = [];
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 5_000) {
      added.push(
        ...(await tx
          .insert(keywordsTable)
          .values(rows.slice(i, i + 5_000))
          .onConflictDoNothing()
          .returning({ keyword: keywordsTable.keyword })),
      );
    }
  });
  changed();

  const addedSet = new Set(added.map((a) => a.keyword));
  return {
    added: added.map((a) => a.keyword),
    alreadyListed: [...wanted].filter((k) => !addedSet.has(k)),
    empty,
  };
}

// The deleted keywords (ids that didn't exist are ignored)
export async function deleteKeywords(ids: number[]) {
  if (!ids.length) return [];
  const deleted = await db.delete(keywordsTable).where(inArray(keywordsTable.id, ids)).returning({ keyword: keywordsTable.keyword });
  changed();
  return deleted.map((d) => d.keyword);
}
