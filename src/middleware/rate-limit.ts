import { createMiddleware } from "hono/factory";
import { env } from "../env/env";
import { audit } from "../services/audit.service";
import type { AuthEnv } from "./auth";
import { requestIp } from "./client-ip";

// Loose limits against runaway scripts and password guessing, far above what
// a person does. Counted per minute, per user on signed-in routes and per
// address on public ones, in this process's memory (each instance of the
// API counts on its own). RATE_LIMIT_MULTIPLIER scales them all; 0 turns
// them off, e.g. for load tests.

type Window = { count: number; resetAt: number; logged: boolean };
const windows = new Map<string, Window>();
const MINUTE = 60_000;

// forget finished windows, so the map doesn't grow with every address seen
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}, MINUTE).unref();

// `name` identifies the limit (in keys and the audit log). "user" limits
// must come after requireUser / requireRole.
export function rateLimit(name: string, perMinute: number, by: "user" | "ip") {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const limit = Math.round(perMinute * env.RATE_LIMIT_MULTIPLIER);
    if (limit <= 0) return next();

    const userId = by === "user" ? c.get("userId") : undefined;
    const who = userId !== undefined ? `user:${userId}` : `ip:${requestIp(c)}`;
    const key = `${name}|${who}`;
    const now = Date.now();
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + MINUTE, logged: false };
      windows.set(key, w);
    }
    w.count++;

    const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(Math.max(0, limit - w.count)));
    c.header("RateLimit-Reset", String(retryAfter));
    if (w.count <= limit) return next();

    // once per window per limit and caller: enough to spot guessing or a
    // runaway script without flooding the log
    if (!w.logged) {
      w.logged = true;
      await audit("rate_limited", { limit: name, perMinute: limit, ...(userId === undefined && { ip: requestIp(c) }) }, userId === undefined ? { userId: null } : {});
    }
    c.header("Retry-After", String(retryAfter));
    return c.json(
      { error: { message: `Too many requests; try again in ${retryAfter} seconds.`, type: "rate_limited" } },
      429,
    );
  });
}
