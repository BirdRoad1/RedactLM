// Live load test: real Claude Haiku calls through LLM Thingy, in rounds of
// simultaneous requests, paced to stay well under your Anthropic rate limits.
// Measures the best, worst and average time per kind of request.
//
//   bun run load-test:live [--concurrency 20] [--rounds 3] [--max-tokens 150]
//                          [--share 0.5] [--base http://localhost:3000] [--keep-data] [--plan-only]
//
// Costs real money (Haiku: $1 / $5 per million input / output tokens); the
// plan and an estimate are printed before anything is sent. Uses
// ANTHROPIC_TEST_API_KEY from .env, and makes sure a "Claude Haiku" backend
// with that key exists (it stays afterwards). Before the run, one tiny direct
// call reads your actual rate limits; rounds are then sized and spaced so
// each minute uses at most `--share` of every limit (requests, input tokens,
// output tokens). Stops at the first 429.

import Anthropic from "@anthropic-ai/sdk";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { buildDetectorRequest } from "../src/checkers/llm/llm-checker";
import { db } from "../src/db";
import { backendsTable, llmDetectorTable } from "../src/db/schema";
import { clearTestUserData, ensureTestUser, TEST_EMAIL } from "./lib/test-user";

const { values: args } = parseArgs({
  options: {
    concurrency: { type: "string", default: "20" },
    rounds: { type: "string", default: "3" },
    "max-tokens": { type: "string", default: "150" },
    share: { type: "string", default: "0.5" }, // of each rate limit, per minute
    base: { type: "string", default: process.env.LOAD_TEST_BASE ?? "http://localhost:3000" },
    "keep-data": { type: "boolean", default: false },
    "plan-only": { type: "boolean", default: false }, // read the limits, print the plan, send nothing else
  },
});
const BASE = args.base!.replace(/\/$/, "");
const ROUNDS = Number(args.rounds);
const MAX_TOKENS = Number(args["max-tokens"]);
const SHARE = Number(args.share);
const MODEL = "claude-haiku-4-5";
const SLUG = "claude-haiku";
const PRICE = { input: 1 / 1e6, output: 5 / 1e6 }; // Haiku 4.5, $ per token

const key = process.env.ANTHROPIC_TEST_API_KEY;
if (!key) {
  console.error("Set ANTHROPIC_TEST_API_KEY in .env");
  process.exit(1);
}

// ---------- 1. the Claude Haiku backend ----------

async function ensureHaikuBackend() {
  const [existing] = await db.select({ id: backendsTable.id }).from(backendsTable).where(eq(backendsTable.slug, SLUG));
  const fields = {
    name: "Claude Haiku",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: key,
    trust: "cloud" as const,
    enabled: true,
    extraHeaders: { "anthropic-version": "2023-06-01" },
  };
  if (existing) {
    await db.update(backendsTable).set(fields).where(eq(backendsTable.id, existing.id));
    return "updated";
  }
  await db.insert(backendsTable).values({ ...fields, slug: SLUG });
  return "created";
}

// ---------- 2. your rate limits, straight from Anthropic ----------

type Limits = { requests: number; requestsLeft: number; input: number; output: number };

async function readLimits(): Promise<Limits> {
  const client = new Anthropic({ apiKey: key, maxRetries: 0 });
  const { response } = await client.messages
    .create({ model: MODEL, max_tokens: 1, messages: [{ role: "user", content: "hi" }] })
    .withResponse();
  const header = (name: string) => Number(response.headers.get(`anthropic-ratelimit-${name}`) ?? NaN);
  const limits = {
    requests: header("requests-limit"),
    requestsLeft: header("requests-remaining"),
    input: header("input-tokens-limit"),
    output: header("output-tokens-limit"),
  };
  if (!Number.isFinite(limits.requests)) throw new Error("Anthropic didn't send rate limit headers; not risking a run");
  return limits;
}

// ---------- 3. the plan ----------

// the detector sees each message too, on its own backend (maybe also Claude)
const [detector] = await db.select().from(llmDetectorTable).where(eq(llmDetectorTable.id, 1));
const detectorBackend = detector?.enabled && detector.backendId
  ? (await db.select().from(backendsTable).where(eq(backendsTable.id, detector.backendId)))[0]
  : undefined;
