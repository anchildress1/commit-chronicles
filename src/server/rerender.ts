import { createCardStore } from './bucket.js';
import { loadConfig } from './config.js';
import { createGenerator } from './generate.js';
import { createInlineQueue } from './queue.js';
import { createSnowflakeClient } from './snowflake.js';
import { parseSlug } from '../shared/slug.js';

/**
 * Redraw stored cards with the current renderer.
 *
 * Spends no Cortex call: the words come back out of CARDS. Run it after any change to the
 * SVG, and pass repo slugs to limit it — with none, every card is redrawn.
 */
const config = loadConfig();
const store = createCardStore(config.bucket);
const snowflake = createSnowflakeClient(config);

const log = (message: string, detail?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ severity: 'INFO', message, ...detail }));
};

const generator = createGenerator({
  store,
  snowflake,
  config,
  queue: createInlineQueue(() => Promise.resolve()),
  log,
});

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested.map(parseSlug) : await snowflake.listCards();

let redrawn = 0;
for (const target of targets) {
  const slug = parseSlug(`${target.owner}/${target.repo}`);
  const ok = await generator.rerender(slug);
  if (ok) redrawn += 1;
  else log('no card to redraw', { repo: slug.slug });
}

log('done', { redrawn, of: targets.length });
await snowflake.close();
