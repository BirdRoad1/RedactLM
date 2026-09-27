import { DetectionType, type Detection } from "./checker";
import { Confidence } from "./confidence";
import { normalizeKeyword, normalizeWord } from "@redactlm/shared";

// how keywords are kept is shared with the web app's preview
export { normalizeKeyword };

// Custom keywords: terms the company keeps private (project codenames,
// clients, internal names). Matched word for word, ignoring capitalization
// and anything that isn't a letter or number, so "What's up?" is kept as
// "whats up" and found in "WHAT'S UP!!" or "whats   up". Rule-based only:
// the list never goes to the LLM detector.

export const CHECKER_NAME = "keyword";

// Keywords by their first word, so checking a message looks up each of its
// words once instead of trying every keyword: fast with thousands of them
export type KeywordIndex = Map<string, string[][]>;

export function buildKeywordIndex(keywords: string[]): KeywordIndex {
  const index: KeywordIndex = new Map();
  for (const keyword of keywords) {
    const words = normalizeKeyword(keyword).split(" ").filter(Boolean);
    if (!words.length) continue;
    const list = index.get(words[0]!) ?? [];
    list.push(words);
    index.set(words[0]!, list);
  }
  return index;
}

const wording = {
  title: "Private company term",
  userFacingReason: "This is on your company's list of terms that shouldn't be shared with AI tools.",
  explanation:
    "Your company keeps this private, like an internal project name, a client or a trade secret. Leave it out or describe it in general terms instead.",
};

// Every keyword in `text`, located by the original characters (from its first
// letter or number to its last)
export function findKeywords(text: string, index: KeywordIndex): Detection[] {
  if (!index.size) return [];

  const words: { word: string; start: number; end: number }[] = [];
  for (const chunk of text.matchAll(/\S+/gu)) {
    const word = normalizeWord(chunk[0]);
    if (!word) continue; // punctuation on its own
    const first = chunk[0].search(/[\p{L}\p{N}]/u);
    const last = /[\p{L}\p{N}](?=[^\p{L}\p{N}]*$)/u.exec(chunk[0])!;
    words.push({ word, start: chunk.index + first, end: chunk.index + last.index + last[0].length });
  }

  const detections: Detection[] = [];
  for (let i = 0; i < words.length; i++) {
    for (const keyword of index.get(words[i]!.word) ?? []) {
      if (i + keyword.length > words.length) continue;
      if (!keyword.every((w, j) => words[i + j]!.word === w)) continue;
      const start = words[i]!.start;
      const end = words[i + keyword.length - 1]!.end;
      detections.push({
        checker: CHECKER_NAME,
        contents: text.slice(start, end),
        start,
        end,
        confidence: Confidence.YUP,
        reason: "Matched a custom keyword",
        type: DetectionType.STATIC,
        ...wording,
      });
    }
  }
  return detections;
}
