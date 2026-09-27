import type { Detection } from "../checkers/checker";
import { runLlmChecks } from "../checkers/llm/llm-checker";
import { mergeSpans, outcomeFor, worstOutcome, type Outcome, type Policy } from "../checkers/policy";
import { runStaticChecks } from "../checkers/run-static-checks";
import {
  attachmentFromPart,
  extractText,
  type Attachment,
} from "../files/extract";
import type { Message } from "../schema/completions-request.schema";
import { getLlmDetectorConfig } from "./llm-detector.service";

// Where in an attachment something was found
export type Source = { filename: string; page?: number };

export const describeSource = ({ filename, page }: Source) =>
  page === undefined ? filename : `${filename}, page ${page}`;

// `source` is set for detections in an attachment
export type ScoredDetection = { detection: Detection; outcome: Outcome; source?: Source };

// Text longer than the LLM detector reads: the rule-based checks covered all
// of it, the detector only the first `checkedChars`
export type PartialCheck = { source?: Source; checkedChars: number; totalChars: number };

// Something to swap for a placeholder before sending: the exact text found,
// where (in the message text, or in a text attachment), and what it is
export type Replacement = { value: string; start: number; end: number; title: string; source?: Source };

export type Scan = {
  scored: ScoredDetection[];
  outcome: Outcome;
  partial?: PartialCheck[];
  replacements?: Replacement[];
};

const score = (detections: Detection[], policy: Policy, editable = false) =>
  detections.map((detection) => ({ detection, outcome: outcomeFor(detection, policy, editable) }));

// The spans of `text` that are to be replaced, overlapping ones merged
function replacementsIn(text: string, scored: ScoredDetection[], source?: Source): Replacement[] {
  const spans = scored
    .filter((s) => s.outcome === "redacted")
    .map((s) => ({ start: s.detection.start, end: s.detection.end, title: s.detection.title }));
  return mergeSpans(spans).map(({ start, end, first }) => ({
    value: text.slice(start, end),
    start,
    end,
    title: first.title,
    source,
  }));
}

// Static checks over all of `text`, then the LLM detector over its first
// `llmChars` characters, unless the static checks already block (it's slow,
// and the answer can't get any worse). `editable`: the text can be changed
// before sending, so in replace mode blocks become replacements. Throws
// LlmDetectorUnavailableError when the detector fails closed.
export async function scanText(text: string, policy: Policy, signal?: AbortSignal, llmChars = Infinity, editable = false): Promise<Scan> {
  const scored = score(runStaticChecks(text), policy, editable);

  if (llmChars > 0 && worstOutcome(scored.map((s) => s.outcome)) !== "blocked") {
    scored.push(...score(await runLlmChecks(text.slice(0, llmChars), signal), policy, editable));
  }

  return { scored, outcome: worstOutcome(scored.map((s) => s.outcome)) };
}

// Static checks only, for text we store but don't gate on (assistant replies)
export function scanStatic(text: string, policy: Policy, editable = false): Scan {
  const scored = score(runStaticChecks(text), policy, editable);
  return { scored, outcome: worstOutcome(scored.map((s) => s.outcome)) };
}

// A message as we check and store it: its text parts joined, plus attachments
export type PreparedMessage = { role: Message["role"]; content: string; attachments: Attachment[] };

// Throws UnsupportedAttachmentError for attachments that can't be checked
export function prepareMessage(message: Message): PreparedMessage {
  if (typeof message.content === "string") return { role: message.role, content: message.content, attachments: [] };

  const texts: string[] = [];
  const attachments: Attachment[] = [];
  for (const part of message.content ?? []) {
    if (part.type === "text") texts.push(part.text);
    else if (part.type === "refusal") texts.push(part.refusal);
    else attachments.push(attachmentFromPart(part, attachments.length + 1));
  }
  return { role: message.role, content: texts.join("\n\n"), attachments };
}

// Checks the text and every page of every attachment. Throws
// UnsupportedAttachmentError when a file can't be read, and
// LlmDetectorUnavailableError when the detector fails closed.
// The LLM detector reads at most `maxChars` of the message text and of each
// attachment (across its pages); the rule-based checks read everything.
export async function scanMessage(message: PreparedMessage, policy: Policy, signal?: AbortSignal): Promise<Scan> {
  const detector = await getLlmDetectorConfig();
  const limit = detector.enabled ? detector.maxChars : Infinity;
  const partial: PartialCheck[] = [];
  if (message.content.length > limit) {
    partial.push({ checkedChars: limit, totalChars: message.content.length });
  }

  const scans = await Promise.all([
    scanText(message.content, policy, signal, limit, true),
    ...message.attachments.map(async (attachment) => {
      const pages = await extractText(attachment);

      // one budget per way of reading the file (OCR, stored text), used up page by page
      const left = { ocr: limit, file: limit };
      const total = { ocr: 0, file: 0 };
      const budgets = pages.map((p) => {
        const budget = Math.max(0, left[p.from]);
        left[p.from] -= p.text.length;
        total[p.from] += p.text.length;
        return budget;
      });
      const longest = Math.max(total.ocr, total.file);
      if (longest > limit) {
        partial.push({ source: { filename: attachment.filename }, checkedChars: limit, totalChars: longest });
      }

      // only plain-text files can be edited cleanly; PDFs and images block as before
      const editable = attachment.kind === "text";
      const pageScans = await Promise.all(pages.map((p, i) => scanText(p.text, policy, signal, budgets[i], editable)));
      const scored = pageScans.flatMap((scan, i) =>
        scan.scored.map((s) => ({ ...s, source: { filename: attachment.filename, page: pages[i]!.page } })),
      );
      const replacements = editable
        ? replacementsIn(pages[0]?.text ?? "", pageScans[0]?.scored ?? [], { filename: attachment.filename })
        : [];
      return { scored, replacements };
    }),
  ]);

  const [text, ...files] = scans as [Scan, ...{ scored: ScoredDetection[]; replacements: Replacement[] }[]];
  const scored = [...text.scored, ...files.flatMap((f) => f.scored)];
  const replacements = [...replacementsIn(message.content, text.scored), ...files.flatMap((f) => f.replacements)];
  return {
    scored,
    outcome: worstOutcome(scored.map((s) => s.outcome)),
    partial: partial.length ? partial : undefined,
    replacements: replacements.length ? replacements : undefined,
  };
}
