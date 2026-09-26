import type { Context } from "hono";
import {
  LlmDetectorUnavailableError,
  runLlmChecks,
} from "../checkers/llm/llm-checker";
import { runStaticChecks } from "../checkers/run-static-checks";
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
  addMessage,
  createConversation,
} from "../services/conversations.service";
import {
  UpstreamError,
  upstreamErrorResponse,
  upstreamJson,
  upstreamStream,
} from "../services/upstream.service";

function apiError(message: string, type: string) {
  return { error: { message, type } } satisfies CompletionErrorResponse;
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

  const convo = await createConversation(userId, userAgent);

  // TODO: scan tool calls and other stuff maybe
  let position = 0;
  for (const message of json.messages) {
    // TODO: should we skip assistant mgs?
    if (typeof message.content !== "string") {
      return c.text("Unsupported content", 400);
    }

    if (message.role !== "user") {
      // add message, TODO: maybe check all msgs for validity before
      await addMessage({
        conversation_id: convo,
        position: position++,
        role: message.role,
        action: "allowed",
        content: message.content,
        model: json.model,
      });
      continue;
    }

    // the LLM is slow and costs compute, so only ask it when the static
    // checks didn't already find something
    let results = runStaticChecks(message.content);
    if (results.length === 0) {
      try {
        results = await runLlmChecks(message.content, c.req.raw.signal);
      } catch (err) {
        if (err instanceof LlmDetectorUnavailableError) {
          return c.json(apiError(err.message, "detector_unavailable"), 503);
        }
        throw err;
      }
    }

    if (results.length > 0) {
      // add message, TODO: maybe check all msgs for validity before
      await addMessage({
        conversation_id: convo,
        position: position++,
        role: message.role,
        action: "blocked",
        content: message.content,
        model: json.model,
      });
      return c.json(
        apiError("PII was discovered in your request", "pii_detected"),
        400,
      );
    }

    // add message, TODO: maybe check all msgs for validity before
    await addMessage({
      conversation_id: convo,
      position: position++,
      role: message.role,
      action: "allowed",
      content: message.content,
      model: json.model,
    });
  }

  // Only fields the schema knows about are forwarded, so unvalidated extras
  // never leave the building
  const body: Record<string, unknown> = { ...json, model: upstreamModel };
  for (const param of backend.stripParams) delete body[param];

  const saveReply = (reply: CollectedReply) =>
    addMessage({
      conversation_id: convo,
      position,
      role: "assistant",
      action: "allowed",
      content: reply.content,
      tool_calls: reply.toolCalls.length ? reply.toolCalls : null,
      request_id: reply.id,
      model: `${backend.slug}/${reply.model ?? upstreamModel}`,
    }).catch((err) => console.error("Failed to save assistant reply:", err));

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
