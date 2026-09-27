import type { Context } from "hono";
import z from "zod";
import type { AuthEnv } from "../middleware/auth";
import { addKeywordsSchema } from "../schema/keywords.schema";
import { audit } from "../services/audit.service";
import * as keywordsService from "../services/keywords.service";

export async function listKeywords(c: Context<AuthEnv>) {
  return c.json(await keywordsService.listKeywords());
}

export async function addKeywords(c: Context<AuthEnv>) {
  const parsed = await addKeywordsSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Send {\"keywords\": [\"...\"]}: up to 50,000, each at most 500 characters" }, 400);
  }

  const result = await keywordsService.addKeywords(parsed.data.keywords, c.get("userId"));
  // how many, never which: the list is secret, and not everyone who reads
  // the audit log may see it
  if (result.added.length) await audit("keywords_added", { count: result.added.length });
  return c.json(result);
}

const keywordId = z.coerce.number().int().positive();

export async function deleteKeyword(c: Context<AuthEnv>) {
  const id = keywordId.safeParse(c.req.param("id"));
  if (id.error) return c.json({ error: "Keyword not found" }, 404);

  const deleted = await keywordsService.deleteKeywords([id.data]);
  if (!deleted.length) return c.json({ error: "Keyword not found" }, 404);
  await audit("keywords_deleted", { count: deleted.length });
  return c.body(null, 204);
}
