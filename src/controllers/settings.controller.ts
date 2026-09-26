import type { Context } from "hono";
import type { ZodError } from "zod";
import {
  thresholdsSchema,
  updateDefaultsSchema,
} from "../schema/detection-policy.schema";
import { updateLlmDetectorSchema } from "../schema/llm-detector.schema";
import * as detectionPolicyService from "../services/detection-policy.service";
import * as llmDetectorService from "../services/llm-detector.service";

export async function getLlmDetector(c: Context) {
  return c.json(await llmDetectorService.getLlmDetectorConfig());
}

export async function updateLlmDetector(c: Context) {
  const parsed = await updateLlmDetectorSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return invalid(c, parsed.error);
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

export async function getDetectionPolicy(c: Context) {
  return c.json(await detectionPolicyService.describePolicy());
}

export async function updateDetectionDefaults(c: Context) {
  const parsed = await updateDefaultsSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return invalid(c, parsed.error);
  }
  return policyResponse(c, () => detectionPolicyService.updateDefaults(parsed.data));
}

export async function setCheckerPolicy(c: Context) {
  const parsed = await thresholdsSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return invalid(c, parsed.error);
  }
  return policyResponse(c, () =>
    detectionPolicyService.setCheckerOverride(c.req.param("checker")!, parsed.data),
  );
}

export async function deleteCheckerPolicy(c: Context) {
  return policyResponse(c, () =>
    detectionPolicyService.deleteCheckerOverride(c.req.param("checker")!),
  );
}

async function policyResponse(c: Context, run: () => Promise<unknown>) {
  try {
    return c.json(await run());
  } catch (err) {
    if (err instanceof detectionPolicyService.InvalidPolicyError) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
}

// Says what's wrong ("warnAt must not be above blockAt"), not just "Invalid request"
function invalid(c: Context, error: ZodError) {
  const message = error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
  return c.json({ error: message, issues: error.issues }, 400);
}
