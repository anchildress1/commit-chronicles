import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { CardStore } from './bucket.js';
import type { Generator } from './generate.js';
import type { TaskAuthenticator } from './queue.js';
import { InvalidSlugError, parseSlug } from '../shared/slug.js';

export interface AppDeps {
  store: CardStore;
  generator: Generator;
  /** Proves a worker request came from our queue. Omit only where there is no queue. */
  taskAuth?: TaskAuthenticator;
  /** Where the built SPA lives, relative to the process cwd. Omit to skip static serving. */
  clientRoot?: string;
}

/**
 * Routes. The serving path reads the bucket and nothing else — a cached repo page never
 * touches Snowflake or GitHub, which is what keeps a viral card from costing anything.
 */
export function createApp({ store, generator, taskAuth, clientRoot }: AppDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/api/generate', async (c) => {
    let body: { repo?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }

    let slug;
    try {
      slug = parseSlug(typeof body.repo === 'string' ? body.repo : '');
    } catch (error) {
      if (error instanceof InvalidSlugError) {
        return c.json({ error: 'invalid_repo' }, 400);
      }
      throw error;
    }

    const outcome = await generator.start(slug);

    if (!outcome.accepted && outcome.reason === 'quota_exceeded') {
      return c.json({ error: 'quota_exceeded', repo: slug.slug }, 429);
    }

    // Everything else is an attach, not an error: a second click, a reload, or a repo
    // someone else already read all resolve to the state that already exists.
    return c.json(outcome.state, outcome.accepted ? 202 : 200);
  });

  /**
   * The queue worker. Cloud Tasks calls this with an OIDC token; the pipeline therefore
   * runs inside a request, which is what lets the service scale to zero and still finish
   * a generation the user walked away from.
   *
   * This route is on a public service, so an unverified caller could otherwise spend
   * Cortex credits at will. No token, no work.
   */
  app.post('/internal/generate', async (c) => {
    if (!taskAuth || !(await taskAuth.verify(c.req.header('authorization')))) {
      return c.json({ error: 'unauthorized' }, 403);
    }

    let slug;
    try {
      const body: { repo?: unknown } = await c.req.json();
      slug = parseSlug(typeof body.repo === 'string' ? body.repo : '');
    } catch {
      // A malformed task will never become well-formed. 200 retires it instead of
      // letting Cloud Tasks retry it until the queue's deadline.
      return c.json({ error: 'invalid_repo' }, 200);
    }

    await generator.run(slug);
    return c.json({ ok: true });
  });

  app.get('/api/state/:owner/:repo', async (c) => {
    let slug;
    try {
      slug = parseSlug(`${c.req.param('owner')}/${c.req.param('repo')}`);
    } catch {
      return c.json({ error: 'invalid_repo' }, 400);
    }

    const state = await store.readState(slug.owner, slug.repo);
    return c.json(state, { headers: { 'cache-control': 'no-store' } });
  });

  app.get('/:owner/:repo/card.svg', async (c) => {
    let slug;
    try {
      slug = parseSlug(`${c.req.param('owner')}/${c.req.param('repo')}`);
    } catch {
      return c.notFound();
    }

    const svg = await store.readCardSvg(slug.owner, slug.repo);
    if (!svg) return c.notFound();

    return c.body(svg, 200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      // README embeds go through GitHub's camo proxy, which caches on these headers.
      // Without them the neat trick becomes a broken badge.
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    });
  });

  if (clientRoot) {
    app.use('/assets/*', serveStatic({ root: clientRoot }));
    app.use('/favicon.svg', serveStatic({ root: clientRoot }));

    // The SPA owns `/` and `/{owner}/{repo}`. Anything deeper is a 404 rather than a page
    // that pretends the route exists.
    const index = serveStatic({ root: clientRoot, path: 'index.html' });
    app.get('/', index);
    app.get('/:owner/:repo', index);
  }

  return app;
}
