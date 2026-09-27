import type { Context } from "hono";
import { hasRole, skipsChecks } from "../auth/roles";
import {
  LlmDetectorUnavailableError,
  runLlmChecks,
} from "../checkers/llm/llm-checker";
import type { Outcome, Policy } from "../checkers/policy";
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
  addOverriddenPlaceholders,
  getOverriddenPlaceholders,
  getOwnedConversation,
  nextPosition,
  saveMessage,
  touchConversation,
} from "../services/conversations.service";
import { audit, type Finding } from "../services/audit.service";
import { getPolicy } from "../services/detection-policy.service";
import { placeholderFor, replaceInMessages } from "../checkers/replace";
import { UnsupportedAttachmentError } from "../files/extract";
import {
  prepareMessage,
  scanMessage,
  scanStatic,
  unreadMessage,
  type Scan,
  type Source,
} from "../services/scan.service";
import {
  UpstreamError,
  chatCompletionJson,
  chatCompletionStream,
  upstreamErrorResponse,
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

// Text written by the model: assistant messages sent along with a request
// (history an API client keeps) and the model's replies. The rules and
// keywords check it, but it's only logged: never blocked or changed, so
// anything found counts as a warning at most. It's masked for storage like
// everything else.
function checkModelText(text: string, policy: Policy) {
  const scored = scanStatic(text, policy).scored.map((s) => ({
    ...s,
    outcome: s.outcome === "ignored" ? ("ignored" as const) : ("warned" as const),
  }));
  const findings: Finding[] = scored
    .filter((s) => s.outcome === "warned")
    .map(({ detection: d }) => ({ title: d.title, checker: d.checker }));
  return { scored, findings };
}

export async function createCompletion(c: Context<AuthEnv>) {
  const schema = await completionsRequest.safeParseAsync(await c.req.json());
  if (schema.error) {
    console.log(schema.error);
    return c.text("Invalid data", 400);
  }

  const userId = c.get("userId");
  const userAgent = c.req.header("User-Agent") ?? null;

  const roles = c.get("roles");
  // Send even if blocked (Ctrl+Enter in our web UI); only for the override role
  const override = c.req.header("X-Override-Block") === "true";
  if (override && !hasRole(roles, "override")) {
    return c.json(apiError("You don't have permission to send blocked messages anyway", "forbidden"), 403);
  }
  // no_check and admin: nothing is checked, only masked for storage
  const unchecked = skipsChecks(roles);

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
  let messages: ReturnType<typeof unreadMessage>[];
  let scans: (Scan | undefined)[];
  try {
    if (unchecked) {
      messages = json.messages.map(unreadMessage);
      scans = messages.map(() => undefined);
    } else {
      const prepared = json.messages.map(prepareMessage);
      scans = await Promise.all(
        prepared.map((message) =>
          message.role === "user"
            ? scanMessage(message, policy, c.req.raw.signal)
            : undefined,
        ),
      );
      messages = prepared.map(({ attachments, ...m }) => ({ ...m, filenames: attachments.map((a) => a.filename) }));
    }
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

  // What stops the request: a block in what's newly sent, or one in the
  // history. For those who may override, blocked history can only have got
  // there by an override earlier on (logged then), so it doesn't count again.
  const stops = (i: number) => i >= firstToSave || !hasRole(roles, "override");
  const blockedAny = scans.some((s, i) => s?.outcome === "blocked" && stops(i));
  const overridingBlock = blockedAny && override;

  // Replace mode: every value that would have blocked is swapped for its
  // placeholder, everywhere in the text and text files, before sending.
  // Overriding sends the values in the new messages as written instead, and
  // later turns keep sending those as written: the model has seen them, and
  // only their placeholders are remembered. That lasts while the user still
  // may override.
  const keptBefore = continuing && hasRole(roles, "override") ? await getOverriddenPlaceholders(convo) : new Set<string>();
  const planned = scans.flatMap((scan, messageIndex) =>
    (scan?.replacements ?? []).map((r) => ({ messageIndex, ...r, placeholder: placeholderFor(r.value, convo) })),
  );
  const keptValues = new Set(
    planned
      .filter((p) => (override && p.messageIndex >= firstToSave) || keptBefore.has(p.placeholder))
      .map((p) => p.value),
  );
  const replacements = new Map<string, string>();
  const replaced: Omit<(typeof planned)[number], "value">[] = [];
  const kept: Omit<(typeof planned)[number], "value">[] = [];
  for (const { value, ...p } of planned) {
    if (keptValues.has(value)) {
      kept.push(p);
    } else {
      replacements.set(value, p.placeholder);
      replaced.push(p);
    }
  }
  const keptIn = (i: number) => kept.filter((k) => k.messageIndex === i);

  for (const [i, message] of messages.entries()) {
    if (i < firstToSave) continue;
    const outcome = scans[i]?.outcome ?? "ignored";
    // assistant text is checked and logged only; system and tool messages
    // aren't checked, but are masked for storage all the same
    const modelText = message.role === "assistant" ? checkModelText(message.content, policy) : undefined;
    const storageOnly = !scans[i] && !modelText
      ? scanStatic(message.content, policy).scored.map((s) => ({ ...s, outcome: "ignored" as const }))
      : undefined;
    await saveMessage(
      {
        conversation_id: convo,
        position: position++,
        role: message.role,
        action: unchecked && message.role === "user" ? "unchecked"
          : (outcome === "blocked" && overridingBlock) || keptIn(i).length ? "overridden"
          : actionFor[outcome],
        content: message.content,
        model: json.model,
      },
      // unchecked messages are still masked for storage, by the local rules
      modelText?.scored ?? scans[i]?.scored ?? storageOnly,
      message.filenames,
    );
    if (modelText?.findings.length) {
      await audit("assistant_pii", { where: "request", messageIndex: i, findings: modelText.findings }, { conversationId: convo });
    }
    if (unchecked && message.role === "user") {
      await audit("sent_unchecked", { messageIndex: i, because: roles.includes("admin") ? "admin" : "no_check" }, { conversationId: convo });
    }
  }
  await touchConversation(convo);
  c.header("X-Conversation-Id", convo);

  // What was found in the newly sent messages (history was logged when it was
  // new). A blocked message is logged for what blocked it and nothing else.
  // Replacements are logged as they happened: swapped, or sent as written.
  for (const [i, scan] of scans.entries()) {
    if (i < firstToSave || !scan) continue;
    const found = (outcome: Outcome) =>
      scan.scored
        .filter((s) => s.outcome === outcome)
        .map(({ detection: d, source }) => ({ title: d.title, checker: d.checker, source }));
    const asFindings = (rs: typeof kept) => rs.map(({ title, checker, source }) => ({ title, checker, source }));
    type FindingsEvent = "message_blocked" | "block_overridden" | "message_replaced" | "message_warned";
    const events: [FindingsEvent, Finding[]][] = blockedAny && !override
      ? [["message_blocked", found("blocked")]]
      : [
          ["block_overridden", [...(overridingBlock ? found("blocked") : []), ...asFindings(keptIn(i))]],
          ["message_replaced", asFindings(replaced.filter((r) => r.messageIndex === i))],
          ["message_warned", found("warned")],
        ];
    for (const [event, findings] of events) {
      if (findings.length) await audit(event, { messageIndex: i, findings }, { conversationId: convo });
    }
  }

  const blocked = flagged(scans, "blocked").filter((d) => stops(d.messageIndex));
  if (blocked.length && !overridingBlock) {
    const reasons = [...new Set(blocked.map((d) =>
      d.source ? `${d.title} in "${d.source.filename}"${d.source.page ? `, page ${d.source.page}` : ""}` : d.reason,
    ))];
    return c.json(
      {
        error: {
          message: `Your request was blocked because it contains sensitive information:\n${reasons.map((r) => `- ${r}`).join("\n")}`,
          type: "pii_detected",
          detections: blocked,
          overridable: hasRole(roles, "override"),
        },
      } satisfies CompletionErrorResponse & { error: { detections: FlaggedDetection[]; overridable: boolean } },
      400,
    );
  }

  // it's going out: remember what was sent as written, for later turns
  const keptNew = kept.filter((k) => k.messageIndex >= firstToSave);
  await addOverriddenPlaceholders(convo, keptNew.map((k) => k.placeholder));

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
  // X-PII-Overridden: what would have blocked or been replaced in the new
  // messages, and went out as written on the user's say-so
  const overridden = [
    ...(overridingBlock ? blocked.filter((d) => d.messageIndex >= firstToSave) : []),
    ...keptNew.map(({ messageIndex, title, start, end, source }) => ({ messageIndex, title, start, end, source })),
  ];
  // X-Partially-Checked: passed, but part of it was only covered by the rules
  // X-PII-Replaced: what was swapped, where, and for which placeholder (never the value)
  const warningHeaders: Record<string, string> = {
    ...(warnings.length && { "X-PII-Warnings": asciiJson(warnings) }),
    ...(overridden.length && { "X-PII-Overridden": asciiJson(overridden) }),
    ...(partial.length && { "X-Partially-Checked": asciiJson(partial) }),
    ...(replaced.length && { "X-PII-Replaced": asciiJson(replaced) }),
  };
  for (const [name, value] of Object.entries(warningHeaders)) c.header(name, value);

  // Only fields the schema knows about are forwarded, so unvalidated extras
  // never leave the building
  const body: Record<string, unknown> = {
    ...json,
    model: upstreamModel,
    messages: replaceInMessages(json.messages, replacements),
  };
  for (const param of backend.stripParams) delete body[param];

  // Replies are checked like any model text: masked for storage, and what
  // the rules find is logged, never changed. Streamed replies finish after
  // this handler has returned, so the user is passed explicitly.
  const saveReply = async (reply: CollectedReply) => {
    const { scored, findings } = checkModelText(reply.content, policy);
    try {
      await saveMessage(
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
        scored,
      );
      if (findings.length) await audit("assistant_pii", { where: "reply", findings }, { userId, conversationId: convo });
    } catch (err) {
      console.error("Failed to save assistant reply:", err);
    }
  };

  const init = { body, signal: c.req.raw.signal };

  try {
    if (json.stream) {
      const upstream = await chatCompletionStream(backend, init);
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

    const upstream = await chatCompletionJson(backend, init);
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
