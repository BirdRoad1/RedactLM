import { describe, expect, test } from "bun:test";
import {
  buildDetectorRequest,
  locateFindings,
  parseFindings,
} from "../src/checkers/llm/llm-checker";

const finding = (text: string, confidence = 0.9, category = "person_name") => ({
  text,
  category,
  confidence,
  reason: "test",
});

describe("parseFindings", () => {
  test("plain JSON", () => {
    expect(parseFindings('{"findings":[]}')).toEqual({ findings: [] });
  });

  test("code fences, think blocks and chatter", () => {
    const reply =
      '<think>the name {is} sensitive</think>Sure! ```json\n{"findings":[{"text":"Jane","category":"person_name","confidence":0.9,"reason":"name"}]}\n```';
    expect(parseFindings(reply)?.findings[0]?.text).toBe("Jane");
  });

  test("garbage is undefined, not an empty result", () => {
    // an unparseable reply must not be mistaken for "nothing found"
    expect(parseFindings("I can't help with that.")).toBeUndefined();
    expect(parseFindings('{"findings": "none"}')).toBeUndefined();
    expect(parseFindings('{"findings": [')).toBeUndefined();
  });
});

describe("locateFindings", () => {
  const text = "Client Jane Smith (jane smith on the old form) wants to move $2M.";

  test("finds every occurrence, case-insensitively, with positions", () => {
    const detections = locateFindings(text, { findings: [finding("Jane Smith")] }, 0.5);
    expect(detections.map((d) => [d.contents, d.start, d.end])).toEqual([
      ["Jane Smith", 7, 17],
      ["jane smith", 19, 29],
    ]);
    expect(detections[0]?.checker).toBe("local-llm");
    expect(detections[0]?.userFacingReason).toContain("private individual");
  });

  test("drops findings that aren't in the text", () => {
    expect(locateFindings(text, { findings: [finding("John Doe")] }, 0.5)).toEqual([]);
  });

  test("drops findings under minConfidence", () => {
    expect(locateFindings(text, { findings: [finding("Jane Smith", 0.4)] }, 0.5)).toEqual([]);
  });

  test("clamps confidence and maps unknown categories", () => {
    const [d] = locateFindings(text, { findings: [finding("Jane Smith", 7, "made_up")] }, 0.5);
    expect(d?.confidence).toBe(1);
    expect(d?.reason).toStartWith("other_pii:");
  });

  test("ignores empty and one-character findings", () => {
    expect(locateFindings(text, { findings: [finding(" "), finding("a")] }, 0)).toEqual([]);
  });
});

describe("buildDetectorRequest", () => {
  test("wraps the text and appends company instructions", () => {
    const body = buildDetectorRequest("m", "hello", "Flag the codename Bluebird.");
    expect(body.messages[0]?.content).toEndWith("Flag the codename Bluebird.");
    expect(body.messages[1]?.content).toBe("<message>\nhello\n</message>");
    expect(body.temperature).toBe(0);
  });
});
