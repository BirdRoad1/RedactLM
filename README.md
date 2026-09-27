# RedactLM

**Use AI without leaking what matters.** RedactLM sits between your people and ChatGPT, Claude or Gemini. It catches personal data and company secrets before a message leaves the company, and swaps them for placeholders so the answer still helps. Self-hosted and open source.

## Purpose

Companies like T. Rowe Price use LLMs extensively for programming and processing documents. It's important to prevent things like PII, company secrets, and other sensitive data from going to Anthropic, OpenAI, or Google. Even if they get audited and are found to protect the data well, they should not get unnecessary PII in the first place as a matter of data security.

## What it does

- **Checks every message before it leaves.** Rules find Social Security numbers, card numbers (Luhn-checked), bank details (IBAN and routing numbers, checksum-validated), emails, phone numbers, dates of birth and API keys. Your own keywords catch internal names like "Project Falcon". A small local AI model catches what rules can't, like names and health details.
- **Highlights problems as you type**, like a spellchecker for secrets, so you can fix a message before sending it.
- **Blocks, warns or replaces**, depending on the policy you set per check. In replace mode, `My SSN is 529-43-1187` reaches the AI as `My SSN is SSN-3f9a1c0b7e2d`: the placeholder says what it stands for, so the answer still makes sense. The same value always gets the same placeholder within a conversation.
- **Puts your real values back into the reply.** Your browser knows what each placeholder stands for, so the answer shows your details, even though the AI never saw them.
- **Shows exactly what the AI saw.** A switch in the chat shows the placeholders that were actually sent.
- **Reads attachments.** PDFs, images and text files are read on the server with OCR and checked like text before anything is sent.
- **Lets trusted people override**, with the risks explained. Every override is recorded.
- **Keeps a tamper-evident history.** Stored messages are masked and sealed in a hash chain, so reviewers can tell if one was changed. Edited messages keep their originals.
- **Gives IT oversight**: a Review page for reading chats, an audit log with CSV export, roles (review chats, view the audit log, override, manage users, backends, settings and keywords), and sign-in with Google or any OpenID Connect provider.
- **Works with the AI you already use**: Anthropic (its own API, so PDFs work), OpenAI, Google Gemini, and local models through Ollama or any OpenAI-compatible server.

## How it works

1. You send a message, in RedactLM's chat or from any tool that speaks the OpenAI API.
2. The rules and your keywords read all of it, including text from attachments. The local AI model reads the first part (10,000 characters by default).
3. Each finding is scored against your policy: ignore, warn, replace with a placeholder, or block.
4. What's left goes to the AI provider you picked. Stored messages keep every finding masked.
5. The reply streams back, and your browser puts your real values back in where the AI saw placeholders.

The local AI model only ever runs on a backend marked `local`, so the check itself never sends your data to the cloud.

## Why RedactLM

- **Self-hosted**: nothing goes to a third-party checking service, and one container runs everything.
- **Made for the person typing**, not just the security team: live highlighting, plain-language explanations, and placeholders instead of refusals, so people aren't tempted to go around it.
- **A complete product, not a library**: a chat app for employees, an OpenAI-compatible API for developers, and admin pages for IT.

## Use it from your own tools

Anything that talks to the OpenAI API works through RedactLM: change the base URL and use your RedactLM sign-in token as the key.

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://redactlm.yourcompany.com/v1",
    api_key="<your RedactLM token>",
)
client.chat.completions.create(
    model="claude/claude-haiku-4-5",  # "<backend>/<model>"
    messages=[{"role": "user", "content": "Summarize this contract..."}],
)
```

In development, the full API is described at http://localhost:3000/docs.

## Layout and development

This project uses a monorepo with three [Bun workspaces](https://bun.sh/docs/install/workspaces):

- `apps/server`: the API (Hono on Bun), database migrations in `drizzle/`, tests, and scripts
- `apps/web`: the web app (React and Vite)
- `packages/shared`: code and definitions shared by both web and server

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

## Pitfalls

- Some applications may require giving PII to remote models, that is out of scope for the project
- Local AI models may be inaccurate depending on their size, and static checks can only detect so much and have false positives of their own. We make as much configurable as we can
- Placeholders hide values, not meaning: "our CEO's divorce settlement" can still identify someone with every name removed
- Someone determined can get around the checks, for example by spelling out digits or splitting a number across messages. RedactLM protects against mistakes, not against insiders set on leaking
- Long files are only partially read by the LLM scanner to save time and costs, the rest is only handled by the static scanner
- PDFs and images with sensitive data are blocked rather than cleaned up: blacking out a file so nothing can be recovered from it is hard to guarantee
- Responses from LLMs are only logged and never blocked or rewritten, so secrets that somehow end up there remain there
- Real values are only put back into replies while the chat is open: they're never stored, so a reloaded chat shows placeholders
- The hash chain shows when stored messages were changed, but not when the newest ones, or a whole conversation, were deleted
- False positives may be really annoying, requires prompt engineering and usage data
- Should be paired with network and device-level blocks for websites like ChatGPT, Gemini, and Claude
- May not currently be ready to work seamlessly for coding through IDEs like Claude Code, which uses Anthropic's API format rather than OpenAI's
- Files take time to process and overall LLM usage may slow down a bit as checks have to be done, but this depends on hardware available

## Credits

Made by Jose and Tyler at HackUMBC 2026. MIT licensed: see [LICENSE.md](LICENSE.md).
