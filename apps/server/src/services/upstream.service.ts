import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { CompletionErrorResponse } from "../schema/completion-response.schema";
import type { CompletionsRequest } from "../schema/completions-request.schema";
import { anthropicJson, anthropicModels, anthropicStream } from "./anthropic.service";
import type { Backend } from "./backends.service";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 504,
  ) {
    super(message);
  }
}

type UpstreamInit = {
  body?: unknown; // sent as JSON with POST, otherwise GET
  signal?: AbortSignal; // the client's request signal, so disconnects cancel upstream
  timeoutMs?: number; // defaults to the backend's timeout
};

function upstreamRequest(backend: Backend, path: string, init: UpstreamInit, signal: AbortSignal) {
  // "http://vllm:8000/v1/" + "/models" without doubling the slash
  const url = backend.baseUrl.replace(/\/+$/, "") + path;

  return fetch(url, {
    method: init.body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(backend.apiKey && { Authorization: `Bearer ${backend.apiKey}` }),
      ...backend.extraHeaders,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal,
  });
}

// Runs `run` with a signal that aborts on timeout or client disconnect.
// The timeout only covers `run`: once it resolves, the timer is cleared.
async function withTimeout<T>(
  backend: Backend,
  init: UpstreamInit,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), init.timeoutMs ?? backend.timeoutMs);
  const signal = init.signal ? AbortSignal.any([timeout.signal, init.signal]) : timeout.signal;

  try {
    return await run(signal);
  } catch (err) {
    if (timeout.signal.aborted) {
      throw new UpstreamError(`Backend "${backend.slug}" timed out`, 504);
    }
    if (init.signal?.aborted) throw err; // client went away, nobody to answer
    console.error(`Backend "${backend.slug}" request failed:`, err);
    throw new UpstreamError(`Could not reach backend "${backend.slug}"`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// Whole request, body included, must finish within the timeout
export function upstreamJson(backend: Backend, path: string, init: UpstreamInit = {}) {
  return withTimeout(backend, init, async (signal) => {
    const res = await upstreamRequest(backend, path, init, signal);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  });
}

// Timeout only covers getting the response headers: a stream may run as long
// as it keeps producing tokens
export function upstreamStream(backend: Backend, path: string, init: UpstreamInit) {
  return withTimeout(backend, init, (signal) => upstreamRequest(backend, path, init, signal));
}

// Chat completions and the model list, whichever API the backend speaks.
// Anthropic backends get the request translated and answer in OpenAI's shape.

export function chatCompletionJson(backend: Backend, init: UpstreamInit) {
  if (backend.api === "anthropic") {
    return withTimeout(backend, init, (signal) => anthropicJson(backend, init.body as CompletionsRequest, signal));
  }
  return upstreamJson(backend, "/chat/completions", init);
}

export function chatCompletionStream(backend: Backend, init: UpstreamInit) {
  if (backend.api === "anthropic") {
    return withTimeout(backend, init, (signal) => anthropicStream(backend, init.body as CompletionsRequest, signal));
  }
  return upstreamStream(backend, "/chat/completions", init);
}

export function listUpstreamModels(backend: Backend, init: UpstreamInit) {
  if (backend.api === "anthropic") return withTimeout(backend, init, (signal) => anthropicModels(backend, signal));
  return upstreamJson(backend, "/models", init);
}

// Turns a failed upstream response into something to hand back to the client.
// OpenAI-style error bodies pass through; anything else gets wrapped.
export function upstreamErrorResponse(status: number, text: string) {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {}

  if (!(body && typeof body === "object" && "error" in body)) {
    body = {
      error: { message: text || `Backend returned HTTP ${status}`, type: "upstream_error" },
    } satisfies CompletionErrorResponse;
  }

  // The backend rejecting *our* API key isn't the client's auth problem
  const clientStatus = status === 401 || status === 403 ? 502 : status;
  return { body, status: clientStatus as ContentfulStatusCode };
}
