import type { Detection } from "../checkers/checker";
import { runLlmChecks } from "../checkers/llm/llm-checker";
import { outcomeFor, worstOutcome, type Outcome, type Policy } from "../checkers/policy";
import { runStaticChecks } from "../checkers/run-static-checks";

export type ScoredDetection = { detection: Detection; outcome: Outcome };

export type Scan = { scored: ScoredDetection[]; outcome: Outcome };

const score = (detections: Detection[], policy: Policy) =>
  detections.map((detection) => ({ detection, outcome: outcomeFor(detection, policy) }));

// Static checks, then the LLM detector unless the static checks already block
// (it's slow, and the answer can't get any worse). Throws
// LlmDetectorUnavailableError when the detector fails closed.
export async function scanText(text: string, policy: Policy, signal?: AbortSignal): Promise<Scan> {
  const scored = score(runStaticChecks(text), policy);

  if (worstOutcome(scored.map((s) => s.outcome)) !== "blocked") {
    scored.push(...score(await runLlmChecks(text, signal), policy));
  }

  return { scored, outcome: worstOutcome(scored.map((s) => s.outcome)) };
}

// Static checks only, for text we store but don't gate on (assistant replies)
export function scanStatic(text: string, policy: Policy): Scan {
  const scored = score(runStaticChecks(text), policy);
  return { scored, outcome: worstOutcome(scored.map((s) => s.outcome)) };
}
