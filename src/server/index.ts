import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createCardStore } from './bucket.js';
import { loadConfig } from './config.js';
import { createGenerator, runGeneration } from './generate.js';
import { createCloudTasksQueue, createInlineQueue, createTaskAuthenticator } from './queue.js';
import { createSnowflakeClient } from './snowflake.js';
import type { TaskQueue } from './queue.js';

const config = loadConfig();
const store = createCardStore(config.bucket);
const snowflake = createSnowflakeClient(config);

const log = (message: string, detail?: Record<string, unknown>): void => {
  // Cloud Logging parses stdout JSON into structured fields.
  console.log(JSON.stringify({ severity: 'INFO', message, ...detail }));
};

const pipeline = { store, snowflake, log };

// Without a queue configured (a laptop), generation runs in-process. In production it
// always round-trips through Cloud Tasks so the work survives the browser tab.
const queue: TaskQueue = config.tasks
  ? createCloudTasksQueue(config)
  : createInlineQueue((slug) => runGeneration(pipeline, slug));

const generator = createGenerator({ ...pipeline, config, queue });

const app = createApp({
  store,
  generator,
  taskAuth: createTaskAuthenticator(config),
  clientRoot: './dist/client',
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log('listening', {
    port: info.port,
    bucket: config.bucket,
    queue: config.tasks ? config.tasks.queue : 'inline',
  });
});

const shutdown = (signal: string): void => {
  log('shutting down', { signal });
  server.close();
  void snowflake.close().finally(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
