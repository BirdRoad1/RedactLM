# RedactLM Web

Web UI for the [RedactLM](../../) proxy: chat with PII checks, plus admin pages for
backends, users, the detection policy and the LLM detector.

The styling is placeholder; the pages and API wiring are meant to be kept and reskinned.

## Run

From the repo root, `bun run dev` starts this app (http://localhost:5173) and the API
together. In development the app calls `/api/...` and Vite forwards it to the API, so no
CORS setup is needed; point it elsewhere with `API_TARGET=http://host:port`.

In production the API serves the built app itself (see the root README's Docker section).
Types describing the API come from `packages/shared`.

## Icons and link previews

The favicons, the iOS icon and the web manifest's icons are all built from the HackUMBC 2026
crest (`src/assets/hackumbc2026-logo.svg`): `bash scripts/build-icons.sh` regenerates them
(needs `rsvg-convert`: `apt install librsvg2-bin`). The link-preview image, `public/og-image.png`,
is `scripts/og-card.html` screenshotted at 1200×630.

`index.html` carries `__APP_URL__` where link previews need absolute URLs; the server fills
in `APP_URL` when it serves the page, and Vite does the same in development.

## Layout

- `src/api/` – API client, types, streaming chat (`chat.ts`)
- `src/auth/` – session (token in localStorage, logout on expiry or 401)
- `src/pages/` – chat, login, and `admin/` pages
- `src/components/` – layout, highlighted detections, threshold input
