import type { Context } from "hono";
import { updateLlmDetectorSchema } from "../schema/llm-detector.schema";
import * as llmDetectorService from "../services/llm-detector.service";

export async function getLlmDetector(c: Context) {
  return c.json(await llmDetectorService.getLlmDetectorConfig());
}

export async function updateLlmDetector(c: Context) {
  const parsed = await updateLlmDetectorSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Invalid request", issues: parsed.error.issues }, 400);
  }

  try {
    return c.json(await llmDetectorService.updateLlmDetectorConfig(parsed.data));
  } catch (err) {
    if (err instanceof llmDetectorService.InvalidDetectorConfigError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
}
