// In replace mode, sensitive values are swapped for placeholders before the
// AI sees them. What a rule found says what it was ("SSN-3f9a1c0b7e2d"), which
// helps the AI answer; what the local AI model found is "redacted-3f9a1c0b7e2d",
// since its categories are guesses. The 12 hex characters are a keyed hash of
// the value and the conversation, made by the server.

// A placeholder anywhere in text
export const PLACEHOLDER = /\b(?:redacted|[A-Z][A-Z_]*)-[0-9a-f]{12}\b/g;

// "credit-card" -> "CREDIT_CARD"
export const placeholderLabel = (checker: string) => checker.toUpperCase().replace(/[^A-Z]+/g, "_");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Values made only of letters (names) match as whole words, so "Jane" leaves
// "Janet" alone; anything with digits or symbols (numbers, emails, keys)
// matches wherever it appears
const wordsOnly = (value: string) => /^[\p{L}\s'’.-]+$/u.test(value);

// Finds every value at once, longest first so a value that contains another
// is found whole. Undefined when there are no values.
export function valuesPattern(values: Iterable<string>) {
  const sorted = [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!sorted.length) return undefined;
  const alternatives = sorted.map((v) => (wordsOnly(v) ? `(?<![\\p{L}\\p{N}])${escape(v)}(?![\\p{L}\\p{N}])` : escape(v)));
  return new RegExp(alternatives.join("|"), "gu");
}

// Replaces every value with its placeholder in one pass, so a placeholder
// already put in is never matched again (a keyword "SSN" can't break "SSN-…")
export function replaceValues(text: string, replacements: ReadonlyMap<string, string>) {
  const pattern = valuesPattern(replacements.keys());
  return pattern ? text.replace(pattern, (value) => replacements.get(value) ?? value) : text;
}
