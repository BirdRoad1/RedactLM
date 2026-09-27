import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// index.html carries __APP_URL__ where link previews need absolute URLs. In
// production the server fills in its APP_URL; in development this does, with
// the dev server's own address. Builds keep the placeholder for the server.
const appUrl = (): Plugin => ({
  name: 'app-url',
  apply: 'serve',
  transformIndexHtml(html, ctx) {
    const url = process.env.APP_URL ?? `http://localhost:${ctx.server?.config.server.port ?? 5173}`
    return html.replaceAll('__APP_URL__', url.replace(/\/$/, ''))
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), appUrl()],
  server: {
    // The app calls /api/...; in dev that's forwarded to the backend, so no CORS
    // is needed. In production put both behind one origin the same way, or set
    // VITE_API_URL to the backend's URL (and enable CORS there).
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
