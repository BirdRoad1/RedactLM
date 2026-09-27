import Anthropic from "@anthropic-ai/sdk";
import type { Stream } from "@anthropic-ai/sdk/core/streaming";
import { isTextType, parseDataUri } from "../files/extract";
import type {
  CompletionErrorResponse,
  CompletionsChunk,
  CompletionsResponse,
} from "../schema/completion-response.schema";
import type { CompletionsRequest, Message, ToolCall } from "../schema/completions-request.schema";
import type { Backend } from "./backends.service";

// Backends with `api: "anthropic"` speak Anthropic's Messages API. Clients
// (our web UI included) still use OpenAI's chat completions format: requests
// are translated on the way out and replies on the way back, so everything
// else (checks, storage, streaming to the client) stays the same.

// Something in the request that has no Messages API equivalent
export class AnthropicRequestError extends Error {}

// Messages needs max_tokens, chat completions doesn't. Streams can run long;
// a non-streaming request must finish within one HTTP response.
const DEFAULT_MAX_TOKENS = { stream: 64_000, json: 16_000 };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

// Never falls back to credentials from the server's own environment
// (ANTHROPIC_API_KEY, `ant auth login` profiles...): a backend without a key
// sends none.
class BackendClient extends Anthropic {
  protected override _shouldResolveDefaultCredentials() {
    return false;
  }
}

function clientFor(backend: Backend) {
  return new BackendClient({
    apiKey: backend.apiKey || null,
    authToken: null,
    // The SDK adds /v1 itself; OpenAI-style URLs usually end in it
    baseURL: backend.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, ""),
    defaultHeaders: { ...(!backend.apiKey && { "x-api-key": null }), ...backend.extraHeaders },
    maxRetries: 0, // like the OpenAI path: failures go straight back to the client
    timeout: backend.timeoutMs,
  });
}

// ---------- Request: chat completions -> Messages ----------

type UserPart = Exclude<Extract<Message, { role: "user" }>["content"], string>[number];

function imageBlock(mime: string, bytes: Buffer, name: string): Anthropic.ImageBlockParam {
  if (!IMAGE_TYPES.includes(mime as ImageType)) {
    throw new AnthropicRequestError(`"${name}" is ${mime}; Anthropic backends accept JPEG, PNG, GIF and WebP images.`);
  }
  return { type: "image", source: { type: "base64", media_type: mime as ImageType, data: bytes.toString("base64") } };
}

function userBlock(part: UserPart, n: number): Anthropic.ContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };

  if (part.type === "image_url") {
    const { url } = part.image_url;
    if (!url.startsWith("data:")) return { type: "image", source: { type: "url", url } };
    const parsed = parseDataUri(url);
    if (!parsed) throw new AnthropicRequestError(`Image ${n} couldn't be read.`);
    return imageBlock(parsed.mime, parsed.bytes, `Image ${n}`);
  }

  const name = part.file.filename || `Attachment ${n}`;
  if (!part.file.file_data) {
    throw new AnthropicRequestError(`"${name}" is referenced by file id, which Anthropic backends don't support.`);
  }
  const parsed = parseDataUri(part.file.file_data);
  if (!parsed) throw new AnthropicRequestError(`"${name}" couldn't be read.`);
  const title = part.file.filename;
  if (parsed.mime === "application/pdf") {
    return { type: "document", title, source: { type: "base64", media_type: "application/pdf", data: parsed.bytes.toString("base64") } };
  }
  if (parsed.mime.startsWith("image/")) return imageBlock(parsed.mime, parsed.bytes, name);
  if (isTextType(parsed.mime)) {
    return { type: "document", title, source: { type: "text", media_type: "text/plain", data: parsed.bytes.toString("utf8") } };
  }
  throw new AnthropicRequestError(`"${name}" is ${parsed.mime}, which Anthropic backends can't take.`);
}

const textOf = (content: string | { text: string }[]) =>
  typeof content === "string" ? content : content.map((part) => part.text).join("\n");

function toolUseBlock(call: ToolCall): Anthropic.ToolUseBlockParam {
  let input: unknown;
  try {
    input = JSON.parse(call.function.arguments || "{}");
  } catch {}
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AnthropicRequestError(`Tool call "${call.id}" has arguments that aren't a JSON object.`);
  }
  return { type: "tool_use", id: call.id, name: call.function.name, input };
}

