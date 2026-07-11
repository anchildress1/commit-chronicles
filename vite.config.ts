import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    // Pinned and strict: the default range is a crowded neighbourhood, and a dev server
    // that silently lands on another port takes the E2E suite's baseURL with it.
    port: 5273,
    strictPort: true,
    proxy: {
      // Anchored, because a bare '/api' prefix also matches the client's own `/api.ts`
      // module request and proxies it to the backend — where it 404s, and the SPA never
      // boots. Only real API routes go through.
      '^/api/': 'http://localhost:8080',
    },
  },
});
