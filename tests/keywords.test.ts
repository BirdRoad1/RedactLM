import { describe, expect, test } from "bun:test";
import { buildKeywordIndex, findKeywords, normalizeKeyword } from "../src/checkers/keywords";

describe("normalizeKeyword: how keywords are saved", () => {
  test.each([
    ["What's up?", "whats up"],
    ["  Project   FALCON  ", "project falcon"],
    ["Acme-Corp", "acmecorp"],
    ["R&D budget 2027", "rd budget 2027"],
    ["Ünïcode Straße", "ünïcode straße"],
    ["!!! ???", ""],
  ])("%p → %p", (input, saved) => {
    expect(normalizeKeyword(input)).toBe(saved);
  });
});

describe("findKeywords", () => {
  const index = buildKeywordIndex(["What's up?", "Project Falcon", "falcon", "Acme Corp", "Q3"]);
  const found = (text: string) => findKeywords(text, index).map((d) => text.slice(d.start, d.end));

  test("ignores capitalization and special characters", () => {
    expect(found("WHAT'S UP!! and whats   up")).toEqual(["WHAT'S UP", "whats   up"]);
  });

  test("covers the original characters, not surrounding punctuation", () => {
    expect(found('Ask about "Acme Corp."')).toEqual(["Acme Corp"]);
  });

  test("matches whole words only", () => {
    expect(found("Falconry and falcons and Q3s")).toEqual([]);
  });

  test("apostrophes are just dropped, like any other special character", () => {
    expect(found("Falcon's budget")).toEqual([]); // "falcons", not "falcon"
    expect(found("Project-Falcon")).toEqual([]); // "projectfalcon" is one word
  });

  test("keywords across a line break", () => {
    expect(found("the project\nfalcon plan")).toEqual(["project\nfalcon", "falcon"]);
  });

  test("a keyword at the very end of the text", () => {
    expect(found("revenue in q3")).toEqual(["q3"]);
  });

  test("nothing listed, nothing found", () => {
    expect(findKeywords("Project Falcon", buildKeywordIndex([]))).toEqual([]);
  });

  test("fast with many keywords", () => {
    const big = buildKeywordIndex(Array.from({ length: 50_000 }, (_, i) => `codename ${i} alpha`));
    const text = "lorem ipsum dolor sit amet ".repeat(4_000) + "codename 49999 alpha";
    const t = performance.now();
    expect(findKeywords(text, big)).toHaveLength(1);
    expect(performance.now() - t).toBeLessThan(200);
  });
});
