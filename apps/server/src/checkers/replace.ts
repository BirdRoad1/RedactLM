import { createHmac } from "node:crypto";
import { placeholderLabel, replaceValues } from "@llm-thingy/shared";
import { env } from "../env/env";
import { rewriteTextDataUri } from "../files/extract";
import { CHECKER_NAME as KEYWORD_CHECKER } from "./keywords";
import { staticCheckerNames } from "./run-static-checks";

// Placeholders are a keyed hash of the value and a scope (the conversation):
// the same value always gets the same placeholder within a conversation, in
// every message, file and turn, without storing the value anywhere; other
// conversations get different ones, so they can't be linked.
const key = createHmac("sha256", env.JWT_SECRET).update("llm-thingy:replacement-placeholders").digest();

// What the rules (and custom keywords) find is labelled with what it is,
// "SSN-3f9a1c0b7e2d"; what the local AI model finds stays "redacted-…".
// The label isn't part of the hash, so it can't make one value two placeholders.
const labelled = new Set([...staticCheckerNames, KEYWORD_CHECKER]);

export function placeholderFor(value: string, scope: string, checker?: string) {
  const hash = createHmac("sha256", key).update(scope).update("\0").update(value).digest("hex");
  const label = checker && labelled.has(checker) ? placeholderLabel(checker) : "redacted";
  return `${label}-${hash.slice(0, 12)}`;
}

// Replaces every occurrence of each value (the matching rule is shared with
// the web app, which shows what the AI saw)
export const replaceAll = (text: string, replacements: Map<string, string>) => replaceValues(text, replacements);

type Part = { type: string; text?: string; file?: { file_data?: string } };

// The messages with every value swapped for its placeholder: plain-text
// content and plain-text files. PDFs and images are left alone (anything in
// them that needed replacing has already blocked the request).
export function replaceInMessages<M extends { content?: unknown }>(messages: M[], replacements: Map<string, string>): M[] {
  if (!replacements.size) return messages;
  const swap = (text: string) => replaceAll(text, replacements);
  return messages.map((message) => {
    if (typeof message.content === "string") return { ...message, content: swap(message.content) };
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: (message.content as Part[]).map((part) => {
        if (part.type === "text" && part.text !== undefined) return { ...part, text: swap(part.text) };
        if (part.type === "file" && part.file?.file_data) {
          return { ...part, file: { ...part.file, file_data: rewriteTextDataUri(part.file.file_data, swap) } };
        }
        return part;
      }),
    };
  });
}
