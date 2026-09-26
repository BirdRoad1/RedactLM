import type { Context } from "hono";
import z from "zod";
import type { ModelsList } from "../schema/models-request.schema";
import { listEnabledBackends } from "../services/backends.service";
import { upstreamJson } from "../services/upstream.service";

// Backends don't all fill in every field, only `id` is needed
const upstreamModels = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      created: z.number().int().optional(),
      owned_by: z.string().optional(),
    }),
  ),
});

// A dead backend shouldn't hold up the whole list for its full completion timeout
const LIST_TIMEOUT_MS = 10_000;

export async function listModels(c: Context) {
  const backends = await listEnabledBackends();

  const perBackend = await Promise.all(
    backends.map(async (backend) => {
      try {
        const res = await upstreamJson(backend, "/models", {
          signal: c.req.raw.signal,
          timeoutMs: Math.min(backend.timeoutMs, LIST_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.text}`);

        return upstreamModels.parse(JSON.parse(res.text)).data.map((model) => ({
          id: `${backend.slug}/${model.id}`,
          object: "model" as const,
          created: model.created ?? 0,
          owned_by: model.owned_by ?? backend.name,
        }));
      } catch (err) {
        // one broken backend shouldn't hide the others' models
        console.error(`Could not list models for backend "${backend.slug}":`, err);
        return [];
      }
    }),
  );

  return c.json({ object: "list", data: perBackend.flat() } satisfies ModelsList);
}
