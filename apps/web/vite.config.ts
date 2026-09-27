import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
