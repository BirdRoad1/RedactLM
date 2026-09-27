import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "jsonwebtoken";
import z from "zod";
import { createJWT } from "../auth/jwt";
import { env } from "../env/env";
import type { AuthEnv } from "../middleware/auth";
import { createSsoProviderSchema, updateSsoProviderSchema } from "../schema/sso.schema";
import { audit } from "../services/audit.service";
import * as sso from "../services/sso.service";
import { clientIp } from "../middleware/client-ip";

// The round trip's state rides in a signed cookie that lasts 10 minutes.
// SameSite=Lax: the provider's redirect back is a top-level navigation, which
// Lax lets the cookie ride along with.
const COOKIE = "llm_thingy_sso";
const STATE_AUDIENCE = "llm-thingy:sso-state"; // can't be mistaken for a login token
const secure = env.PUBLIC_API_URL.startsWith("https:");

const stateSchema = z.object({ slug: z.string(), state: z.string(), nonce: z.string(), verifier: z.string() });

// Back to the web app, with the outcome in the URL fragment (never sent to
// servers or logged); the app reads it and removes it right away
const backToApp = (c: Context, fragment: Record<string, string>) =>
  c.redirect(`${env.APP_URL}/sso#${new URLSearchParams(fragment)}`);

// Public: which buttons the login page shows
export async function listSignInOptions(c: Context) {
  const providers = await sso.listProviders();
  return c.json(providers.filter((p) => p.enabled).map(({ slug, name }) => ({ slug, name })));
}

export async function startSignIn(c: Context) {
  const provider = await sso.getEnabledProvider(c.req.param("slug")!);
  if (!provider) return backToApp(c, { error: "That sign-in option isn't available." });

  try {
    const { url, state } = await sso.startSignIn(provider);
    const token = sign(state, env.JWT_SECRET, { expiresIn: 600, audience: STATE_AUDIENCE, algorithm: "HS256" });
    setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: 600 });
    return c.redirect(url.href);
  } catch (err) {
    console.error(`SSO start failed for "${provider.slug}":`, err);
    return backToApp(c, { error: `${provider.name} sign-in isn't working right now.` });
  }
}

export async function finishSignIn(c: Context) {
  const slug = c.req.param("slug")!;
  const cookie = getCookie(c, COOKIE);
  deleteCookie(c, COOKIE, { path: "/" });
  const provider = await sso.getEnabledProvider(slug);
  const via = provider?.name ?? slug;
  const ip = clientIp(c);

  const fail = async (message: string, email = "(unknown)") => {
    await audit("login_failed", { email, ip, via, reason: message }, { userId: null });
    return backToApp(c, { error: message });
  };

  if (!provider) return fail("That sign-in option isn't available.");
  // the person cancelled, or the provider refused
  const providerError = c.req.query("error");
  if (providerError) return fail(`${provider.name} sign-in was cancelled or refused (${providerError}).`);

  let saved: z.infer<typeof stateSchema>;
  try {
    saved = stateSchema.parse(verify(cookie ?? "", env.JWT_SECRET, { audience: STATE_AUDIENCE, algorithms: ["HS256"] }));
    if (saved.slug !== slug) throw new Error("wrong provider");
  } catch {
    return fail("The sign-in took too long or was started elsewhere. Please try again.");
  }

  try {
    const query = new URL(c.req.url).search.slice(1);
    const { userId, email } = await sso.finishSignIn(provider, saved, query);
    await audit("login_succeeded", { email, ip, via }, { userId });
    const { token, expiresAt } = createJWT(userId);
    return backToApp(c, { token, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof sso.SsoError) {
      const email = err.message.match(/[^\s]+@[^\s.]+(\.[^\s.]+)+/)?.[0];
      return fail(err.message, email);
    }
    console.error(`SSO callback failed for "${slug}":`, err);
    return fail(`${provider.name} sign-in isn't working right now.`);
  }
}

// ---------- Admin (manage_settings) ----------

// the secret is write-only; the redirect URI is what to register with the provider
const publicProvider = ({ clientSecret: _, ...p }: sso.SsoProvider) => ({ ...p, redirectUri: sso.redirectUri(p.slug) });

export async function listProviders(c: Context<AuthEnv>) {
  return c.json((await sso.listProviders()).map(publicProvider));
}

export async function createProvider(c: Context<AuthEnv>) {
  const parsed = await createSsoProviderSchema.safeParseAsync(await c.req.json());
  if (parsed.error) {
    return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  }
  try {
    const p = await sso.createProvider(parsed.data);
    await audit("settings_changed", { setting: "single sign-on", changes: { added: p.name, issuer: p.issuer } });
    return c.json(publicProvider(p), 201);
  } catch (err) {
    if (err instanceof sso.DiscoveryError) return c.json({ error: err.message }, 400);
    if (err instanceof sso.SlugTakenError) return c.json({ error: err.message }, 409);
    throw err;
  }
}

const providerId = z.coerce.number().int().positive();

export async function updateProvider(c: Context<AuthEnv>) {
  const id = providerId.safeParse(c.req.param("id"));
  const parsed = await updateSsoProviderSchema.safeParseAsync(await c.req.json());
  if (id.error || parsed.error) return c.json({ error: "Send {\"enabled\"?: boolean, \"allowedDomains\"?: [\"example.com\"]}" }, 400);
  const p = await sso.updateProvider(id.data, parsed.data);
  if (!p) return c.json({ error: "Not found" }, 404);
  await audit("settings_changed", { setting: `single sign-on (${p.name})`, changes: parsed.data });
  return c.json(publicProvider(p));
}

export async function deleteProvider(c: Context<AuthEnv>) {
  const id = providerId.safeParse(c.req.param("id"));
  if (id.error) return c.json({ error: "Not found" }, 404);
  const p = await sso.deleteProvider(id.data);
  if (!p) return c.json({ error: "Not found" }, 404);
  await audit("settings_changed", { setting: "single sign-on", changes: { removed: p.name } });
  return c.body(null, 204);
}
