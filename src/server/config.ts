/** Process configuration, read once at boot. Missing required values fail loudly here. */
export interface TasksConfig {
  project: string;
  location: string;
  queue: string;
  /** The service's own public URL — Cloud Tasks calls back into it. */
  workerUrl: string;
  invokerServiceAccount: string;
}

export interface Config {
  port: number;
  bucket: string;
  publicOrigin: string;
  dailyGenerationCap: number;
  /** A `generating` marker older than this is treated as a dead run and may be retried. */
  generatingTtlMs: number;
  /** Absent on a laptop: generation then runs in-process instead of through a queue. */
  tasks: TasksConfig | null;
  snowflake: {
    account: string;
    username: string;
    token: string;
    warehouse: string;
    database: string;
    schema: string;
    role: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`env var ${name} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

/**
 * Cloud Tasks is all-or-nothing: a half-configured queue would enqueue jobs that can
 * never be delivered, and the repo would sit on `generating` forever.
 */
function loadTasks(): TasksConfig | null {
  if (!process.env['TASKS_QUEUE']) return null;

  return {
    project: required('GOOGLE_CLOUD_PROJECT'),
    location: required('TASKS_LOCATION'),
    queue: required('TASKS_QUEUE'),
    workerUrl: required('WORKER_URL'),
    invokerServiceAccount: required('TASKS_INVOKER_SA'),
  };
}

/**
 * Read configuration from the environment.
 *
 * @throws {Error} On a missing required variable, or a malformed numeric one.
 */
export function loadConfig(): Config {
  return {
    port: int('PORT', 8080),
    bucket: required('CARD_BUCKET'),
    publicOrigin: process.env['PUBLIC_ORIGIN'] ?? 'https://commitchronicles.dev',
    dailyGenerationCap: int('DAILY_GENERATION_CAP', 100),
    generatingTtlMs: int('GENERATING_TTL_SECONDS', 600) * 1000,
    tasks: loadTasks(),
    snowflake: {
      account: required('SNOWFLAKE_ACCOUNT'),
      username: required('SNOWFLAKE_USER'),
      token: required('SNOWFLAKE_PAT'),
      warehouse: process.env['SNOWFLAKE_WAREHOUSE'] ?? 'CHRONICLES_WH',
      database: process.env['SNOWFLAKE_DATABASE'] ?? 'CHRONICLES',
      schema: process.env['SNOWFLAKE_SCHEMA'] ?? 'RAW',
      role: process.env['SNOWFLAKE_ROLE'] ?? 'ACCOUNTADMIN',
    },
  };
}
