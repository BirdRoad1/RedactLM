import type { Context } from "hono";
import type { ZodError } from "zod";
import {
  thresholdsSchema,
  updateDefaultsSchema,
} from "../schema/detection-policy.schema";
import { updateLlmDetectorSchema } from "../schema/llm-detector.schema";
import { audit, type AuditEvents } from "../services/audit.service";
import { listBackends } from "../services/backends.service";
import * as detectionPolicyService from "../services/detection-policy.service";
import * as llmDetectorService from "../services/llm-detector.service";

export async function getLlmDetector(c: Context) {
  return c.json(await llmDetectorService.getLlmDetectorConfig());
}

// The backends the detector may use (local ones), without their addresses or
// keys: choosing one doesn't need manage_backends
export async function listDetectorBackends(c: Context) {
  const backends = await listBackends();
  return c.json(
    backends
      .filter((b) => b.trust === "local")
      .map(({ id, name, slug, enabled }) => ({ id, name, slug, enabled })),
  );
}

export async function updateLlmDetector(c: Context) {
  const parsed = await updateLlmDetectorSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return invalid(c, parsed.error);
  }

  try {
    const updated = await llmDetectorService.updateLlmDetectorConfig(parsed.data);
    await audit("settings_changed", { setting: "the LLM detector settings", changes: parsed.data });
    return c.json(updated);
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
  return policyResponse(c, () => detectionPolicyService.updateDefaults(parsed.data), {
    setting: "the detection policy defaults",
    changes: parsed.data,
  });
}

export async function setCheckerPolicy(c: Context) {
  const parsed = await thresholdsSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return invalid(c, parsed.error);
  }
  const checker = c.req.param("checker")!;
  return policyResponse(c, () => detectionPolicyService.setCheckerOverride(checker, parsed.data), {
    setting: `the thresholds for "${checker}"`,
    changes: parsed.data,
  });
}

export async function deleteCheckerPolicy(c: Context) {
  const checker = c.req.param("checker")!;
  return policyResponse(c, () => detectionPolicyService.deleteCheckerOverride(checker), {
    setting: `the thresholds for "${checker}"`,
    changes: { override: "removed, back to the defaults" },
  });
}

async function policyResponse(c: Context, run: () => Promise<unknown>, change: AuditEvents["settings_changed"]) {
  try {
    const result = await run();
    await audit("settings_changed", change);
    return c.json(result);
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
