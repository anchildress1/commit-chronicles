import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

const REQUIRED: Record<string, string> = {
  CARD_BUCKET: 'cards',
  SNOWFLAKE_ACCOUNT: 'acct',
  SNOWFLAKE_USER: 'user',
  SNOWFLAKE_PAT: 'pat',
};

/** Every variable this service reads. A stray one from the shell must not pass a test. */
const OWNED =
  /^(CARD_BUCKET|SNOWFLAKE_|TASKS_|WORKER_URL|GOOGLE_CLOUD_PROJECT|PORT|DAILY_|GENERATING_|PUBLIC_ORIGIN)/;

let saved: NodeJS.ProcessEnv;

/** Rebuild the environment with exactly `values` of the variables we own. */
function setEnv(values: Record<string, string>): void {
  const kept: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(saved)) {
    if (!OWNED.test(key)) kept[key] = value;
  }

  process.env = { ...kept, ...values };
}

/** REQUIRED minus one key, to prove the service refuses to boot without it. */
function without(missing: string): Record<string, string> {
  const rest: Record<string, string> = {};

  for (const [key, value] of Object.entries(REQUIRED)) {
    if (key !== missing) rest[key] = value;
  }

  return rest;
}

beforeEach(() => {
  saved = { ...process.env };
  setEnv(REQUIRED);
});

afterEach(() => {
  process.env = saved;
});

describe('loadConfig', () => {
  it('reads the required values', () => {
    const config = loadConfig();

    expect(config.bucket).toBe('cards');
    expect(config.snowflake.account).toBe('acct');
  });

  it('falls back to sensible defaults', () => {
    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.dailyGenerationCap).toBe(100);
    expect(config.generatingTtlMs).toBe(600_000);
    expect(config.snowflake.warehouse).toBe('CHRONICLES_WH');
  });

  it.each(Object.keys(REQUIRED))('refuses to boot without %s', (key) => {
    setEnv(without(key));

    expect(() => loadConfig()).toThrow(new RegExp(key));
  });

  it.each(['nonsense', '0', '-5'])('refuses a malformed numeric env var: %s', (value) => {
    setEnv({ ...REQUIRED, PORT: value });

    expect(() => loadConfig()).toThrow(/positive integer/);
  });

  it('runs without a queue — a laptop has none', () => {
    expect(loadConfig().tasks).toBeNull();
  });

  it('takes the whole queue config or none of it', () => {
    // Half a queue would enqueue jobs that could never be delivered.
    setEnv({ ...REQUIRED, TASKS_QUEUE: 'gen' });

    expect(() => loadConfig()).toThrow(
      /GOOGLE_CLOUD_PROJECT|TASKS_LOCATION|WORKER_URL|TASKS_INVOKER_SA/,
    );
  });

  it('reads a complete queue config', () => {
    setEnv({
      ...REQUIRED,
      TASKS_QUEUE: 'gen',
      TASKS_LOCATION: 'us-east1',
      GOOGLE_CLOUD_PROJECT: 'proj',
      WORKER_URL: 'https://worker',
      TASKS_INVOKER_SA: 'sa@proj.iam.gserviceaccount.com',
    });

    expect(loadConfig().tasks).toMatchObject({ queue: 'gen', workerUrl: 'https://worker' });
  });
});
