import { and, asc, eq, isNull, sql } from "drizzle-orm";
import * as oidc from "openid-client";
import { db } from "../db";
import { ssoIdentitiesTable, ssoProvidersTable, usersTable } from "../db/schema";
import { env } from "../env/env";
import type { CreateSsoProvider, UpdateSsoProvider } from "../schema/sso.schema";

// Single sign-on with any OpenID Connect provider. The browser goes to the
// provider (authorization code flow with PKCE, state and nonce), comes back
// to our callback, and the provider's verified email is matched to a user an
// admin already created. openid-client does the protocol and checks the ID
// token's signature, issuer, audience, expiry and nonce.

export type SsoProvider = typeof ssoProvidersTable.$inferSelect;

export class SsoError extends Error {} // shown to the person signing in
export class SlugTakenError extends Error {}
export class DiscoveryError extends Error {}

// Where the provider sends people back to; registered with the provider
export const redirectUri = (slug: string) => `${env.PUBLIC_API_URL}/auth/sso/${slug}/callback`;

// http:// issuers are only accepted for local providers outside production
// (see the schema); openid-client needs telling
const discover = (issuer: string, clientId: string, clientSecret: string) =>
  oidc.discovery(
    new URL(issuer),
    clientId,
    undefined,
    oidc.ClientSecretPost(clientSecret),
    issuer.startsWith("http:") ? { execute: [oidc.allowInsecureRequests] } : undefined,
  );

// Provider settings from its discovery document, fetched once per provider
// version (a change to the provider refetches it)
const configs = new Map<string, Promise<oidc.Configuration>>();

function configFor(p: SsoProvider) {
  const key = `${p.id}:${p.updatedAt.getTime()}`;
  let config = configs.get(key);
  if (!config) {
    config = discover(p.issuer, p.clientId, p.clientSecret);
    // a failed lookup (provider down, typo) shouldn't be cached
    config.catch(() => configs.delete(key));
    configs.set(key, config);
  }
  return config;
}

export async function listProviders() {
  return await db.select().from(ssoProvidersTable).orderBy(asc(ssoProvidersTable.id));
}

export async function getEnabledProvider(slug: string) {
  const [p] = await db
    .select()
    .from(ssoProvidersTable)
    .where(and(eq(ssoProvidersTable.slug, slug), eq(ssoProvidersTable.enabled, true)));
  return p;
}

// Checks the issuer answers with a discovery document before saving, so a
// typo shows up here rather than at someone's sign-in
export async function createProvider(data: CreateSsoProvider) {
  try {
    await discover(data.issuer, data.clientId, data.clientSecret);
  } catch (err) {
    throw new DiscoveryError(`Couldn't read the OpenID configuration from ${data.issuer}: ${(err as Error).message}`);
  }
  try {
    const [p] = await db.insert(ssoProvidersTable).values(data).returning();
    return p!;
  } catch (err) {
    if ((err as { cause?: { code?: string } })?.cause?.code === "23505") throw new SlugTakenError(`"${data.slug}" is already used`);
    throw err;
  }
}

export async function updateProvider(id: number, changes: UpdateSsoProvider) {
  const [p] = await db.update(ssoProvidersTable).set(changes).where(eq(ssoProvidersTable.id, id)).returning();
  return p;
}

export async function deleteProvider(id: number) {
  const [p] = await db.delete(ssoProvidersTable).where(eq(ssoProvidersTable.id, id)).returning();
  return p;
}

// What the browser has to carry through the round trip, kept in a signed,
// short-lived cookie
export type SsoState = { slug: string; state: string; nonce: string; verifier: string };

// The provider's sign-in page, plus the state to check on the way back
export async function startSignIn(p: SsoProvider) {
  const config = await configFor(p);
  const state: SsoState = {
    slug: p.slug,
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    verifier: oidc.randomPKCECodeVerifier(),
  };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(p.slug),
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(state.verifier),
    code_challenge_method: "S256",
    state: state.state,
    nonce: state.nonce,
    prompt: "select_account", // pick which account rather than silently reuse one
  });
  return { url, state };
}

// Finishes the round trip: trades the code for tokens, checks the ID token,
// and finds the user. Throws SsoError with a message for the person.
// `query` is the callback's query string.
export async function finishSignIn(p: SsoProvider, saved: SsoState, query: string) {
  const config = await configFor(p);
  let claims: oidc.IDToken | undefined;
  try {
    // the URL the provider sent the browser to, as it saw it (we may sit
    // behind a proxy that changes the path)
    const tokens = await oidc.authorizationCodeGrant(config, new URL(`${redirectUri(p.slug)}?${query}`), {
      pkceCodeVerifier: saved.verifier,
      expectedState: saved.state,
      expectedNonce: saved.nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims();
  } catch (err) {
    throw new SsoError(`${p.name} sign-in didn't complete: ${(err as Error).message}`);
  }

  const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : undefined;
  if (!claims || !email) throw new SsoError(`${p.name} didn't share an email address`);
  if (claims.email_verified !== true) throw new SsoError(`${p.name} hasn't verified ${email}`);
  const domain = email.split("@")[1]!;
  if (p.allowedDomains.length && !p.allowedDomains.some((d) => d.toLowerCase() === domain)) {
    throw new SsoError(`${email} isn't on an allowed domain for ${p.name} sign-in`);
  }

  const userId = await userFor(p, claims.sub, email);
  if (userId === undefined) throw new SsoError(`There's no account for ${email}. Ask an admin to add you.`);
  return { userId, email };
}

// The linked user, or else the (undeleted) user with this email, who then
// gets linked. Undefined if there's neither.
async function userFor(p: SsoProvider, subject: string, email: string) {
  const [linked] = await db
    .select({ userId: usersTable.id })
    .from(ssoIdentitiesTable)
    .innerJoin(usersTable, eq(usersTable.id, ssoIdentitiesTable.userId))
    .where(and(eq(ssoIdentitiesTable.providerId, p.id), eq(ssoIdentitiesTable.subject, subject), isNull(usersTable.deletedAt)));
  if (linked) return linked.userId;

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(sql`lower(${usersTable.email}) = ${email}`, isNull(usersTable.deletedAt)));
  if (!user) return undefined;

  // first sign-in (or the account it was linked to was deleted since)
  await db
    .insert(ssoIdentitiesTable)
    .values({ providerId: p.id, subject, userId: user.id, email })
    .onConflictDoUpdate({ target: [ssoIdentitiesTable.providerId, ssoIdentitiesTable.subject], set: { userId: user.id, email } });
  return user.id;
}
