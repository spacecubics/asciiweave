import { defineConfig } from 'vite'

// The Vite dev server serves the browser app from app/ and proxies API
// requests to the Node server (npm run dev starts both). `appType: 'spa'`
// makes /doc/<id> fall back to index.html during development; in
// built-asset operation, the Node.js target serves app/dist itself and the
// Cloudflare target uses Workers Assets.
export default defineConfig({
  root: 'app',
  appType: 'spa',
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/collab': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
