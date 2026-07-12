import { createLogger, defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The API compiles for a few seconds while Vite is ready in under one, so polls from an
 * already-open page are refused until it lands.
 *
 * Vite answers a refused proxy request by printing an ECONNREFUSED stack trace and hanging the
 * request, which makes `make dev` read like it crashed on boot. Neither is true: the API is
 * simply still starting. Say so in one line, and hand the page a 503 its poll can survive.
 */
const api = (): ProxyOptions => ({
  target: 'http://localhost:8080',
  configure: (proxy) => {
    proxy.on('error', (error, _request, response) => {
      const starting = (error as NodeJS.ErrnoException).code === 'ECONNREFUSED';

      // A websocket upgrade hands back a raw socket, which cannot be answered with a status.
      if (!('writeHead' in response)) return;
      if (response.headersSent) return;

      response.writeHead(starting ? 503 : 502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: starting ? 'api_starting' : 'api_unreachable' }));
    });
  },
});

/**
 * Vite's proxy stack trace is printed from its logger, not from the `error` handler above —
 * which runs first and has already answered the request. Drop that one message and nothing
 * else: a proxy error the page has recovered from is not news, but every other error is.
 */
const logger = createLogger();
const inherited = logger.error.bind(logger);
logger.error = (message, options) => {
  if (message.includes('http proxy error')) {
    if (message.includes('ECONNREFUSED')) inherited('[api] not up yet — the page will retry');
    return;
  }
  inherited(message, options);
};

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  customLogger: logger,
  server: {
    // Pinned and strict: the default range is a crowded neighbourhood, and a dev server
    // that silently lands on another port takes the E2E suite's baseURL with it.
    port: 5273,
    strictPort: true,
    proxy: {
      // Anchored, because a bare '/api' prefix also matches the client's own `/api.ts`
      // module request and proxies it to the backend — where it 404s, and the SPA never
      // boots. Only real API routes go through.
      '^/api/': api(),

      // The card is served by the API, not by Vite. Without this the SPA fallback answers
      // with index.html and the preview renders as a broken image.
      '^/[^/]+/[^/]+/card\\.svg$': api(),
    },
  },
});
