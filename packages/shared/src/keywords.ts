// Custom keywords are kept, and matched, ignoring capitalization and
// anything that isn't a letter or number: "What's up?" is kept as "whats up".

// A word as stored and matched: letters and numbers only, lowercase
export function normalizeWord(word: string) {
  return word.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// How a keyword is stored: its words normalized and joined by single spaces.
// Empty when nothing is left (e.g. "!!!").
export function normalizeKeyword(keyword: string) {
  return keyword.split(/\s+/u).map(normalizeWord).filter(Boolean).join(" ");
}
