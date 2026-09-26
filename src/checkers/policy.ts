import type { Detection } from "./checker";

// Confidence at or above which a detection warns / blocks; null = never
export type Thresholds = { warnAt: number | null; blockAt: number | null };

export type Policy = {
  defaults: Thresholds;
  checkers: Record<string, Thresholds>; // overrides, keyed by checker name
};

export type Outcome = "ignored" | "warned" | "blocked";

const severity: Record<Outcome, number> = { ignored: 0, warned: 1, blocked: 2 };

export function outcomeFor(detection: Detection, policy: Policy): Outcome {
  const { warnAt, blockAt } = policy.checkers[detection.checker] ?? policy.defaults;
  if (blockAt !== null && detection.confidence >= blockAt) return "blocked";
  if (warnAt !== null && detection.confidence >= warnAt) return "warned";
  return "ignored";
}

export function worstOutcome(outcomes: Outcome[]): Outcome {
  return outcomes.reduce<Outcome>((worst, o) => (severity[o] > severity[worst] ? o : worst), "ignored");
}

// Masks every detected span, whatever its outcome: anything a checker flagged
// is kept out of storage. Overlapping spans are merged into one mask, which
// reads like "[REDACTED: Phone number]".
export function redact(text: string, detections: Detection[]) {
  const spans = detections
    .map((d) => ({ start: d.start, end: d.end, title: d.title }))
    .sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;
  for (let i = 0; i < spans.length; ) {
    const { start, title } = spans[i]!;
    let end = spans[i]!.end;
    // absorb every span that overlaps the current one
    while (++i < spans.length && spans[i]!.start < end) end = Math.max(end, spans[i]!.end);

    out += text.slice(cursor, Math.max(start, cursor)) + `[REDACTED: ${title}]`;
    cursor = Math.max(cursor, end);
  }
  return out + text.slice(cursor);
}
