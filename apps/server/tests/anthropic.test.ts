import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { CompletionsRequest } from "../src/schema/completions-request.schema";
import { buildDetectorRequest } from "../src/checkers/llm/llm-checker";
import {
  AnthropicRequestError,
  chunkTranslator,
  toAnthropicRequest,
  toCompletion,
} from "../src/services/anthropic.service";

const dataUri = (mime: string, text: string) => `data:${mime};base64,${Buffer.from(text).toString("base64")}`;

const request = (fields: Partial<CompletionsRequest>): CompletionsRequest => ({
  model: "claude-haiku-4-5",
  messages: [{ role: "user", content: "hi" }],
  ...fields,
});

describe("toAnthropicRequest", () => {
  test("system messages move to the top, max_tokens gets a default", () => {
    const params = toAnthropicRequest(
      request({ messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] }),
      true,
    );
    expect(params.system).toEqual([{ type: "text", text: "Be brief." }]);
    expect(params.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(params.max_tokens).toBe(64_000);
    expect(toAnthropicRequest(request({ max_completion_tokens: 50 }), false).max_tokens).toBe(50);
  });

  test("a PDF file part becomes a document block", () => {
    const params = toAnthropicRequest(
      request({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Proofread my 1040 please" },
              { type: "file", file: { filename: "f1040.pdf", file_data: dataUri("application/pdf", "%PDF-1.1") } },
            ],
          },
        ],
      }),
      true,
    );
    expect(params.messages[0]!.content).toEqual([
      { type: "text", text: "Proofread my 1040 please" },
      {
        type: "document",
        title: "f1040.pdf",
        source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.1").toString("base64") },
      },
    ]);
  });

  test("text files become text documents, images image blocks", () => {
    const [message] = toAnthropicRequest(
      request({
        messages: [
          {
            role: "user",
            content: [
              { type: "file", file: { filename: "notes.csv", file_data: dataUri("text/csv", "a,b") } },
              { type: "image_url", image_url: { url: dataUri("image/png", "png") } },
            ],
          },
        ],
      }),
      true,
    ).messages;
    expect(message!.content).toEqual([
      { type: "document", title: "notes.csv", source: { type: "text", media_type: "text/plain", data: "a,b" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png").toString("base64") } },
    ]);
  });

  test("unsupported images and file ids are refused", () => {
    const bmp = request({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUri("image/bmp", "bm") } }] }],
    });
    expect(() => toAnthropicRequest(bmp, true)).toThrow(AnthropicRequestError);
    const byId = request({ messages: [{ role: "user", content: [{ type: "file", file: { file_id: "file-1" } }] }] });
    expect(() => toAnthropicRequest(byId, true)).toThrow(AnthropicRequestError);
  });

  test("tool calls and results", () => {
    const params = toAnthropicRequest(
      request({
        messages: [
          { role: "user", content: "weather in Paris and Rome?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "a", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } },
              { id: "b", type: "function", function: { name: "weather", arguments: '{"city":"Rome"}' } },
            ],
          },
          { role: "tool", tool_call_id: "a", content: "sunny" },
          { role: "tool", tool_call_id: "b", content: "rain" },
        ],
        tools: [{ type: "function", function: { name: "weather", parameters: { type: "object" } } }],
        tool_choice: "required",
        parallel_tool_calls: false,
      }),
      true,
    );
    expect(params.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "a", name: "weather", input: { city: "Paris" } },
          { type: "tool_use", id: "b", name: "weather", input: { city: "Rome" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "sunny" },
          { type: "tool_result", tool_use_id: "b", content: "rain" },
        ],
      },
    ]);
    expect(params.tools).toEqual([{ name: "weather", input_schema: { type: "object" } }]);
    expect(params.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
  });

  test("settings: stop, temperature, effort, JSON schema", () => {
    const params = toAnthropicRequest(
      request({ stop: "END", temperature: 1.5, reasoning_effort: "minimal", user: "u1" }),
      false,
    );
    expect(params.stop_sequences).toEqual(["END"]);
    expect(params.temperature).toBe(1);
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.metadata).toEqual({ user_id: "u1" });

    // the LLM detector's request translates too
    const detector = toAnthropicRequest(buildDetectorRequest("m", "text", null) as CompletionsRequest, false);
    expect(detector.output_config?.format?.type).toBe("json_schema");
    expect(detector.system).toHaveLength(1);
  });

  test("n > 1 is refused", () => {
    expect(() => toAnthropicRequest(request({ n: 2 }), false)).toThrow(AnthropicRequestError);
  });
});

describe("replies", () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 };

  test("a message becomes a chat completion", () => {
    const completion = toCompletion({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: [
        { type: "text", text: "Checking.", citations: null },
        { type: "tool_use", id: "t1", name: "weather", input: { city: "Paris" } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage,
    } as unknown as Anthropic.Message);
    expect(completion.choices[0]).toEqual({
      index: 0,
      message: {
        role: "assistant",
        content: "Checking.",
        tool_calls: [{ id: "t1", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } }],
      },
      finish_reason: "tool_calls",
      logprobs: null,
    });
    expect(completion.usage).toMatchObject({ prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 });
  });

  test("stream events become chunks", () => {
    const translate = chunkTranslator(true);
    const events = [
      { type: "message_start", message: { id: "msg_1", model: "claude-haiku-4-5", usage } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "weather", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"city":' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
      { type: "message_stop" },
    ] as unknown as Anthropic.RawMessageStreamEvent[];
    const chunks = events.flatMap(translate);

    expect(chunks.every((c) => c.id === "msg_1")).toBe(true);
    const text = chunks.map((c) => c.choices[0]?.delta.content ?? "").join("");
    expect(text).toBe("Hello");
    expect(chunks.flatMap((c) => c.choices[0]?.delta.tool_calls ?? [])).toEqual([
      { index: 0, id: "t1", type: "function", function: { name: "weather", arguments: "" } },
      { index: 0, function: { arguments: '{"city":' } },
    ]);
    expect(chunks.at(-2)!.choices[0]!.finish_reason).toBe("tool_calls");
    expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 13, completion_tokens: 7 } });
  });
});
