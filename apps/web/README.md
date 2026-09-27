# LLM Thingy Web

Web UI for the [LLM Thingy](../../) proxy: chat with PII checks, plus admin pages for
backends, users, the detection policy and the LLM detector.

The styling is placeholder; the pages and API wiring are meant to be kept and reskinned.

## Run

From the repo root, `bun run dev` starts this app (http://localhost:5173) and the API
together. In development the app calls `/api/...` and Vite forwards it to the API, so no
CORS setup is needed; point it elsewhere with `API_TARGET=http://host:port`.

In production the API serves the built app itself (see the root README's Docker section).
Types describing the API come from `packages/shared`.

## Layout

- `src/api/` – API client, types, streaming chat (`chat.ts`)
- `src/auth/` – session (token in localStorage, logout on expiry or 401)
- `src/pages/` – chat, login, and `admin/` pages
- `src/components/` – layout, highlighted detections, threshold input
