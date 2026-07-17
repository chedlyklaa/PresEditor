import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin in dev — the backend (server/, started separately or
      // via the root-level `npm run dev`) listens on :4000. This removes
      // any cross-port CORS/SameSite subtlety in dev; a real deployment's
      // reverse proxy (e.g. Caddy) does the equivalent in front of the
      // built static files.
      '/api': 'http://localhost:4000',
    },
  },
})
