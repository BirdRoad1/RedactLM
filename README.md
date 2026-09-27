# LLM Thingy

## Purpose
Companies like T. Rowe Price use LLMs extensively for vertification and market analysis. It's important to prevent things like PII, company secrets, and other sensitive data from going to Anthropic, OpenAI, or Google. Even if they get audited and are found to protect the data well, they should not get unnecessary PII in the first place as a matter of data security.

## Layout and development

One repo, three workspaces ([Bun workspaces](https://bun.sh/docs/install/workspaces), one `bun.lock`):

- `apps/server`: the API (Hono on Bun), database migrations in `drizzle/`, tests, and scripts
- `apps/web`: the web app (React and Vite)
- `packages/shared`: what both use: roles, the keyword rule, and the API's shapes, which the server checks its responses against (`apps/server/src/api-contract.ts`)

With Postgres running and a `.env` at the repo root (see `.env.example`):

```sh
bun install
bun run migrate
bun run create-admin you@example.com you
bun run dev          # the API on :3000 and the web app on http://localhost:5173
```

`bun run test` and `bun run typecheck` cover everything. After changing the database schema, run `bunx drizzle-kit generate --name what-changed` in `apps/server`.

## Run with Docker

```sh
cp .env.example .env        # set JWT_SECRET (openssl rand -base64 48) and POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec -it app bun run create-admin you@example.com you
```

Open http://localhost:8080 and sign in. One container serves the web app and the API (OpenAI-style clients use http://localhost:8080/v1); for HTTPS, put a reverse proxy such as Caddy in front and set `TRUST_PROXY=true`. Database migrations run whenever the API starts. For a local model (e.g. Gemma) as the LLM detector, also run `docker compose --profile local-ai up -d`, pull a model with `docker compose exec ollama ollama pull gemma3`, and add the "Ollama (local)" backend with `http://ollama:11434/v1` as its URL.

## Load testing

With the dev server running with its rate limits off:

```sh
RATE_LIMIT_MULTIPLIER=0 bun run dev
bun run load-test --users 100 --duration 30
```

Many concurrent clients, signed in as one TestUser (`loadtest@test.local`, created if missing), hammer the API with a mix of live checks, chats (plain, streamed, with personal data, follow-ups), file checks, logins and history. Chats and the LLM detector go to a fake model the script runs, so nothing paid is called. It prints latency percentiles per request type and exits 1 on more than 1% unexpected answers or any server error. The detector settings, the fake backend and TestUser's chats and audit entries are put back afterwards, also on Ctrl+C. Options: `--base`, `--latency` (the fake model's thinking time, ms), `--with-models` (also calls `/v1/models`, which asks the real backends), `--keep-data`.

## LLM Credits
I think API has a free API.
Must buy $10 of Claude AI credits.
Maybe buy some OpenAI credits.
Focus on OpenAI-supported.

## Ideas

Jose & Tyler

- [x] Runs in Docker, should be very easy to setup
- [ ] Support Gemini (and enter that track), Claude, ChatGPT OpenAI
- [x] Custom LLM chat frontend, designed by Tyler, separate for proof-of-concept
- [x] Start by recognizing PII using set rules like regex formats
- [x] Detect PII using a small, local LLM model
- [x] Potentially replace known PII with placeholders rather than erasing altogether
- [x] In certain cases, maybe reject promtps entirely
- [x] Open-source and free
- [ ] Audit log perhaps using Merkle Trees for data security and verifiability
- [x] Allow users and roles so users can do prompts, IT can review prompts, etc.
- [x] Allow user to override detections if not 100% certain that it's PII, explain risks
- [x] Configurable so the business can change settings
- [ ] Before switching to a non-local model, we can offer a warning
- [ ] Outline that the success depends on how large our local model is
- [ ] Make sure to benchmark and support dozens or hundreds of concurrent users making requests and prompting
- [ ] Detecting unauthorized prompting through either a forced HTTP proxy, or intercepting requests to LLM-related IPs and TLS SNI
- [ ] Start with small scope, expand as needed, do not allow creep
- [ ] Custom keywords, so we prevent internal names and trade secrets from being shared
- [x] Start without streaming, add streaming later