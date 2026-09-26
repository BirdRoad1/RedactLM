import type { Context } from "hono";
import {
  backendIdSchema,
  createBackendSchema,
} from "../schema/backends.schema";
import * as backendsService from "../services/backends.service";
import type { Backend } from "../services/backends.service";

// API keys are write-only: responses show just enough to tell keys apart
function publicBackend(backend: Backend) {
  return { ...backend, apiKey: backend.apiKey && `****${backend.apiKey.slice(-4)}` };
}

export async function listBackends(c: Context) {
  return c.json((await backendsService.listBackends()).map(publicBackend));
}

export async function createBackend(c: Context) {
  const parsed = await createBackendSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: "Invalid request" }, 400);
  }

  try {
    return c.json(publicBackend(await backendsService.createBackend(parsed.data)), 201);
  } catch (err) {
    if (err instanceof backendsService.BackendSlugTakenError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
}

export async function deleteBackend(c: Context) {
  const id = backendIdSchema.safeParse(c.req.param("id"));
  if (id.error) {
    return c.json({ error: "Invalid backend id" }, 400);
  }

  const deleted = await backendsService.deleteBackend(id.data);
  if (!deleted) {
    return c.json({ error: "Backend not found" }, 404);
  }

  return c.json(publicBackend(deleted));
}
