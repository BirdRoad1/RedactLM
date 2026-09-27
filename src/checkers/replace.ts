import { createHmac } from "node:crypto";
import { env } from "../env/env";
import { rewriteTextDataUri } from "../files/extract";

// Placeholders are a keyed hash of the value and a scope (the conversation):
// the same value always gets the same placeholder within a conversation, in
// every message, file and turn, without storing the value anywhere; other
// conversations get different ones, so they can't be linked.
const key = createHmac("sha256", env.JWT_SECRET).update("llm-thingy:replacement-placeholders").digest();

export function placeholderFor(value: string, scope: string) {
  const hash = createHmac("sha256", key).update(scope).update("\0").update(value).digest("hex");
  return `redacted-${hash.slice(0, 12)}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Replaces every occurrence of each value, longest first so a value that
// contains another is replaced whole. Values made only of letters (names) are
// replaced as whole words, so "Jane" leaves "Janet" alone; anything with
// digits or symbols (numbers, emails, keys) is replaced wherever it appears.
export function replaceAll(text: string, replacements: Map<string, string>) {
  const values = [...replacements.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of values) {
    const placeholder = replacements.get(value)!;
    out = /^[\p{L}\s'’.-]+$/u.test(value)
      ? out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, "gu"), placeholder)
      : out.split(value).join(placeholder);
  }
  return out;
}

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
