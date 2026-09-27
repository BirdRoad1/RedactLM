import { describe, expect, test } from "bun:test";
import { DetectionType, type Detection } from "../src/checkers/checker";
import { outcomeFor, type Policy } from "../src/checkers/policy";
import { placeholderFor, replaceAll, replaceInMessages } from "../src/checkers/replace";

const policy = (mode: Policy["mode"]): Policy => ({ mode, defaults: { warnAt: 0.3, blockAt: 0.8 }, checkers: {} });
const detection = (confidence: number): Detection => ({
  checker: "ssn", contents: "", start: 0, end: 1, confidence, reason: "", userFacingReason: "", title: "", explanation: "", type: DetectionType.STATIC,
});

describe("replace mode outcomes", () => {
  test("blocks become replacements only where content is editable", () => {
    expect(outcomeFor(detection(0.9), policy("replace"), true)).toBe("redacted");
    expect(outcomeFor(detection(0.9), policy("replace"), false)).toBe("blocked"); // PDFs, images
    expect(outcomeFor(detection(0.9), policy("block"), true)).toBe("blocked");
    expect(outcomeFor(detection(0.5), policy("replace"), true)).toBe("warned"); // warnings unchanged
  });
});

describe("placeholderFor", () => {
  test("rules and keywords label it with what it is; the local AI model's finds are redacted-", () => {
    expect(placeholderFor("123-12-1234", "c1", "ssn")).toMatch(/^SSN-[0-9a-f]{12}$/);
    expect(placeholderFor("1234 5678 9012 3456", "c1", "credit-card")).toMatch(/^CREDIT_CARD-[0-9a-f]{12}$/);
    expect(placeholderFor("Project Falcon", "c1", "keyword")).toMatch(/^KEYWORD-[0-9a-f]{12}$/);
    expect(placeholderFor("Jane Smith", "c1", "local-llm")).toMatch(/^redacted-[0-9a-f]{12}$/);
    expect(placeholderFor("Jane Smith", "c1")).toMatch(/^redacted-[0-9a-f]{12}$/);
    // the label isn't part of the hash
    expect(placeholderFor("123-12-1234", "c1", "ssn").slice(-12)).toBe(placeholderFor("123-12-1234", "c1").slice(-12));
  });

  test("same value, same conversation: same placeholder; otherwise different", () => {
    expect(placeholderFor("123-12-1234", "c1")).toBe(placeholderFor("123-12-1234", "c1"));
    expect(placeholderFor("123-12-1234", "c1")).not.toBe(placeholderFor("123-12-1234", "c2"));
    expect(placeholderFor("123-12-1234", "c1")).not.toBe(placeholderFor("123121234", "c1"));
  });
});

describe("replaceAll", () => {
  const map = new Map([
    ["123-12-1234", "redacted-aaaaaaaaaaaa"],
    ["Jane Smith", "redacted-bbbbbbbbbbbb"],
    ["Jane", "redacted-cccccccccccc"],
  ]);

  test("every occurrence, consistently", () => {
    expect(replaceAll("SSN 123-12-1234; confirm 123-12-1234.", map)).toBe(
      "SSN redacted-aaaaaaaaaaaa; confirm redacted-aaaaaaaaaaaa.",
    );
  });

  test("longest value first, so a longer match isn't split", () => {
    expect(replaceAll("Jane Smith and Jane", map)).toBe("redacted-bbbbbbbbbbbb and redacted-cccccccccccc");
  });

  test("names only as whole words", () => {
    expect(replaceAll("Janet met Jane.", map)).toBe("Janet met redacted-cccccccccccc.");
  });

  test("regex characters in values are literal", () => {
    expect(replaceAll("key a+b(c)*", new Map([["a+b(c)*", "redacted-dddddddddddd"]]))).toBe("key redacted-dddddddddddd");
  });

  test("one pass: a placeholder put in is never matched again", () => {
    const map = new Map([["123-12-1234", "SSN-aaaaaaaaaaaa"], ["SSN", "KEYWORD-bbbbbbbbbbbb"]]);
    expect(replaceAll("SSN 123-12-1234", map)).toBe("KEYWORD-bbbbbbbbbbbb SSN-aaaaaaaaaaaa");
  });
});

describe("replaceInMessages", () => {
  const map = new Map([["123-12-1234", "redacted-aaaaaaaaaaaa"]]);
  const text = (s: string) => `data:text/plain;base64,${Buffer.from(s).toString("base64")}`;
  const decode = (uri: string) => Buffer.from(uri.split(",")[1]!, "base64").toString();

  test("plain text, text parts and text files; PDFs untouched", () => {
    const pdf = "data:application/pdf;base64,JVBERi0=";
    const [a, b] = replaceInMessages(
      [
        { role: "user", content: "SSN 123-12-1234" },
        {
          role: "user",
          content: [
            { type: "text", text: "see 123-12-1234" },
            { type: "file", file: { filename: "a.txt", file_data: text("row,123-12-1234") } },
            { type: "file", file: { filename: "b.pdf", file_data: pdf } },
          ],
        },
      ],
      map,
    );
    expect(a!.content).toBe("SSN redacted-aaaaaaaaaaaa");
    const parts = b!.content as { type: string; text?: string; file?: { file_data: string } }[];
    expect(parts[0]!.text).toBe("see redacted-aaaaaaaaaaaa");
    expect(decode(parts[1]!.file!.file_data)).toBe("row,redacted-aaaaaaaaaaaa");
    expect(parts[2]!.file!.file_data).toBe(pdf);
  });
});