function toMessages(messages: Message[]) {
  const system: Anthropic.TextBlockParam[] = [];
  const out: Anthropic.MessageParam[] = [];
  let images = 0;

  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        const text = textOf(message.content);
        if (text) system.push({ type: "text", text });
        break;
      }
      case "user": {
        const content =
          typeof message.content === "string"
            ? message.content
            : message.content.map((part) => userBlock(part, part.type === "text" ? 0 : ++images));
        out.push({ role: "user", content });
        break;
      }
      case "assistant": {
        const text =
          typeof message.content === "string"
            ? message.content
            : (message.content ?? []).map((part) => (part.type === "text" ? part.text : part.refusal)).join("");
        const content: Anthropic.ContentBlockParam[] = [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...(message.tool_calls ?? []).map(toolUseBlock),
        ];
        // an empty turn isn't allowed; the turns either side just run together
        if (content.length) out.push({ role: "assistant", content });
        break;
      }
      case "tool": {
        const result: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: textOf(message.content),
        };
        // one tool message per result in chat completions; one user turn holding them all here
        const last = out.at(-1);
        if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
          last.content.push(result);
        } else {
          out.push({ role: "user", content: [result] });
        }
        break;
      }
    }
  }
  return { system, messages: out };
}

function toToolChoice(body: CompletionsRequest): Anthropic.ToolChoice | undefined {
  const disable = body.parallel_tool_calls === false ? { disable_parallel_tool_use: true } : {};
  const choice = body.tool_choice;
  if (choice === "none") return { type: "none" };
  if (choice === "required") return { type: "any", ...disable };
  if (typeof choice === "object") return { type: "tool", name: choice.function.name, ...disable };
  if (choice === "auto" || body.parallel_tool_calls === false) return { type: "auto", ...disable };
  return undefined;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function toEffort(effort: string | undefined) {
  if (effort === "minimal") return "low";
  return EFFORTS.find((e) => e === effort);
}

// Settings with no Messages API equivalent (seed, penalties, logprobs,
// response_format json_object) are left out, like a backend ignoring them
export function toAnthropicRequest(body: CompletionsRequest, stream: boolean): Anthropic.MessageCreateParamsNonStreaming {
  if (body.n != null && body.n > 1) throw new AnthropicRequestError("Anthropic backends return one choice: n must be 1.");

  const { system, messages } = toMessages(body.messages);
  const stop = typeof body.stop === "string" ? [body.stop] : body.stop;
  const toolChoice = body.tools?.length ? toToolChoice(body) : undefined;
  const format = body.response_format?.type === "json_schema" ? body.response_format.json_schema.schema : undefined;
  const effort = toEffort(body.reasoning_effort);

  return {
    model: body.model,
    max_tokens: body.max_completion_tokens ?? body.max_tokens ?? (stream ? DEFAULT_MAX_TOKENS.stream : DEFAULT_MAX_TOKENS.json),
    messages,
    ...(system.length && { system }),
    // chat completions allows up to 2, Messages up to 1
    ...(body.temperature != null && { temperature: Math.min(body.temperature, 1) }),
    ...(body.top_p != null && { top_p: body.top_p }),
    ...(stop?.length && { stop_sequences: stop }),
    ...(body.tools?.length && {
      tools: body.tools.map(({ function: f }) => ({
        name: f.name,
        ...(f.description && { description: f.description }),
        input_schema: (f.parameters ?? { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
        ...(f.strict && { strict: true }),
      })),
    }),
    ...(toolChoice && { tool_choice: toolChoice }),
    ...((format || effort) && {
      output_config: {
        ...(format && { format: { type: "json_schema" as const, schema: format } }),
        ...(effort && { effort }),
      },
    }),
    ...(body.user && { metadata: { user_id: body.user } }),
  };
}

// ---------- Reply: Messages -> chat completions ----------

const FINISH_REASONS: Record<Anthropic.StopReason, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  pause_turn: "stop",
  max_tokens: "length",
  model_context_window_exceeded: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

const finishReason = (reason: Anthropic.StopReason | null) => (reason ? (FINISH_REASONS[reason] ?? "stop") : null);

type AnthropicUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

// OpenAI counts cached input as part of the prompt; Anthropic counts it apart
function toUsage(u: AnthropicUsage) {
  const cached = u.cache_read_input_tokens ?? 0;
  const prompt = (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0);
  const completion = u.output_tokens ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cached },
  };
}

const unixNow = () => Math.floor(Date.now() / 1000);

export function toCompletion(message: Anthropic.Message): CompletionsResponse {
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const toolCalls: ToolCall[] = message.content.flatMap((b) =>
    b.type === "tool_use"
      ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input) } }]
      : [],
  );
  return {
    id: message.id,
    object: "chat.completion",
    created: unixNow(),
    model: message.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text || (toolCalls.length ? null : ""), ...(toolCalls.length && { tool_calls: toolCalls }) },
        finish_reason: finishReason(message.stop_reason),
        logprobs: null,
      },
    ],
    usage: toUsage(message.usage),
  };
}

