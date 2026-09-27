import { describe, expect, test } from "bun:test";
import { DetectionType, type Detection } from "../src/checkers/checker";
import { outcomeFor, redact, worstOutcome, type Policy } from "../src/checkers/policy";

const detection = (checker: string, confidence: number, start = 0, end = 1, title = checker): Detection => ({
  checker,
  contents: "",
  start,
  end,
  confidence,
  reason: "",
  userFacingReason: "",
  title,
  explanation: "",
  type: DetectionType.STATIC,
});

describe("outcomeFor", () => {
  const policy: Policy = {
    mode: "block",
    defaults: { warnAt: 0.3, blockAt: 0.8 },
    checkers: {
      phone: { warnAt: 0.5, blockAt: null }, // warn only
      email: { warnAt: null, blockAt: null }, // off
    },
  };

  test.each([
    ["ssn", 0.9, "blocked"],
    ["ssn", 0.8, "blocked"], // inclusive
    ["ssn", 0.5, "warned"],
    ["ssn", 0.3, "warned"],
    ["ssn", 0.1, "ignored"],
    ["phone", 1, "warned"], // override: never blocks
    ["phone", 0.4, "ignored"],
    ["email", 1, "ignored"],
  ] as const)("%s at %d -> %s", (checker, confidence, expected) => {
    expect(outcomeFor(detection(checker, confidence), policy)).toBe(expected);
  });

  test("worstOutcome", () => {
    expect(worstOutcome([])).toBe("ignored");
    expect(worstOutcome(["warned", "ignored"])).toBe("warned");
    expect(worstOutcome(["warned", "blocked", "ignored"])).toBe("blocked");
  });
});

describe("redact", () => {
  const text = "SSN 123-45-6789, call 212-555-1234.";

  test("masks each span", () => {
    expect(redact(text, [detection("ssn", 1, 4, 15, "SSN"), detection("phone", 1, 22, 34, "Phone number")])).toBe(
      "SSN [REDACTED: SSN], call [REDACTED: Phone number].",
    );
  });

  test("order of detections doesn't matter", () => {
    expect(redact(text, [detection("phone", 1, 22, 34), detection("ssn", 1, 4, 15)])).toBe(
      "SSN [REDACTED: ssn], call [REDACTED: phone].",
    );
  });

  test("overlapping and nested spans become one mask", () => {
    expect(redact("abcdefghij", [detection("a", 1, 2, 6), detection("b", 1, 4, 8), detection("c", 1, 5, 6)])).toBe(
      "ab[REDACTED: a]ij",
    );
  });

  test("adjacent spans stay separate", () => {
    expect(redact("abcdef", [detection("a", 1, 0, 3), detection("b", 1, 3, 6)])).toBe(
      "[REDACTED: a][REDACTED: b]",
    );
  });

  test("no detections leaves text alone", () => {
    expect(redact(text, [])).toBe(text);
  });

  test("the original sensitive text never survives", () => {
    const masked = redact(text, [detection("ssn", 1, 4, 15), detection("phone", 1, 22, 34)]);
    expect(masked).not.toContain("123-45-6789");
    expect(masked).not.toContain("212-555-1234");
  });
});
