// Load test: many concurrent clients, all signed in as one TestUser, hammer a
// running server with a weighted mix of real API calls. Chats go to a fake
// model this script runs, and the LLM detector is pointed at it for the run,
// so every request takes the full path (rules, detector, storage, audit)
// without calling any paid API.
//
//   bun run load-test [--users 25] [--duration 30] [--base http://localhost:3000]
//                     [--latency 150] [--with-models] [--keep-data]
//
// Needs the server's database (DATABASE_URL, as in .env) to set up the test
// user, the fake backend and the detector; everything but the user is put
// back afterwards, also on Ctrl+C. Exits 1 if more than 1% of requests got an
// unexpected answer or any got a server error.

import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { backendsTable, llmDetectorTable } from "../src/db/schema";
import { clearTestUserData, ensureTestUser, TEST_EMAIL } from "./lib/test-user";

const { values: args } = parseArgs({
  options: {
    users: { type: "string", default: "25" },
    duration: { type: "string", default: "30" }, // seconds
    base: { type: "string", default: process.env.LOAD_TEST_BASE ?? "http://localhost:3000" },
    latency: { type: "string", default: "150" }, // the fake model's thinking time, ms
    "fake-host": { type: "string", default: "localhost" }, // how the server reaches this script
    "with-models": { type: "boolean", default: false }, // /v1/models asks every real backend too
    "keep-data": { type: "boolean", default: false },
  },
});
const USERS = Number(args.users);
const DURATION_MS = Number(args.duration) * 1000;
const BASE = args.base!.replace(/\/$/, "");
const LATENCY = Number(args.latency);
const EMAIL = TEST_EMAIL;
const SLUG = "loadtest";

// ---------- a fake model: chats, and detector answers ----------

const upstreamCalls = { chat: 0, stream: 0, detector: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => LATENCY * (0.5 + Math.random());

const fake = Bun.serve({
  port: 0,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: "fake-chat", object: "model", owned_by: "load-test" }] });
    }
    const body = (await req.json()) as { model: string; stream?: boolean; messages: { content: string }[] };
    if (body.model === "fake-detector") {
      upstreamCalls.detector++;
      await sleep(jitter() / 3);
      // finds names it's been told about, like a real detector would
      const text = body.messages.at(-1)?.content ?? "";
      const findings = text.includes("Jane Cooper")
        ? [{ text: "Jane Cooper", category: "name", confidence: 0.9, reason: "A person's full name." }]
        : [];
      return Response.json(completion(JSON.stringify({ findings })));
    }
    if (!body.stream) {
      upstreamCalls.chat++;
      await sleep(jitter());
      return Response.json(completion("Here's a short, helpful answer from the fake model."));
    }
    upstreamCalls.stream++;
    const words = "Here is a streamed answer arriving a few words at a time".split(" ");
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: string) => controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        for (const word of words) {
          await sleep(jitter() / words.length);
          send(JSON.stringify({ id: "chatcmpl-load", object: "chat.completion.chunk", created: 0, model: "fake-chat", choices: [{ index: 0, delta: { content: `${word} ` }, finish_reason: null }] }));
        }
        send("[DONE]");
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  },
});

