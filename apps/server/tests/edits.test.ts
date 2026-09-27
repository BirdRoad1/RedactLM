import { describe, expect, test } from "bun:test";
import { sealMessage, type SealedMessage } from "../src/services/message-chain";
import { currentThread } from "../src/services/conversations.service";

const m = (position: number, fields: { action?: string; edit_of?: number | null } = {}) => ({
  position,
  action: fields.action ?? "allowed",
  edit_of: fields.edit_of ?? null,
});
const positions = (rows: { position: number }[]) => rows.map((r) => r.position);

describe("currentThread", () => {
  test("without edits, everything but blocked attempts", () => {
    expect(positions(currentThread([m(0), m(1), m(2, { action: "blocked" }), m(3), m(4)]))).toEqual([0, 1, 3, 4]);
  });

  test("an edit replaces its message and everything after it", () => {
    expect(positions(currentThread([m(0), m(1), m(2), m(3), m(4, { edit_of: 2 }), m(5)]))).toEqual([0, 1, 4, 5]);
    expect(positions(currentThread([m(0), m(1), m(2), m(3), m(4, { edit_of: 0 }), m(5)]))).toEqual([4, 5]);
  });

  test("an edit of an edit", () => {
    const rows = [m(0), m(1), m(2, { edit_of: 0 }), m(3), m(4, { edit_of: 2 }), m(5)];
    expect(positions(currentThread(rows))).toEqual([4, 5]);
  });

  test("a blocked edit changes nothing", () => {
    expect(positions(currentThread([m(0), m(1), m(2, { action: "blocked", edit_of: 0 })]))).toEqual([0, 1]);
  });
});

describe("seals and edits", () => {
  const message: SealedMessage = {
    conversation_id: "00000000-0000-4000-8000-000000000000", position: 0, role: "user", content: "hi",
    tool_calls: null, tool_call_id: null, request_id: null, model: null, action: "allowed",
    created_at: new Date(Date.UTC(2026, 8, 27)), detections: [],
  };

  test("messages that aren't edits seal as they did before edits existed", () => {
    expect(sealMessage({ ...message, edit_of: null }, null)).toBe(sealMessage(message, null));
  });

  test("what an edit replaces is sealed", () => {
    expect(sealMessage({ ...message, edit_of: 0 }, null)).not.toBe(sealMessage({ ...message, edit_of: 2 }, null));
    expect(sealMessage({ ...message, edit_of: 0 }, null)).not.toBe(sealMessage(message, null));
  });
});
