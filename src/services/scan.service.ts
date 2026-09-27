import type { Detection } from "../checkers/checker";
import { runLlmChecks } from "../checkers/llm/llm-checker";
import { outcomeFor, worstOutcome, type Outcome, type Policy } from "../checkers/policy";
import { runStaticChecks } from "../checkers/run-static-checks";
import {
  attachmentFromPart,
  extractText,
  type Attachment,
} from "../files/extract";
import type { Message } from "../schema/completions-request.schema";

// Where in an attachment something was found
export type Source = { filename: string; page?: number };

export const describeSource = ({ filename, page }: Source) =>
  page === undefined ? filename : `${filename}, page ${page}`;

// `source` is set for detections in an attachment
export type ScoredDetection = { detection: Detection; outcome: Outcome; source?: Source };

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
export async function scanMessage(message: PreparedMessage, policy: Policy, signal?: AbortSignal): Promise<Scan> {
  const scans = await Promise.all([
    scanText(message.content, policy, signal),
    ...message.attachments.map(async (attachment) => {
      const pages = await extractText(attachment);
      const pageScans = await Promise.all(pages.map((p) => scanText(p.text, policy, signal)));
      return pageScans.flatMap((scan, i) =>
        scan.scored.map((s) => ({ ...s, source: { filename: attachment.filename, page: pages[i]!.page } })),
      );
    }),
  ]);

  const [text, ...files] = scans;
  const scored = [...(text as Scan).scored, ...(files as ScoredDetection[][]).flat()];
  return { scored, outcome: worstOutcome(scored.map((s) => s.outcome)) };
}
