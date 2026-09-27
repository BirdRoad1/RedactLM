import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { env } from "../env/env";

// The address of whoever connected; undefined outside Bun.serve (tests)
function socketIp(c: Context) {
  try {
    // "::ffff:10.0.0.5" is how IPv6 sockets show IPv4 addresses
    return getConnInfo(c).remote.address?.replace(/^::ffff:(?=\d+\.)/, "");
  } catch {
    return undefined;
  }
}

// The client's address. Behind a proxy we run (TRUST_PROXY, e.g. the web
// container's nginx), every request comes from the proxy, so the client is
// the last X-Forwarded-For entry: the one the proxy added. Earlier entries
// are whatever the client claimed, so they're never used.
export function requestIp(c: Context) {
  const forwarded = env.TRUST_PROXY ? c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim() : undefined;
  return forwarded || socketIp(c) || "unknown";
}

// The address as recorded in the audit log. Without a trusted proxy,
// X-Forwarded-For is noted alongside rather than believed.
export function clientIp(c: Context) {
  if (env.TRUST_PROXY) return requestIp(c);
  const remote = socketIp(c);
  const forwarded = c.req.header("X-Forwarded-For");
  return forwarded ? `${remote ?? "?"} (forwarded for ${forwarded})` : remote;
}
