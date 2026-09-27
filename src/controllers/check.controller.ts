import type { Context } from "hono";
import { attachmentFromPart, extractText, UnsupportedAttachmentError } from "../files/extract";
import { checkFileRequestSchema, checkRequestSchema, type Issue } from "../schema/check.schema";
import { getPolicy } from "../services/detection-policy.service";
import { getLlmDetectorConfig } from "../services/llm-detector.service";
import { scanStatic } from "../services/scan.service";

// Live preview while typing: static checks only (fast, free, and nothing is
// sent to any model), nothing stored. The LLM detector still runs on send.
export async function checkText(c: Context) {
  const parsed = await checkRequestSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Send {\"text\": \"...\"} of at most 100,000 characters" }, 400);
  }

  return c.json({ issues: issuesIn(parsed.data.text, await getPolicy()) });
}

function issuesIn(text: string, policy: Awaited<ReturnType<typeof getPolicy>>): Issue[] {
  return scanStatic(text, policy).scored.flatMap(({ detection: d, outcome }) =>
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
}

// Checks an attachment when it's attached. Reading it is local (OCR for
// images and PDF pages, never an AI model); the checks are the static ones.
// Sending re-checks with everything, the LLM detector included.
export async function checkFile(c: Context) {
  const parsed = await checkFileRequestSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Send {\"filename\": \"...\", \"data\": \"data:...;base64,...\"}" }, 400);
  }

  try {
    const attachment = attachmentFromPart(
      { type: "file", file: { filename: parsed.data.filename, file_data: parsed.data.data } },
      1,
    );
    const pages = await extractText(attachment);
    const [policy, detector] = await Promise.all([getPolicy(), getLlmDetectorConfig()]);

    // how much of it the LLM detector will read when it's sent
    const totals = { ocr: 0, file: 0 };
    for (const p of pages) totals[p.from] += p.text.length;
    const totalChars = Math.max(totals.ocr, totals.file);
    const partial = detector.enabled && totalChars > detector.maxChars
      ? { checkedChars: detector.maxChars, totalChars }
      : null;

    return c.json({
      pages: attachment.kind === "pdf" ? new Set(pages.map((p) => p.page)).size : null,
      partial,
      issues: pages.flatMap((p) => issuesIn(p.text, policy).map((issue) => ({ ...issue, page: p.page ?? null }))),
    });
  } catch (err) {
    if (err instanceof UnsupportedAttachmentError) return c.json({ error: err.message }, 400);
    throw err;
  }
}
