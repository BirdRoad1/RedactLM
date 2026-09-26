import type { Context } from "hono";
import { checkRequestSchema, type Issue } from "../schema/check.schema";
import { getPolicy } from "../services/detection-policy.service";
import { scanStatic } from "../services/scan.service";

// Live preview while typing: static checks only (fast, free, and nothing is
// sent to any model), nothing stored. The LLM detector still runs on send.
export async function checkText(c: Context) {
  const parsed = await checkRequestSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Send {\"text\": \"...\"} of at most 100,000 characters" }, 400);
  }

  const { scored } = scanStatic(parsed.data.text, await getPolicy());
  const issues: Issue[] = scored.flatMap(({ detection: d, outcome }) =>
    outcome === "ignored"
      ? []
      : [{
          start: d.start,
          end: d.end,
          outcome,
          title: d.title,
          reason: d.userFacingReason,
          explanation: d.explanation,
          confidence: d.confidence,
        }],
  );

  return c.json({ issues });
}