const detectorIsClaude = !!detectorBackend?.baseUrl.includes("anthropic.com");
const callsPerMessage = 1 + (detectorIsClaude ? 1 : 0);

const PROMPTS = [
  "In two sentences, what makes a good code review?",
  "Give me three tips for writing clear commit messages.",
  "Explain what an API rate limit is, briefly.",
  "Suggest a short, friendly subject line for a team update email.",
];
// Fake personal data, one kind per message in turn: the rules catch most of
// these; the name only the AI detector can. None of it is real (a made-up
// SSN, Visa's public test card, a 555 number, an example.com address).
const PERSONAL = [
  "My SSN is 529-43-1187.",
  "Charge it to my card, 4111 1111 1111 1111.",
  "Call me back at 212-555-0147.",
  "You can reach me at jordan.lee@example.com.",
  "My date of birth is 04/12/1991.",
  "I'm Priya Raman from the Denver office.",
];
const withPersonalData = (p: string, n: number) => `${p} ${PERSONAL[n % PERSONAL.length]}`;
const longestPersonal = PERSONAL.reduce((a, b) => (b.length > a.length ? b : a));

// rough token estimates (~4 characters a token), on the generous side
const tokens = (text: string) => Math.ceil(text.length / 4);
const detectorInput = detectorIsClaude
  ? tokens(JSON.stringify(buildDetectorRequest(detector!.model ?? MODEL, `${PROMPTS[0]} ${longestPersonal}`, detector!.instructions).messages)) + 50
  : 0;
const perMessage = {
  input: tokens(`${PROMPTS[0]} ${longestPersonal}`) + 20 + detectorInput,
  output: MAX_TOKENS + (detectorIsClaude ? 150 : 0),
};

function plan(limits: Limits) {
  const budget = { requests: limits.requests * SHARE, input: limits.input * SHARE, output: limits.output * SHARE };
  // a whole round goes out at once, so it has to fit in one minute's share
  const fits = Math.floor(Math.min(
    budget.requests / callsPerMessage,
    budget.input / perMessage.input,
    budget.output / perMessage.output,
  ));
  const concurrency = Math.max(1, Math.min(Number(args.concurrency), fits));
  // and rounds are spaced so each minute stays within the share
  const perRound = { requests: concurrency * callsPerMessage, input: concurrency * perMessage.input, output: concurrency * perMessage.output };
  const gapMs = Math.ceil(60_000 * Math.max(perRound.requests / budget.requests, perRound.input / budget.input, perRound.output / budget.output));
  return { concurrency, gapMs, perRound };
}

// ---------- 4. the run ----------

type Kind = "chat" | "chat (streamed)" | "chat with personal data";
type Result = {
  kind: Kind;
  ms: number;
  firstWordMs?: number;
  status: number;
  note?: string;
  reply?: string;
  replaced?: string[]; // what was swapped for placeholders before sending
  blockedFor?: string[]; // why it was blocked
  usage?: { prompt_tokens: number; completion_tokens: number };
};

// Sends one message; streamed ones are read chunk by chunk, noting when the
// first words arrive
async function send(token: string, kind: Kind, content: string): Promise<Result> {
  const stream = kind === "chat (streamed)";
  const start = performance.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: `${SLUG}/${MODEL}`, max_tokens: MAX_TOKENS, stream, messages: [{ role: "user", content }] }),
  });
  const replaced = [...new Set((JSON.parse(res.headers.get("X-PII-Replaced") ?? "[]") as { title: string }[]).map((r) => r.title))];
  if (!res.ok) {
    const text = await res.text();
    let blockedFor: string[] | undefined;
    try {
      const error = JSON.parse(text).error as { type?: string; detections?: { title: string }[] };
      if (error.type === "pii_detected") blockedFor = [...new Set((error.detections ?? []).map((d) => d.title))];
    } catch {
      // not JSON
    }
    return { kind, ms: performance.now() - start, status: res.status, blockedFor, note: blockedFor ? undefined : text.slice(0, 160) };
  }
  if (!stream) {
    const body = (await res.json()) as { usage?: Result["usage"]; choices?: { message?: { content?: string } }[] };
    return { kind, ms: performance.now() - start, status: 200, usage: body.usage, reply: body.choices?.[0]?.message?.content ?? "", replaced };
  }
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let firstWordMs: number | undefined;
  let buffer = "";
  let reply = "";
  let complete = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") complete = true;
      if (!data || data === "[DONE]") continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content as string | undefined;
        if (delta) {
          firstWordMs ??= performance.now() - start;
          reply += delta;
        }
      } catch {
        // keep-alives and partial lines
      }
    }
  }
  return { kind, ms: performance.now() - start, firstWordMs, status: 200, reply, replaced, note: complete ? undefined : "stream ended early" };
}

