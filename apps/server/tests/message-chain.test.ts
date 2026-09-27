import { describe, expect, test } from "bun:test";
import { checkSeals, roundConfidence, sealMessage, type SealedMessage } from "../src/services/message-chain";

const message = (position: number, fields: Partial<SealedMessage> = {}): SealedMessage => ({
  conversation_id: "00000000-0000-4000-8000-000000000000",
  position,
  role: position % 2 ? "assistant" : "user",
  content: `message ${position}`,
  tool_calls: null,
  tool_call_id: null,
  request_id: null,
  model: null,
  action: "allowed",
  created_at: new Date(Date.UTC(2026, 8, 27, 12, 0, position)),
  detections: [],
  ...fields,
});

// what saveMessage does: each message sealed onto the one before
function chain(messages: SealedMessage[]) {
  let previous: string | null = null;
  return messages.map((m) => {
    const hash = sealMessage(m, previous);
    previous = hash;
    return { ...m, hash };
  });
}

const detection = { checker: "ssn", userFacingReason: "Social Security number", confidence: 0.95, location: null, start: 3, end: 14, outcome: "blocked" };

describe("message hash chain", () => {
  test("an untouched conversation is intact", () => {
    const sealed = chain([message(0, { detections: [detection] }), message(1), message(2)]);
    expect(checkSeals(sealed)).toEqual(["intact", "intact", "intact"]);
  });

  test("editing a message breaks it and everything after it stays checkable", () => {
    const sealed = chain([message(0), message(1), message(2)]);
    sealed[1]!.content = "something else";
    expect(checkSeals(sealed)).toEqual(["intact", "broken", "intact"]);
  });

  test("editing a detection or an action breaks the message", () => {
    const sealed = chain([message(0, { detections: [detection] }), message(1)]);
    const edited = sealed.map((m) => ({ ...m, detections: [] }));
    expect(checkSeals(edited)).toEqual(["broken", "intact"]);
    sealed[0]!.action = "allowed";
    sealed[1]!.action = "blocked";
    expect(checkSeals(sealed)).toEqual(["intact", "broken"]);
  });

  test("removing or reordering messages breaks the chain after the gap", () => {
    const sealed = chain([message(0), message(1), message(2), message(3)]);
    expect(checkSeals([sealed[0]!, sealed[2]!, sealed[3]!])).toEqual(["intact", "broken", "intact"]);
    expect(checkSeals([sealed[0]!, sealed[2]!, sealed[1]!, sealed[3]!])).toEqual(["intact", "broken", "broken", "broken"]);
  });

  test("messages from before sealing are unsealed; a removed seal is broken", () => {
    const [a, b] = chain([message(2), message(3)]);
    const old = { ...message(0), hash: null };
    expect(checkSeals([old, { ...message(1), hash: null }, a!, b!])).toEqual(["unsealed", "unsealed", "intact", "intact"]);
    expect(checkSeals([a!, { ...b!, hash: null }])).toEqual(["intact", "broken"]);
  });

  test("detection order, key order and float storage don't matter", () => {
    const other = { ...detection, checker: "email", start: 20, end: 30 };
    const [sealed] = chain([message(0, { detections: [detection, other], tool_calls: [{ id: "a", type: "function" }] })]);
    const reread = {
      ...sealed!,
      detections: [other, { ...detection, confidence: Math.fround(roundConfidence(0.95)) }],
      tool_calls: [{ type: "function", id: "a" }], // jsonb gives keys back in its own order
    };
    expect(checkSeals([reread])).toEqual(["intact"]);
  });
});