// Turns Messages stream events into chat completion chunks, one event at a time
export function chunkTranslator(includeUsage: boolean) {
  let id = "";
  let model = "";
  const created = unixNow();
  let usage: AnthropicUsage = {};
  const toolIndex = new Map<number, number>(); // content block index -> tool call index

  const chunk = (delta: CompletionsChunk["choices"][number]["delta"], finish: string | null = null): CompletionsChunk => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
  });

  return (event: Anthropic.RawMessageStreamEvent): CompletionsChunk[] => {
    switch (event.type) {
      case "message_start":
        id = event.message.id;
        model = event.message.model;
        usage = { ...event.message.usage };
        return [chunk({ role: "assistant", content: "" })];
      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "text" && block.text) return [chunk({ content: block.text })];
        if (block.type !== "tool_use") return []; // thinking and the like aren't passed on
        const index = toolIndex.size;
        toolIndex.set(event.index, index);
        return [chunk({ tool_calls: [{ index, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] })];
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") return [chunk({ content: delta.text })];
        const index = toolIndex.get(event.index);
        if (delta.type === "input_json_delta" && index !== undefined) {
          return [chunk({ tool_calls: [{ index, function: { arguments: delta.partial_json } }] })];
        }
        return [];
      }
      case "message_delta":
        // counts here are cumulative, and input counts may be filled in late
        for (const [key, value] of Object.entries(event.usage)) {
          if (typeof value === "number") usage[key as keyof AnthropicUsage] = value;
        }
        return [chunk({}, finishReason(event.delta.stop_reason))];
      case "message_stop":
        return includeUsage ? [{ ...chunk({}), choices: [], usage: toUsage(usage) }] : [];
      default:
        return [];
    }
  };
}

const encoder = new TextEncoder();
const sse = (data: unknown) => encoder.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);

const errorBody = (message: string, type: string): CompletionErrorResponse => ({ error: { message, type } });

// Server-sent events in the chat completions format, ending in [DONE]
function toChunkStream(events: Stream<Anthropic.RawMessageStreamEvent>, includeUsage: boolean) {
  const translate = chunkTranslator(includeUsage);
  const iterator = events[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Some events translate to nothing, and a pull that enqueues nothing
        // may not be pulled again: keep reading until there's something to send
        for (;;) {
          const { value, done } = await iterator.next();
          if (done) {
            controller.enqueue(sse("[DONE]"));
            controller.close();
            return;
          }
          const chunks = translate(value);
          for (const chunk of chunks) controller.enqueue(sse(chunk));
          if (chunks.length) return;
        }
      } catch (err) {
        if (err instanceof Anthropic.APIUserAbortError) return controller.close();
        // an error event mid-stream (overloaded, say): pass it on as OpenAI streams do
        const body = err instanceof Anthropic.APIError ? anthropicError(err) : errorBody(String(err), "upstream_error");
        controller.enqueue(sse(body));
        controller.close();
      }
    },
    cancel() {
      events.controller.abort();
    },
  });
}

// ---------- Calls ----------

// Anthropic's error body in OpenAI's shape: { error: { message, type } }
function anthropicError(err: InstanceType<typeof Anthropic.APIError>): CompletionErrorResponse {
  const body = err.error as { error?: { message?: string; type?: string } } | undefined;
  return errorBody(body?.error?.message ?? err.message, body?.error?.type ?? "upstream_error");
}

// Failures the backend reported (and requests we couldn't translate) come
// back as a failed result, like an HTTP error from an OpenAI backend. Network
// errors and aborts are thrown for the caller's timeout handling.
async function call<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; status: number; text: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    if (err instanceof AnthropicRequestError) {
      return { ok: false, status: 400, text: JSON.stringify(errorBody(err.message, "invalid_request_error")) };
    }
    if (err instanceof Anthropic.APIError && err.status !== undefined) {
      return { ok: false, status: err.status, text: JSON.stringify(anthropicError(err)) };
    }
    throw err;
  }
}

export async function anthropicJson(backend: Backend, body: CompletionsRequest, signal: AbortSignal) {
  const res = await call(() => clientFor(backend).messages.create(toAnthropicRequest(body, false), { signal }));
  return res.ok ? { ok: true, status: 200, text: JSON.stringify(toCompletion(res.value)) } : res;
}

export async function anthropicStream(backend: Backend, body: CompletionsRequest, signal: AbortSignal) {
  const res = await call(() =>
    clientFor(backend).messages.create({ ...toAnthropicRequest(body, true), stream: true }, { signal }),
  );
  if (!res.ok) return new Response(res.text, { status: res.status, headers: { "Content-Type": "application/json" } });
  const includeUsage = body.stream_options?.include_usage ?? false;
  return new Response(toChunkStream(res.value, includeUsage), { headers: { "Content-Type": "text/event-stream" } });
}

// In the shape an OpenAI backend's /models gives, with Anthropic's readable names
export async function anthropicModels(backend: Backend, signal: AbortSignal) {
  const res = await call(async () => {
    const data = [];
    for await (const model of clientFor(backend).models.list({ limit: 1000 }, { signal })) {
      data.push({ id: model.id, display_name: model.display_name, created: Math.floor(Date.parse(model.created_at) / 1000) });
    }
    return data;
  });
  return res.ok ? { ok: true, status: 200, text: JSON.stringify({ data: res.value }) } : res;
}