// One line per finished request: prompt -> the start of the reply
const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
function show(prompt: string, r: Result) {
  const time = s(r.ms).padStart(6);
  const tag = r.kind === "chat (streamed)" ? " [streamed]" : "";
  if (r.status === 200 && !r.note) {
    const extra = r.replaced?.length ? `   (sent with placeholders for: ${r.replaced.join(", ")})` : "";
    console.log(`  ok      ${time}${tag}  "${oneLine(prompt, 90)}" -> "${oneLine(r.reply ?? "", 100)}"${extra}`);
  } else if (r.blockedFor) {
    console.log(`  blocked ${time}${tag}  "${oneLine(prompt, 90)}" -> not sent: ${r.blockedFor.join(", ")}`);
  } else {
    console.log(`  FAILED  ${time}${tag}  "${oneLine(prompt, 90)}" -> HTTP ${r.status}: ${oneLine(r.note ?? "", 100)}`);
  }
}

const KINDS: Kind[] = ["chat", "chat (streamed)", "chat with personal data"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const s = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

let userId: number | undefined;
async function cleanUp() {
  if (userId !== undefined && !args["keep-data"]) await clearTestUserData(userId);
}

try {
  const alive = await fetch(`${BASE}/health`).catch(() => undefined);
  if (!alive?.ok) throw new Error(`No server answering at ${BASE}; start it first (bun run dev)`);

  console.log(`Claude Haiku backend "${SLUG}": ${await ensureHaikuBackend()}`);
  const limits = await readLimits();
  console.log(`Your limits for ${MODEL}: ${limits.requests} requests/min (${limits.requestsLeft} left now), ${limits.input.toLocaleString()} input and ${limits.output.toLocaleString()} output tokens/min`);
  console.log(`LLM detector: ${detectorIsClaude ? `on Claude (${detectorBackend!.name}), so each message is ${callsPerMessage} Claude calls` : detector?.enabled ? "on a non-Claude backend" : "off"}`);

  const { concurrency, gapMs, perRound } = plan(limits);
  const messages = concurrency * ROUNDS;
  const cost = messages * (perMessage.input * PRICE.input + perMessage.output * PRICE.output);
  if (concurrency < Number(args.concurrency)) {
    console.log(`Note: ${args.concurrency} at once would exceed ${SHARE * 100}% of a limit, so rounds are ${concurrency} at once.`);
  }
  console.log(`Plan: ${ROUNDS} rounds of ${concurrency} simultaneous messages (${perRound.requests} Claude calls each), ${s(gapMs)} apart. At most ~$${cost.toFixed(3)}.\n`);
  if (limits.requestsLeft < perRound.requests) throw new Error("Not enough of this minute's requests left; try again in a minute");
  if (args["plan-only"]) process.exit(0);

  const user = await ensureTestUser();
  userId = user.id;
  const login = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: TEST_EMAIL, password: user.password }) });
  if (!login.ok) throw new Error(`TestUser couldn't sign in: HTTP ${login.status}`);
  const { token } = (await login.json()) as { token: string };

  const results: Result[] = [];
  let rateLimited = false;
  let messageCount = 0; // walks through the kinds of personal data
  for (let round = 1; round <= ROUNDS && !rateLimited; round++) {
    const roundStart = performance.now();
    console.log(`Round ${round}:`);
    const batch = await Promise.all(
      Array.from({ length: concurrency }, async (_, i) => {
        const kind = KINDS[i % KINDS.length]!;
        const base = PROMPTS[(i + round) % PROMPTS.length]!;
        const prompt = kind === "chat with personal data" ? withPersonalData(base, messageCount++) : base;
        const r = await send(token, kind, prompt).catch((err): Result => ({ kind, ms: 0, status: 0, note: (err as Error).message }));
        show(prompt, r); // printed as each one finishes
        return r;
      }),
    );
    results.push(...batch);
    const worst = Math.max(...batch.map((r) => r.ms));
    const bad = batch.filter((r) => r.status !== 200 && !(r.kind === "chat with personal data" && r.status === 400));
    console.log(`  → round ${round}: ${concurrency} at once, all done in ${s(worst)}${bad.length ? `, ${bad.length} failed` : ""}\n`);
    if (batch.some((r) => r.status === 429)) {
      rateLimited = true;
      const ours = batch.some((r) => r.status === 429 && r.note?.includes("rate_limited"));
      console.log(ours
        ? "Got a 429 from LLM Thingy's own limits (120 chat messages a minute per user): stopping here. Fewer rounds, or restart the server with a higher RATE_LIMIT_MULTIPLIER."
        : "Got a 429 from Anthropic: stopping here.");
    }
    if (round < ROUNDS && !rateLimited) await sleep(Math.max(0, gapMs - (performance.now() - roundStart)));
  }

  // ---------- 5. the report ----------
  const stat = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return {
      best: sorted[0] ?? 0,
      average: sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1),
      p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0,
      worst: sorted.at(-1) ?? 0,
    };
  };
  const row = (label: string, xs: number[], extra = "") => {
    const t = stat(xs);
    console.log(`${label.padEnd(28)} ${String(xs.length).padStart(4)}   ${s(t.best).padStart(7)} ${s(t.average).padStart(8)} ${s(t.p95).padStart(7)} ${s(t.worst).padStart(7)}${extra}`);
  };
  console.log(`\n${"request".padEnd(28)} ${"n".padStart(4)}      best  average     p95   worst`);
  for (const kind of KINDS) {
    const done = results.filter((r) => r.kind === kind && r.status === 200);
    const blocked = results.filter((r) => r.kind === kind && r.status === 400).length;
    const failed = results.filter((r) => r.kind === kind && r.status !== 200 && !(kind === "chat with personal data" && r.status === 400));
    row(kind, done.map((r) => r.ms), `${blocked && kind === "chat with personal data" ? `  (${blocked} blocked by policy)` : ""}${failed.length ? `  ${failed.length} failed` : ""}`);
    if (kind === "chat (streamed)") row("  first words", done.flatMap((r) => (r.firstWordMs === undefined ? [] : [r.firstWordMs])));
    for (const f of failed.slice(0, 2)) console.log(`    e.g. HTTP ${f.status}: ${f.note}`);
  }
  row("everything", results.filter((r) => r.status === 200).map((r) => r.ms));

  const personal = results.filter((r) => r.kind === "chat with personal data");
  const replacedCounts = new Map<string, number>();
  for (const r of personal) for (const t of r.replaced ?? []) replacedCounts.set(t, (replacedCounts.get(t) ?? 0) + 1);
  const blockedCounts = new Map<string, number>();
  for (const r of personal) for (const t of r.blockedFor ?? []) blockedCounts.set(t, (blockedCounts.get(t) ?? 0) + 1);
  const list = (m: Map<string, number>) => [...m].map(([t, n]) => `${t} ×${n}`).join(", ") || "nothing";
  const caughtNothing = personal.filter((r) => r.status === 200 && !r.replaced?.length).length;
  console.log(`\nPersonal data: replaced ${list(replacedCounts)}; blocked ${list(blockedCounts)}; ${caughtNothing} went out with nothing caught.`);

  const used = results.flatMap((r) => (r.usage ? [r.usage] : []));
  if (used.length) {
    const avgIn = used.reduce((n, u) => n + u.prompt_tokens, 0) / used.length;
    const avgOut = used.reduce((n, u) => n + u.completion_tokens, 0) / used.length;
    console.log(`\nChat replies averaged ${Math.round(avgIn)} input / ${Math.round(avgOut)} output tokens (detector calls not included).`);
  }
  const sent = results.length;
  console.log(`${sent} messages, ${sent * callsPerMessage} Claude calls at most; estimated cost at most ~$${(sent * (perMessage.input * PRICE.input + perMessage.output * PRICE.output)).toFixed(3)}.`);

  await cleanUp();
  const failures = results.filter((r) => r.status !== 200 && !(r.kind === "chat with personal data" && r.status === 400)).length;
  console.log(rateLimited ? "STOPPED: rate limited" : failures ? `FINISHED with ${failures} failures` : "PASSED");
  process.exit(rateLimited || failures ? 1 : 0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  await cleanUp();
  process.exit(1);
}
