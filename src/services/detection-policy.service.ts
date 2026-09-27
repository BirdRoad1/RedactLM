import { eq } from "drizzle-orm";
import type z from "zod";
import { CHECKER_NAME as KEYWORD_CHECKER } from "../checkers/keywords";
import { CHECKER_NAME as LLM_CHECKER } from "../checkers/llm/llm-checker";
import type { Policy, Thresholds } from "../checkers/policy";
import { staticCheckerNames } from "../checkers/run-static-checks";
import { db } from "../db";
import { checkerPoliciesTable, detectionPolicyTable } from "../db/schema";
import { getKeywordIndex } from "./keywords.service";
import {
  thresholdsOrdered,
  type thresholdsSchema,
  type updateDefaultsSchema,
} from "../schema/detection-policy.schema";

export class InvalidPolicyError extends Error {}

// Secure out of the box: every current detector scores 0.5+, so all block
const DEFAULTS: Thresholds = { warnAt: 0.3, blockAt: 0.5 };
const DEFAULT_MODE: Policy["mode"] = "block";

export function knownCheckers() {
  return [...staticCheckerNames, KEYWORD_CHECKER, LLM_CHECKER];
}

async function getDefaults(): Promise<Thresholds & { mode: Policy["mode"] }> {
  const [row] = await db.select().from(detectionPolicyTable).where(eq(detectionPolicyTable.id, 1));
  return row ? { warnAt: row.warnAt, blockAt: row.blockAt, mode: row.mode } : { ...DEFAULTS, mode: DEFAULT_MODE };
}

// Everything a check needs: thresholds, mode, and the custom keywords
export async function getPolicy(): Promise<Policy> {
  const [{ mode, ...defaults }, overrides, keywords] = await Promise.all([
    getDefaults(),
    db.select().from(checkerPoliciesTable),
    getKeywordIndex(),
  ]);
  return {
    mode,
    defaults,
    keywords,
    checkers: Object.fromEntries(
      overrides.map((o) => [o.checker, { warnAt: o.warnAt, blockAt: o.blockAt }]),
    ),
  };
}

// The policy as admins see it: defaults, plus the effective thresholds of every checker
export async function describePolicy() {
  const policy = await getPolicy();
  return {
    mode: policy.mode,
    ...policy.defaults,
    checkers: knownCheckers().map((checker) => {
      const override = policy.checkers[checker];
      return { checker, ...(override ?? policy.defaults), overridden: !!override };
    }),
  };
}

export async function updateDefaults(changes: z.infer<typeof updateDefaultsSchema>) {
  const next = { ...(await getDefaults()), ...changes };
  if (!thresholdsOrdered(next)) throw new InvalidPolicyError("warnAt must not be above blockAt");

  await db
    .insert(detectionPolicyTable)
    .values({ id: 1, ...next })
    .onConflictDoUpdate({ target: detectionPolicyTable.id, set: next });
  return describePolicy();
}

function assertKnown(checker: string) {
  if (!knownCheckers().includes(checker)) {
    throw new InvalidPolicyError(`Unknown checker "${checker}"; known: ${knownCheckers().join(", ")}`);
  }
}

export async function setCheckerOverride(checker: string, thresholds: z.infer<typeof thresholdsSchema>) {
  assertKnown(checker);
  await db
    .insert(checkerPoliciesTable)
    .values({ checker, ...thresholds })
    .onConflictDoUpdate({ target: checkerPoliciesTable.checker, set: thresholds });
  return describePolicy();
}

// Back to the global thresholds
export async function deleteCheckerOverride(checker: string) {
  assertKnown(checker);
  await db.delete(checkerPoliciesTable).where(eq(checkerPoliciesTable.checker, checker));
  return describePolicy();
}
