import type { Detection } from "./checker";

// Confidence at or above which a detection warns / blocks; null = never
export type Thresholds = { warnAt: number | null; blockAt: number | null };

export type Policy = {
  mode: "block" | "replace"; // what reaching blockAt does where content can be edited
  defaults: Thresholds;
  checkers: Record<string, Thresholds>; // overrides, keyed by checker name
};

// "redacted": would block, but gets replaced with a placeholder instead
export type Outcome = "ignored" | "warned" | "redacted" | "blocked";

const severity: Record<Outcome, number> = { ignored: 0, warned: 1, redacted: 2, blocked: 3 };

// `editable`: the text can be changed cleanly before sending (message text,
// text files), so in replace mode a block becomes a replacement
export function outcomeFor(detection: Detection, policy: Policy, editable = false): Outcome {
  const { warnAt, blockAt } = policy.checkers[detection.checker] ?? policy.defaults;
  if (blockAt !== null && detection.confidence >= blockAt) {
    return editable && policy.mode === "replace" ? "redacted" : "blocked";
  }
  if (warnAt !== null && detection.confidence >= warnAt) return "warned";
  return "ignored";
}

export function worstOutcome(outcomes: Outcome[]): Outcome {
  return outcomes.reduce<Outcome>((worst, o) => (severity[o] > severity[worst] ? o : worst), "ignored");
}

// Detected spans with overlapping ones merged, in order
export function mergeSpans<T extends { start: number; end: number }>(spans: T[]) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; first: T }[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end, first: span });
  }
  return merged;
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
