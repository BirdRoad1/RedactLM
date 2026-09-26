# LLM Thingy Web

Web UI for the [LLM Thingy](../) proxy: chat with PII checks, plus admin pages for
backends, users, the detection policy and the LLM detector.

The styling is placeholder; the pages and API wiring are meant to be kept and reskinned.

## Run

```sh
bun install
bun dev   # http://localhost:5173
```

The backend must be running (default `http://localhost:3000`). In development the app
calls `/api/...` and Vite forwards it to the backend, so no CORS setup is needed.
Point it elsewhere with `API_TARGET=http://host:port bun dev`.

For production either serve the built `dist/` and the API behind one origin
(with `/api` routed to the backend), or build with `VITE_API_URL=https://api.example.com`
and enable CORS on the backend.

## Layout

- `src/api/` – API client, types, streaming chat (`chat.ts`)
- `src/auth/` – session (token in localStorage, logout on expiry or 401)
- `src/pages/` – chat, login, and `admin/` pages
- `src/components/` – layout, highlighted detections, threshold input
