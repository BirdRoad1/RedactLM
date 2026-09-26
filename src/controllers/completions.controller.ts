import type { Context } from "hono";
import {
  LlmDetectorUnavailableError,
  runLlmChecks,
} from "../checkers/llm/llm-checker";
import type { Outcome } from "../checkers/policy";
import type { AuthEnv } from "../middleware/auth";
import { completionsRequest } from "../schema/completions-request.schema";
import type {
  CompletionsResponse,
  CompletionErrorResponse,
} from "../schema/completion-response.schema";
import { resolveModel } from "../services/backends.service";
import {
  tapCompletionStream,
  type CollectedReply,
} from "../services/completion-stream";
import {
  createConversation,
  saveMessage,
} from "../services/conversations.service";
import { getPolicy } from "../services/detection-policy.service";
import { scanStatic, scanText, type Scan } from "../services/scan.service";
import {
  UpstreamError,
  upstreamErrorResponse,
  upstreamJson,
  upstreamStream,
} from "../services/upstream.service";

function apiError(message: string, type: string) {
  return { error: { message, type } } satisfies CompletionErrorResponse;
}

const actionFor = {
  ignored: "allowed",
  warned: "warned",
  blocked: "blocked",
} as const satisfies Record<Outcome, string>;

// What we tell the client about a detection: where and why, not the text
type FlaggedDetection = {
  messageIndex: number;
  checker: string;
  reason: string;
  confidence: number;
  start: number;
  end: number;
};

function flagged(scans: (Scan | undefined)[], outcome: Outcome): FlaggedDetection[] {
  return scans.flatMap((scan, messageIndex) =>
    (scan?.scored ?? [])
      .filter((s) => s.outcome === outcome)
      .map(({ detection: d }) => ({
        messageIndex,
        checker: d.checker,
        reason: d.userFacingReason,
        confidence: d.confidence,
        start: d.start,
        end: d.end,
      })),
  );
}

export async function createCompletion(c: Context<AuthEnv>) {
  const schema = await completionsRequest.safeParseAsync(await c.req.json());
  if (schema.error) {
    console.log(schema.error);
    return c.text("Invalid data", 400);
  }

  const userId = c.get("userId");
  const userAgent = c.req.header("User-Agent") ?? null;

  const json = schema.data;

  const resolved = await resolveModel(json.model);
  if (!resolved) {
    return c.json(
      apiError(`Unknown model "${json.model}"`, "model_not_found"),
      404,
    );
  }
  const { backend, upstreamModel } = resolved;

  if (json.stream && !backend.supportsStreaming) {
    return c.json(
      apiError(`Backend "${backend.slug}" does not support streaming`, "invalid_request_error"),
      400,
    );
  }

  // Validate everything before any detector calls or DB writes
  // TODO: support content given as an array of parts
  const messages = [];
  for (const message of json.messages) {
    if (typeof message.content !== "string") {
      return c.text("Unsupported content", 400);
    }
    messages.push({ ...message, content: message.content });
  }

  // TODO: scan non-user messages and tool calls too
  const policy = await getPolicy();
  let scans: (Scan | undefined)[];
  try {
    scans = await Promise.all(
      messages.map((message) =>
        message.role === "user"
          ? scanText(message.content, policy, c.req.raw.signal)
          : undefined,
      ),
    );
  } catch (err) {
    if (err instanceof LlmDetectorUnavailableError) {
      return c.json(apiError(err.message, "detector_unavailable"), 503);
    }
    throw err;
  }

  const convo = await createConversation(userId, userAgent);
  let position = 0;
  for (const [i, message] of messages.entries()) {
    await saveMessage(
      {
        conversation_id: convo,
        position: position++,
        role: message.role,
        action: actionFor[scans[i]?.outcome ?? "ignored"],
        content: message.content,
        model: json.model,
      },
      scans[i]?.scored,
    );
  }

  const blocked = flagged(scans, "blocked");
  if (blocked.length) {
    const reasons = [...new Set(blocked.map((d) => d.reason))];
    return c.json(
      {
        error: {
          message: `Your request was blocked because it contains sensitive information:\n${reasons.map((r) => `- ${r}`).join("\n")}`,
          type: "pii_detected",
          detections: blocked,
        },
      } satisfies CompletionErrorResponse & { error: { detections: FlaggedDetection[] } },
      400,
    );
  }

  // Warnings don't stop the request; clients that care (our web UI) read this header
  const warnings = flagged(scans, "warned");
  const warningHeaders: Record<string, string> = warnings.length
    ? { "X-PII-Warnings": JSON.stringify(warnings) }
    : {};
  for (const [name, value] of Object.entries(warningHeaders)) c.header(name, value);

  // Only fields the schema knows about are forwarded, so unvalidated extras
  // never leave the building
  const body: Record<string, unknown> = { ...json, model: upstreamModel };
  for (const param of backend.stripParams) delete body[param];

  // Replies echo what they were sent, so they're masked before storage too
  const saveReply = (reply: CollectedReply) =>
    saveMessage(
      {
        conversation_id: convo,
        position,
        role: "assistant",
        action: "allowed",
        content: reply.content,
        tool_calls: reply.toolCalls.length ? reply.toolCalls : null,
        request_id: reply.id,
        model: `${backend.slug}/${reply.model ?? upstreamModel}`,
      },
      scanStatic(reply.content, policy).scored,
    ).catch((err) => console.error("Failed to save assistant reply:", err));

  const init = { body, signal: c.req.raw.signal };

  try {
    if (json.stream) {
      const upstream = await upstreamStream(backend, "/chat/completions", init);
      if (!upstream.ok || !upstream.body) {
        const error = upstreamErrorResponse(upstream.status, await upstream.text());
        return c.json(error.body, error.status);
      }

      // Bytes go straight through as they arrive; if the client disconnects,
      // cancelling this body cancels the upstream fetch too
      return new Response(upstream.body.pipeThrough(tapCompletionStream(saveReply)), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          ...warningHeaders,
        },
      });
    }

    const upstream = await upstreamJson(backend, "/chat/completions", init);
    if (!upstream.ok) {
      const error = upstreamErrorResponse(upstream.status, upstream.text);
      return c.json(error.body, error.status);
    }

    let completion: CompletionsResponse;
    try {
      completion = JSON.parse(upstream.text);
    } catch {
      return c.json(
        apiError(`Backend "${backend.slug}" returned invalid JSON`, "upstream_error"),
        502,
      );
    }

    const message = completion.choices?.find((choice) => choice.index === 0)?.message;
    await saveReply({
      id: completion.id,
      model: completion.model,
      content: message?.content ?? "",
      toolCalls: message?.tool_calls ?? [],
    });

    return c.json(completion);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return c.json(apiError(err.message, "upstream_error"), err.status);
    }
    throw err;
  }
}