function completion(content: string) {
  return { id: "chatcmpl-load", object: "chat.completion", created: 0, model: "fake-chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] };
}

// ---------- setup and restore ----------

let savedDetector: typeof llmDetectorTable.$inferSelect | undefined;
let detectorChanged = false; // only then is there anything to put back
let userId: number | undefined;
let restored = false;

async function setUp() {
  const alive = await fetch(`${BASE}/`).catch(() => undefined);
  if (!alive?.ok) throw new Error(`No server answering at ${BASE}; start it first (bun run dev)`);
  // hundreds of requests a second from one user is exactly what the rate
  // limits stop; they'd turn the run into a wall of 429s
  if (alive.headers.get("RateLimit-Limit")) {
    throw new Error("The server's rate limits are on. Restart it with them off for load testing:\n  RATE_LIMIT_MULTIPLIER=0 bun run dev");
  }

  const user = await ensureTestUser();
  userId = user.id;

  // a fresh fake backend (a crashed run may have left one)
  await db.delete(backendsTable).where(eq(backendsTable.slug, SLUG));
  const [backend] = await db
    .insert(backendsTable)
    .values({ name: "Load test (fake)", slug: SLUG, baseUrl: `http://${args["fake-host"]}:${fake.port}/v1`, trust: "local", timeoutMs: 30_000 })
    .returning({ id: backendsTable.id });

  [savedDetector] = await db.select().from(llmDetectorTable).where(eq(llmDetectorTable.id, 1));
  detectorChanged = true;
  await db
    .insert(llmDetectorTable)
    .values({ id: 1, enabled: true, backendId: backend!.id, model: "fake-detector" })
    .onConflictDoUpdate({ target: llmDetectorTable.id, set: { enabled: true, backendId: backend!.id, model: "fake-detector" } });

  return user.password;
}

async function restore() {
  if (restored) return;
  restored = true;
  // only what this run changed: a run that stopped before setting up
  // (server down, rate limits on) must leave the detector alone
  if (detectorChanged && savedDetector) {
    const { id: _, updatedAt: __, ...detector } = savedDetector;
    await db.update(llmDetectorTable).set(detector).where(eq(llmDetectorTable.id, 1));
  } else if (detectorChanged) {
    await db.delete(llmDetectorTable).where(eq(llmDetectorTable.id, 1));
  }
  await db.delete(backendsTable).where(eq(backendsTable.slug, SLUG));
  if (userId !== undefined && !args["keep-data"]) await clearTestUserData(userId);
  fake.stop(true);
}

// Ctrl+C: stop starting requests, let the ones in flight finish (they'd
// otherwise land after the clean-up), then put things back
let stopping = false;
let clients: Promise<unknown> | undefined;
process.on("SIGINT", async () => {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping: finishing requests in flight, then putting things back…");
  await clients;
  await restore();
  process.exit(130);
});

// ---------- what the clients do ----------

type Outcome = { ok: boolean; status: number; note?: string };
type Scenario = { name: string; weight: number; run: (s: Session) => Promise<Outcome> };
type Session = { token: string; conversations: string[] };

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
const tag = () => Math.random().toString(36).slice(2, 8); // defeats the detector's cache
const SENSITIVE = ["my SSN is 529-43-1187", "email me at jane.cooper@acme.com", "call 212-555-0147", "card 4111 1111 1111 1111", "I'm Jane Cooper"];
const CLEAN = ["summarize the quarterly plan", "draft a polite follow-up", "explain this error message", "suggest three names for a team offsite"];
const message = (sensitive: boolean) => `Please ${pick(CLEAN)}${sensitive ? `, and ${pick(SENSITIVE)}` : ""} (ref ${tag()})`;

let password = "";
const call = (path: string, token: string | undefined, init: RequestInit & { json?: unknown } = {}) =>
  fetch(BASE + path, {
    ...init,
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(init.json !== undefined && { "Content-Type": "application/json" }), ...init.headers },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

// what counts as a correct answer: blocked messages are correct too
const expect = async (res: Response, ok: number[]) => {
  const text = await res.text();
  return ok.includes(res.status) ? { ok: true, status: res.status } : { ok: false, status: res.status, note: text.slice(0, 120) };
};

async function chat(s: Session, sensitive: boolean, stream = false, continuing?: string): Promise<Outcome> {
  const res = await call("/v1/chat/completions", s.token, {
    json: { model: `${SLUG}/fake-chat`, stream, messages: [{ role: "user", content: message(sensitive) }] },
    headers: continuing ? { "X-Conversation-Id": continuing } : undefined,
  });
  const convo = res.headers.get("X-Conversation-Id");
  if (res.ok && convo && !s.conversations.includes(convo)) s.conversations.push(convo);
  if (stream && res.ok) {
    const text = await res.text(); // read to the end, like a client would
    return text.includes("[DONE]") ? { ok: true, status: 200 } : { ok: false, status: 200, note: "stream ended early" };
  }
  // with personal data: sent with placeholders (replace mode) or refused (block mode)
  return expect(res, sensitive ? [200, 400] : [200]);
}

const scenarios: Scenario[] = [
  { name: "GET /me", weight: 10, run: async (s) => expect(await call("/me", s.token), [200]) },
  { name: "POST /check (live check)", weight: 25, run: async (s) => expect(await call("/check", s.token, { json: { text: message(Math.random() < 0.6) } }), [200]) },
  { name: "chat", weight: 20, run: (s) => chat(s, false) },
  { name: "chat (streamed)", weight: 15, run: (s) => chat(s, false, true) },
  { name: "chat with personal data", weight: 10, run: (s) => chat(s, true) },
  { name: "chat follow-up", weight: 7, run: (s) => (s.conversations.length ? chat(s, false, false, pick(s.conversations)) : chat(s, false)) },
  { name: "GET /conversations", weight: 8, run: async (s) => expect(await call("/conversations", s.token), [200]) },
  {
    name: "POST /check/file",
    weight: 3,
    run: async (s) => {
      const data = `data:text/plain;base64,${Buffer.from(`Notes ${tag()}: ${pick(SENSITIVE)}`).toString("base64")}`;
      return expect(await call("/check/file", s.token, { json: { filename: "notes.txt", data } }), [200]);
    },
  },
  { name: "POST /auth/login", weight: 2, run: async () => expect(await call("/auth/login", undefined, { json: { email: EMAIL, password } }), [200]) },
  ...(args["with-models"] ? [{ name: "GET /v1/models", weight: 5, run: async (s: Session) => expect(await call("/v1/models", s.token), [200]) }] : []),
];
const totalWeight = scenarios.reduce((n, s) => n + s.weight, 0);
function choose() {
  let r = Math.random() * totalWeight;
  return scenarios.find((s) => (r -= s.weight) < 0) ?? scenarios[0]!;
}

// ---------- run and report ----------

type Stats = { times: number[]; bad: number; serverErrors: number; samples: string[] };
const stats = new Map<string, Stats>(scenarios.map((s) => [s.name, { times: [], bad: 0, serverErrors: 0, samples: [] }]));

// One sign-in shared by every client: it's one user hammering the API, and
// 25 password hashes at once (about 64 MB each) would test the start-up, not
// the load. The login scenario still signs in now and then.
async function signIn() {
  const login = await call("/auth/login", undefined, { json: { email: EMAIL, password } });
  if (!login.ok) throw new Error(`TestUser couldn't sign in: HTTP ${login.status}`);
  return ((await login.json()) as { token: string }).token;
}

async function client(token: string, deadline: number) {
  const session: Session = { token, conversations: [] };
  while (Date.now() < deadline && !stopping) {
    const scenario = choose();
    const s = stats.get(scenario.name)!;
    const start = performance.now();
    let outcome: Outcome;
    try {
      outcome = await scenario.run(session);
    } catch (err) {
      outcome = { ok: false, status: 0, note: (err as Error).message };
    }
    s.times.push(performance.now() - start);
    if (!outcome.ok) {
      s.bad++;
      if (outcome.status >= 500 || outcome.status === 0) s.serverErrors++;
      if (s.samples.length < 3) s.samples.push(`HTTP ${outcome.status}${outcome.note ? `: ${outcome.note}` : ""}`);
    }
  }
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0);
const ms = (n: number) => `${Math.round(n)}`.padStart(6);

try {
  password = await setUp();
  console.log(`Load test: ${USERS} clients as TestUser (${EMAIL}) for ${DURATION_MS / 1000}s against ${BASE}`);
  console.log(`Fake model on :${fake.port}, ${LATENCY} ms thinking time; the LLM detector points at it for the run.\n`);

  const token = await signIn();
  const started = performance.now();
  const deadline = Date.now() + DURATION_MS;
  const progress = setInterval(() => {
    const done = [...stats.values()].reduce((n, s) => n + s.times.length, 0);
    const bad = [...stats.values()].reduce((n, s) => n + s.bad, 0);
    const secs = (performance.now() - started) / 1000;
    console.log(`  ${secs.toFixed(0).padStart(3)}s  ${done} requests  ${(done / secs).toFixed(1)}/s  ${bad} unexpected`);
  }, 5000);
  clients = Promise.all(Array.from({ length: USERS }, () => client(token, deadline)));
  await clients;
  if (stopping) await new Promise(() => {}); // the SIGINT handler finishes up
  clearInterval(progress);
  const elapsed = (performance.now() - started) / 1000;

  console.log(`\n${"request".padEnd(26)} ${"count".padStart(6)} ${"bad".padStart(5)}    p50    p95    p99    max  (ms)`);
  let total = 0, bad = 0, serverErrors = 0;
  for (const [name, s] of stats) {
    const sorted = [...s.times].sort((a, b) => a - b);
    total += sorted.length; bad += s.bad; serverErrors += s.serverErrors;
    console.log(`${name.padEnd(26)} ${String(sorted.length).padStart(6)} ${String(s.bad).padStart(5)} ${ms(pct(sorted, 50))} ${ms(pct(sorted, 95))} ${ms(pct(sorted, 99))} ${ms(sorted.at(-1) ?? 0)}`);
    for (const sample of s.samples) console.log(`    e.g. ${sample}`);
  }
  const badRate = total ? bad / total : 0;
  console.log(`\n${total} requests in ${elapsed.toFixed(1)}s: ${(total / elapsed).toFixed(1)}/s, ${(badRate * 100).toFixed(2)}% unexpected, ${serverErrors} server errors`);
  console.log(`Fake model calls: ${upstreamCalls.chat} chats, ${upstreamCalls.stream} streams, ${upstreamCalls.detector} detector checks`);

  await restore();
  const passed = badRate <= 0.01 && serverErrors === 0;
  console.log(passed ? "PASSED" : "FAILED: over 1% unexpected answers, or server errors");
  process.exit(passed ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  await restore();
  process.exit(1);
}
