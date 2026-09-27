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
  getOwnedConversation,
  nextPosition,
  saveMessage,
  touchConversation,
} from "../services/conversations.service";
import { audit } from "../services/audit.service";
import { getPolicy } from "../services/detection-policy.service";
import { placeholderFor, replaceInMessages } from "../checkers/replace";
import { UnsupportedAttachmentError } from "../files/extract";
import {
  prepareMessage,
  scanMessage,
  scanStatic,
  type PreparedMessage,
  type Scan,
  type Source,
} from "../services/scan.service";
import {
  UpstreamError,
  upstreamErrorResponse,
  upstreamJson,
  upstreamStream,
} from "../services/upstream.service";

function apiError(message: string, type: string) {
  return { error: { message, type } } satisfies CompletionErrorResponse;
}

// Headers must be ASCII; filenames needn't be. \u escapes keep it valid JSON.
const asciiJson = (value: unknown) =>
  JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

const actionFor = {
  ignored: "allowed",
  warned: "warned",
  redacted: "redacted",
  blocked: "blocked",
} as const satisfies Record<Outcome, string>;

// What we tell the client about a detection: where and why, not the text
type FlaggedDetection = {
  messageIndex: number;
  checker: string;
  title: string;
  reason: string;
  explanation: string;
  confidence: number;
  start: number; // in the message text, or in `source`'s page when set
  end: number;
  source?: Source; // found in this attachment
};

function flagged(scans: (Scan | undefined)[], outcome: Outcome): FlaggedDetection[] {
  return scans.flatMap((scan, messageIndex) =>
    (scan?.scored ?? [])
      .filter((s) => s.outcome === outcome)
      .map(({ detection: d, source }) => ({
        messageIndex,
        source,
        checker: d.checker,
        title: d.title,
        reason: d.userFacingReason,
        explanation: d.explanation,
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

  // Continuing a conversation: clients that keep history (our web UI) send its
  // id, and only the newest message gets stored. Otherwise each request is a
  // new conversation holding everything it was sent.
  const continuing = c.req.header("X-Conversation-Id");
  if (continuing && !(await getOwnedConversation(userId, continuing))) {
    return c.json(apiError("Conversation not found", "conversation_not_found"), 404);
  }

  // Validate everything before any detector calls or DB writes, then check
  // user messages: their text and everything their attachments show
  // TODO: scan non-user messages and tool calls too
  const policy = await getPolicy();
  let messages: PreparedMessage[];
  let scans: (Scan | undefined)[];
  try {
    messages = json.messages.map(prepareMessage);
    scans = await Promise.all(
      messages.map((message) =>
        message.role === "user"
          ? scanMessage(message, policy, c.req.raw.signal)
          : undefined,
      ),
    );
  } catch (err) {
    if (err instanceof LlmDetectorUnavailableError) {
      return c.json(apiError(err.message, "detector_unavailable"), 503);
    }
    if (err instanceof UnsupportedAttachmentError) {
      await audit("attachment_refused", { reason: err.message }, { conversationId: continuing ?? null });
      return c.json(apiError(err.message, "attachment_unsupported"), 400);
    }
    throw err;
  }

  // the id comes first: placeholders are tied to the conversation
  const convo = continuing ?? crypto.randomUUID();
  if (!continuing) await createConversation(userId, userAgent, convo);
  let position = continuing ? await nextPosition(convo) : 0;
  const firstToSave = continuing ? messages.length - 1 : 0;
  for (const [i, message] of messages.entries()) {
    if (i < firstToSave) continue;
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
      message.attachments.map((a) => a.filename),
    );
  }
  await touchConversation(convo);
  c.header("X-Conversation-Id", convo);

  // What was found in the newly sent messages (history was logged when it was
  // new). A blocked message is logged for what blocked it and nothing else.
  const blockedAny = scans.some((s) => s?.outcome === "blocked");
  for (const [i, scan] of scans.entries()) {
    if (i < firstToSave || !scan) continue;
    const findings = (outcome: Outcome) =>
      scan.scored
        .filter((s) => s.outcome === outcome)
        .map(({ detection: d, source }) => ({ title: d.title, checker: d.checker, source }));
    const events = blockedAny
      ? ([["message_blocked", "blocked"]] as const)
      : ([["message_replaced", "redacted"], ["message_warned", "warned"]] as const);
    for (const [event, outcome] of events) {
      const found = findings(outcome);
      if (found.length) await audit(event, { messageIndex: i, findings: found }, { conversationId: convo });
    }
  }


  const blocked = flagged(scans, "blocked");
  if (blocked.length) {
    const reasons = [...new Set(blocked.map((d) =>
      d.source ? `${d.title} in "${d.source.filename}"${d.source.page ? `, page ${d.source.page}` : ""}` : d.reason,
    ))];
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

  // Passed, but longer than the LLM detector reads. Only the newly stored
  // messages count: history comes back every turn and was already logged.
  const partial = messages.flatMap((_, i) =>
    i >= firstToSave ? (scans[i]?.partial ?? []).map((p) => ({ messageIndex: i, ...p })) : [],
  );
  for (const details of partial) {
    await audit("partially_checked", details, { conversationId: convo });
  }

  // Warnings don't stop the request; clients that care (our web UI) read this header
  const warnings = flagged(scans, "warned");
  // X-Partially-Checked: passed, but part of it was only covered by the rules
  const warningHeaders: Record<string, string> = {
    ...(warnings.length && { "X-PII-Warnings": asciiJson(warnings) }),
    ...(partial.length && { "X-Partially-Checked": asciiJson(partial) }),
  };
  for (const [name, value] of Object.entries(warningHeaders)) c.header(name, value);

  // Replace mode: every value that would have blocked is swapped for its
  // placeholder, everywhere in the text and text files, before sending
  const replacements = new Map<string, string>();
  const replaced = scans.flatMap((scan, messageIndex) =>
    (scan?.replacements ?? []).map(({ value, ...r }) => {
      const placeholder = placeholderFor(value, convo);
      replacements.set(value, placeholder);
      return { messageIndex, ...r, placeholder };
    }),
  );
  // what was swapped, where, and for which placeholder (never the value)
  if (replaced.length) {
    warningHeaders["X-PII-Replaced"] = asciiJson(replaced);
    c.header("X-PII-Replaced", warningHeaders["X-PII-Replaced"]);
  }

  // Only fields the schema knows about are forwarded, so unvalidated extras
  // never leave the building
  const body: Record<string, unknown> = {
    ...json,
    model: upstreamModel,
    messages: replaceInMessages(json.messages, replacements),
  };
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
          "X-Conversation-Id": convo,
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
