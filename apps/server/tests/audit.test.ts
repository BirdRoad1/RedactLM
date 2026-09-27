import { describe, expect, test } from "bun:test";
import { describeEvent } from "../src/services/audit.service";

describe("describeEvent: plain-language summaries", () => {
  test.each([
    ["message_blocked", { messageIndex: 0, findings: [
      { title: "Social Security number", checker: "ssn" },
      { title: "Social Security number", checker: "ssn" },
      { title: "Phone number", checker: "phone", source: { filename: "a.pdf", page: 3 } },
    ] }, 'Message blocked: Social Security number (2), Phone number in "a.pdf", page 3.'],
    ["message_replaced", { messageIndex: 0, findings: [{ title: "Card number", checker: "credit-card" }] },
      "Message sent with placeholders instead of: Card number."],
    ["detector_unavailable", { failMode: "allow", reason: "HTTP 500" },
      "The AI detector couldn't answer, so the message went out with only the rule-based checks."],
    ["settings_changed", { setting: "the detection policy defaults", changes: { mode: "replace", blockAt: null } },
      'Changed the detection policy defaults: mode → "replace", blockAt → none.'],
    ["login_failed", { email: "a@b.com", ip: "10.0.0.5" }, "Failed login for a@b.com from 10.0.0.5."],
    ["assistant_pii", { where: "reply", findings: [{ title: "Email address", checker: "email" }] },
      "The AI's reply contained Email address. Logged only; the reply wasn't changed."],
    ["assistant_pii", { where: "request", messageIndex: 1, findings: [{ title: "Social Security number", checker: "ssn" }] },
      "An assistant message sent with the request contained Social Security number. Logged only; it was sent as it was."],
    ["attachment_refused", { reason: '"x.docx" can\'t be checked because it\'s a Word document.' },
      'Attachment refused: "x.docx" can\'t be checked because it\'s a Word document.'],
  ])("%s", (event, details, expected) => {
    expect(describeEvent(event, details)).toBe(expected);
  });

  test("never echoes internal checker names", () => {
    const text = describeEvent("message_warned", { messageIndex: 0, findings: [{ title: "Phone number", checker: "phone" }] });
    expect(text).not.toContain("phone,");
    expect(text).toBe("Message sent with warnings: Phone number.");
  });
});
